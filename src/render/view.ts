/**
 * The render view: WebGL renderer + scene + first-person camera.
 *
 * Owns every GPU resource and is responsible for giving them all back on
 * `dispose()`, so "restart" and "quit" can be honest operations rather than a
 * page reload.
 */

import * as THREE from 'three';

import type { GameConfig } from '../core/config.js';
import { logger } from '../core/log.js';
import { clamp01 } from '../core/math.js';
import type { ReadonlyVec3 } from '../core/vec3.js';
import type { Orientation } from '../game/look.js';
import { GATE_FACE_SUFFIXES, type LevelDefinition } from '../game/level/levelData.js';
import type { PlayerPose } from '../game/pose.js';
import { applyAnisotropy } from './assets.js';
import { buildPlayerBody, posePlayerBody, type PlayerBody } from './playerModel.js';
import {
  applyLampPool,
  assignLamps,
  buildScene,
  fadeLamps,
  lampPoolFor,
  selectLamps,
  shadowReachFor,
  updateChunkVisibility,
  updateMovingVisibility,
  updateShadowCasters,
  type BuiltScene,
} from './sceneBuilder.js';
import { pickupPose, smokePose } from './effects.js';
import { BLOOM_DEFAULTS, BloomChain } from './bloom.js';
import { PuffPool } from './puffs.js';
import { QUALITY_PRESETS, type QualityPreset } from '../core/settings.js';
import { GraphicsUnavailableError, NO_ASSETS, type GameViewLike, type SceneAssets } from './types.js';

export { GraphicsUnavailableError };
export type { GameViewLike };

/**
 * Most anisotropic filtering worth asking for.
 *
 * Sixteen taps is what mainstream GPUs offer; beyond that the cost is real and the
 * difference is not. Asking for the GPU's own maximum with a ceiling here keeps a
 * card that reports 32 from spending twice the bandwidth for nothing anyone can
 * see.
 */
const MAX_ANISOTROPY = 16;

/**
 * The drawing-buffer scale a preset asks for.
 *
 * Capped by the device's own ratio: a 3x display at a 3x cap is twice the pixels of
 * a 2x display, and rendering more than the screen can show is work nobody sees.
 */
function drawingRatio(preset: QualityPreset): number {
  return Math.min(globalThis.devicePixelRatio || 1, preset.pixelRatioCap);
}

/** The GPU's own anisotropic ceiling, or 1 when it cannot be asked. */
function maxAnisotropy(renderer: THREE.WebGLRenderer): number {
  try {
    return renderer.capabilities.getMaxAnisotropy();
  } catch {
    return 1;
  }
}

/**
 * Applies a fraction to a list by *striding* through it.
 *
 * A prefix would erase whichever items happen to be last - every plume but the
 * first, or the lamps on one side of the district. A fixed stride thins the list
 * evenly, and because it is arithmetic rather than random, applying the same setting
 * twice leaves the same items lit.
 */
function applyEvenScale(count: number, scale: number, apply: (index: number, visible: boolean) => void): void {
  const keep = Math.max(0, Math.min(count, Math.round(count * Math.min(1, Math.max(0, scale)))));
  for (let index = 0; index < count; index += 1) {
    if (keep === 0) {
      apply(index, false);
      continue;
    }
    // Each kept item owns an equal share of the list; `index` falls in a kept share
    // when the bracket it belongs to is one of them.
    const bracket = Math.floor((index * keep) / count);
    const next = Math.floor(((index + 1) * keep) / count);
    apply(index, next !== bracket);
  }
}

export interface GameViewOptions {
  readonly canvas: HTMLCanvasElement;
  readonly definition: LevelDefinition;
  readonly config: GameConfig;
  /**
   * Flat textures for the sky and the city backdrop.
   *
   * The view takes ownership: they are disposed with the rest of the scene.
   */
  readonly assets?: SceneAssets;
}

export class GameView implements GameViewLike {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly built: BuiltScene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly doorAngles: ReadonlyMap<string, number>;
  private readonly liftThickness: ReadonlyMap<string, number>;
  /** Floors per lift, for working out where a gate's opening is. */
  private readonly liftFloors: ReadonlyMap<string, readonly number[]>;
  /** How tall each gate is, which is how far it has to travel to be out of the way. */
  private readonly gateHeights: ReadonlyMap<string, number>;
  private readonly pickupHome: ReadonlyMap<string, ReadonlyVec3>;
  /** Borrowed, not owned: the loader disposes them, and settings re-filter them. */
  private readonly assets: SceneAssets;
  private quality: QualityPreset = QUALITY_PRESETS.high;
  /**
   * How much of the preset's resolution is actually drawn, 0.6..1.
   *
   * **Dynamic resolution.** This laptop-class GPU can hold sixty frames a second at 2.3 megapixels
   * when it is cool and cannot when it is heat-soaked: measured on the machine this was tuned on,
   * the same view costs 16.7 ms at 59 °C and 19.6 ms at 87 °C, because the iGPU clocks down from
   * 2,200 MHz to about 1,800. There is no setting that fixes that, because the player cannot see
   * the temperature - so the game watches its own frames instead and takes the resolution down
   * until they fit, raising it again when there is room. See `Game.adaptResolution`.
   */
  private renderScale = 1;
  private readonly body: PlayerBody;
  private readonly config: GameConfig;
  /**
   * The bloom chain, when the preset asks for one.
   *
   * `null` on every preset but high, and that is the gate: with no chain the frame renders straight
   * to the canvas exactly as it did before bloom existed, so a machine that cannot afford the pass
   * never pays for it. Rebuilt rather than toggled when the preset changes, because the composer
   * owns render targets sized to the drawing buffer and swapping one in mid-run is not worth the
   * bookkeeping for a setting the player changes by hand.
   */
  private bloomChain: BloomChain | null = null;
  /**
   * Where the sun sits relative to the point it lights.
   *
   * Taken from the scene as built, so there is one authority on where the light is: the
   * level's own sun direction.
   */
  private readonly sunOffset: { x: number; y: number; z: number };
  /**
   * How far from the eye a chunk may be and still cast a shadow.
   *
   * The shadow camera's half-extent plus the half-diagonal of a chunk, so a chunk
   * with any part of itself inside the volume stays in the pass.
   */
  private readonly shadowReach: number;
  /** How many chunks are casting into the shadow map this frame. */
  private casters = 0;
  /** How many chunks are being drawn this frame, after the distance cull. */
  private chunksDrawn = 0;
  /** How many gates, lift cars and pickups are drawn this frame, after theirs. */
  private movingDrawn = 0;
  /** Meshes and sprites in the scene, counted once: it does not change while the view lives. */
  private objectCount = 0;
  /** How many of the level's lamps are lit this frame. */
  private lampsOn = 0;
  /** The last place the lamp selection was made for. */
  private lampCell = '';
  /**
   * How many of the pool's lights the current preset uses.
   *
   * Not the same as the pool's *size*: three.js sizes its per-fragment light loop from the number
   * of *visible* lights, so lighting only six of eight while all eight are visible costs every lit
   * pixel two evaluations for nothing. This is the number the shader actually pays for, and it is
   * kept in step with `selectLamps` by `applyLampPool` so the two cannot disagree.
   */
  private lampPool = lampPoolFor(QUALITY_PRESETS.high.lightScale);
  /** The snapped shadow-camera centre the map was last rendered from. */
  private shadowX = Number.NaN;
  private shadowZ = Number.NaN;
  private shadowFrames = 0;
  /** When the last frame was drawn, for the view's own frame-time estimate. */
  private lastFrameAt = 0;
  /**
   * The impact dust the game has thrown, as a ring of pooled puffs.
   *
   * Owned by the view rather than the game, because it lives in the same batched draw as the
   * smoke: two systems publishing into one instance buffer only works if one of them owns the
   * commit. The game says *that* a landing happened and how hard; this decides what it looks like.
   */
  private readonly dust = new PuffPool();

  private disposed = false;

  constructor(options: GameViewOptions) {

    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas: options.canvas,
        antialias: true,
        powerPreference: 'high-performance',
        // The canvas is opaque; skipping alpha saves a full-screen blend.
        alpha: false,
        stencil: false,
        // **The depth range of this scene does not fit a normal depth buffer.** It draws from a
        // body part 20 cm from the eye to a skyline 780 m away, and a 24-bit buffer spends almost
        // all of its precision on the first few metres: at 300 m it cannot tell two surfaces apart
        // until they are 5 cm apart. The city is built from decorative trims 1 cm proud of the
        // walls and window bands 1 cm off the facades, so everything past about 150 m shimmered -
        // measured from a rooftop over the city: 1.3% of the screen changing on a 5 mm step of the
        // camera, on the distant skyline only. A logarithmic buffer distributes depth by ratio
        // instead, and takes that to 0.006% for about 0.4 ms of fill rate (measured, 1080p, on an
        // integrated GPU - 19% of the frame's render time, of which there is plenty).
        logarithmicDepthBuffer: true,
      });
    } catch (cause) {
      throw new GraphicsUnavailableError(
        'WebGL is not available in this browser or is disabled.',
        cause,
      );
    }

    this.renderer.setPixelRatio(drawingRatio(this.quality));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = true;
    // `PCFSoftShadowMap` was removed from three.js in r186: setting it logs a warning
    // and silently falls back to `PCFShadowMap`, so the demo spent a version asking
    // for soft shadows it was not getting. `VSMShadowMap` is the soft option that is
    // left, and it bleeds light through thin geometry - which this district is made
    // of - so the honest choice is hard PCF with a shadow map sized by the graphics
    // preset, where resolution is something the player can turn up.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // **The shadow map is rendered on purpose, not every frame.** Nothing in this district moves but
    // the player, and the shadow camera is snapped to whole texels as it follows them - so on a frame
    // where the snap has not moved, the shadow map would be rendered from the same place it was
    // rendered from last time, drawing every caster in the district again to produce a pixel-identical
    // texture. It is the most expensive pass in the renderer at high settings, and it is now drawn
    // when the camera moves and every third frame besides, which keeps the player's own shadow alive.
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.setClearColor(new THREE.Color(options.definition.environment.skyColor), 1);

    // Filtering has to be decided before the first frame: three.js applies it when
    // it uploads a texture, and there is no second chance afterwards. This is the
    // one place that knows both the textures and the GPU, which is why it happens
    // here rather than in the loader.
    applyAnisotropy(
      options.assets ?? NO_ASSETS,
      Math.min(MAX_ANISOTROPY, this.renderer.capabilities.getMaxAnisotropy()),
    );

    this.camera = new THREE.PerspectiveCamera(
      options.config.camera.fov,
      1,
      options.config.camera.near,
      options.config.camera.far,
    );
    // YXZ keeps yaw and pitch independent, which is what stops the view from
    // rolling as the player turns.
    this.camera.rotation.order = 'YXZ';

    this.assets = options.assets ?? NO_ASSETS;
    this.config = options.config;
    this.built = buildScene(options.definition, this.assets);
    this.sunOffset = {
      x: this.built.sun.position.x - this.built.sun.target.position.x,
      y: this.built.sun.position.y,
      z: this.built.sun.position.z - this.built.sun.target.position.z,
    };

    this.shadowReach = shadowReachFor(this.built.sun.shadow?.camera.right ?? 110);

    // The player's own body: in the world, casting a shadow, and visible when the
    // player looks down at themselves.
    this.body = buildPlayerBody();
    this.built.scene.add(this.body.root);
    this.doorAngles = new Map(
      (options.definition.doors ?? []).map((door) => [door.id, door.openAngle] as const),
    );
    this.liftThickness = new Map(
      (options.definition.elevators ?? []).map((lift) => [lift.id, lift.thickness] as const),
    );
    this.liftFloors = new Map(
      (options.definition.elevators ?? []).map((lift) => [lift.id, lift.floors] as const),
    );
    this.gateHeights = new Map(
      (options.definition.props ?? [])
        .filter((prop) => prop.model === 'elevator-gate')
        .map((prop) => [prop.id, prop.size.y] as const),
    );
    this.pickupHome = new Map(
      (options.definition.collectibles ?? []).map((pickup) => [pickup.id, pickup.position] as const),
    );

    // Counted once, because it cannot change while this view lives: `?perf` used to walk six
    // thousand five hundred objects every frame to report a number that had not moved.
    this.built.scene.traverse((object) => {
      if ((object as THREE.Mesh).isMesh || (object as THREE.Sprite).isSprite) this.objectCount += 1;
    });

    logger.info('render', 'view created', {
      renderer: this.rendererInfo ?? 'unknown',
      skybox: options.assets?.skybox != null,
      backdrop: this.built.backdrop !== null,
      parts: [...this.built.parts.values()].reduce((total, info) => total + info.count, 0),
      chunks: this.built.chunks.length,
      moving: this.built.moving.length,
      objects: this.objectCount,
      lampSources: this.built.lamps.sources.length,
      lampPool: this.built.lamps.pool.length,
      casters: this.casters,
      drawn: this.chunksDrawn,
      lamps: this.lampsOn,
    });
  }

  get scene(): THREE.Scene {
    return this.built.scene;
  }

  get threeCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }

  /**
   * What the last frame cost the GPU, and what it asked of it.
   *
   * `calls` is the number that decides which half of a slow frame the problem is in: a few hundred
   * calls with a bad frame rate is fill-rate or shader work - something a resolution setting can
   * fix - and a thousand is the CPU feeding the GPU one object at a time, which no setting can.
   */
  get renderStats(): {
    readonly calls: number;
    readonly triangles: number;
    readonly programs: number;
    readonly objects: number;
    readonly chunksDrawn: number;
    readonly chunksTotal: number;
    readonly movingDrawn: number;
    readonly movingTotal: number;
    readonly pixelRatio: number;
  } {
    return {
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      programs: this.renderer.info.programs?.length ?? 0,
      objects: this.objectCount,
      chunksDrawn: this.chunksDrawn,
      chunksTotal: this.built.chunks.length,
      movingDrawn: this.movingDrawn,
      movingTotal: this.built.moving.length,
      pixelRatio: Number(this.drawingRatioNow().toFixed(2)),
    };
  }

  /** GPU description, used in the debug HUD and crash reports. */
  get rendererInfo(): string | null {
    try {
      const gl = this.renderer.getContext();
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      const unmasked = debugInfo
        ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER);
      return typeof unmasked === 'string' ? unmasked : null;
    } catch {
      return null;
    }
  }

  /** Resizes the drawing buffer and camera to the given CSS pixel size. */
  setSize(width: number, height: number): void {
    if (this.disposed) return;

    const safeWidth = Math.max(1, Math.floor(width));
    const safeHeight = Math.max(1, Math.floor(height));

    this.applyDrawingSize();
    this.renderer.setSize(safeWidth, safeHeight, false);

    this.camera.aspect = safeWidth / safeHeight;
    this.camera.updateProjectionMatrix();
  }

  /** The pixel ratio in use: the preset's cap, scaled by whatever adaptation has settled on. */
  private drawingRatioNow(): number {
    return Math.max(0.5, drawingRatio(this.quality) * this.renderScale);
  }

  private applyDrawingSize(): void {
    const size = this.renderer.getSize(new THREE.Vector2());
    const ratio = this.drawingRatioNow();
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(size.x, size.y, false);
    // **The composer has its own buffers, and they are not the renderer's.** It sizes them from the
    // CSS size * it is told, so a resize or a dynamic-resolution step that only reached the
    // renderer would leave the whole post chain rendering at the old resolution - a bloom that is
    // subtly the wrong size until the next preset change.
    this.bloomChain?.setSize(size.x, size.y, ratio);
  }

  /**
   * Builds or tears down the bloom chain to match the preset.
   *
   * Idempotent, and it *never throws*: a machine whose driver cannot give a multisampled half-float
   * buffer gets no bloom and a working game, which is the only acceptable trade for a cosmetic
   * pass. That is also why this is the one place the chain is created - a preset change, never a
   * frame.
   */
  private syncBloom(): void {
    const wanted = this.quality.bloom;
    if (wanted === (this.bloomChain !== null)) return;

    if (!wanted) {
      this.bloomChain?.dispose();
      this.bloomChain = null;
      logger.info('render', 'bloom off');
      return;
    }

    try {
      const chain = new BloomChain(this.renderer, this.built.scene, this.camera);
      const size = this.renderer.getSize(new THREE.Vector2());
      chain.setSize(size.x, size.y, this.drawingRatioNow());
      this.bloomChain = chain;
      logger.info('render', 'bloom on', { strength: BLOOM_DEFAULTS.strength, threshold: BLOOM_DEFAULTS.threshold });
    } catch (error) {
      // Cosmetic, so it degrades rather than fails - and the game carries on rendering straight to
      // the canvas, which is exactly what every other preset does.
      this.bloomChain = null;
      logger.warn('render', 'bloom is unavailable on this GPU - rendering without it', {
        error: String(error),
      });
    }
  }

  /**
   * Takes the drawing buffer down (or back up) against the preset's cap.
   *
   * Called by the game when the frame statistics say the frame no longer fits. Idempotent, and it
   * keeps the canvas's CSS size: only the number of pixels behind it changes.
   */
  setRenderScale(scale: number): void {
    if (this.disposed) return;
    const next = Math.max(0.6, Math.min(1, scale));
    if (Math.abs(next - this.renderScale) < 0.001) return;
    this.renderScale = next;
    this.applyDrawingSize();
    logger.info('render', 'resolution adapted', {
      scale: Number(next.toFixed(2)),
      pixelRatio: Number(this.drawingRatioNow().toFixed(2)),
      quality: this.quality.label,
    });
  }

  /** Renders one frame from an eye position and orientation. */
  render(eye: ReadonlyVec3, orientation: Orientation): void {
    if (this.disposed) return;

    // The view measures its own frame time, because the only thing it animates itself is the lamp
    // fade - everything else is driven by the simulation. Clamped, so a tab restored after a minute
    // does not arrive at full brightness in one step.
    const now = performance.now();
    const seconds = this.lastFrameAt === 0 ? 1 / 60 : Math.min(0.1, (now - this.lastFrameAt) / 1000);
    this.lastFrameAt = now;

    this.followWithShadow(eye);
    this.followLamps(eye);
    // Per frame, unlike the selection itself: a pool light takes a new lamp only once it has faded
    // out, and that release has to be observed frame by frame - see `assignLamps`.
    assignLamps(this.built.lamps);
    fadeLamps(this.built.lamps, seconds);

    this.camera.position.set(eye.x, eye.y, eye.z);
    // Roll is in degrees on the way in (it comes from the settings-facing effect
    // values) and radians on the way out, which is the one conversion the renderer
    // does for the game.
    this.camera.rotation.set(orientation.pitch, orientation.yaw, ((orientation.roll ?? 0) * Math.PI) / 180);

    // Through the bloom chain when the preset has one, straight to the canvas when it does not.
    // The direct path is not a fallback - it is what every preset but high does, and it is the same
    // call this made before there was a post chain at all.
    if (this.bloomChain) this.bloomChain.render();
    else this.renderer.render(this.built.scene, this.camera);
  }

  /**
   * Swings a door.
   *
   * The door group's origin is the hinge line, so turning it about Y is the whole
   * animation - and, because three.js propagates transforms, the leaf's shadow
   * and lighting follow it for free.
   */
  setDoorOpen(id: string, open: number): void {
    if (this.disposed) return;
    const group = this.built.doors.get(id);
    const angle = this.doorAngles.get(id);
    if (!group || angle === undefined) return;
    group.rotation.y = clamp01(open) * angle;
  }

  /** Places an elevator car, and slides its gates. */
  setElevator(id: string, topY: number, floor: number, doorsOpen: number): void {
    if (this.disposed) return;
    const group = this.built.lifts.get(id);
    const thickness = this.liftThickness.get(id);
    if (group && thickness !== undefined) group.position.y = topY - thickness;

    // A gate is a shutter that rolls *up* by its own height, so "open" is a gate
    // parked in the wall above the opening and "shut" is a gate in the opening.
    const floors = this.liftFloors.get(id);
    if (!floors) return;
    for (let index = 0; index < floors.length; index += 1) {
      // A floor can open on two sides (`-back`), and both shutters are one opening: both have to
      // slide, or the collider opens while the mesh stays visibly shut.
      for (const suffix of GATE_FACE_SUFFIXES) {
        const gate = this.built.gates.get(`${id}-gate-${index}${suffix}`);
        if (!gate) continue;
        // Only the gate at the car's own floor is up; the rest are shut.
        const height = this.gateHeights.get(`${id}-gate-${index}${suffix}`) ?? 0;
        gate.position.y = index === floor ? Math.max(0, Math.min(1, doorsOpen)) * height : 0;
      }
    }
  }

  /** Hides a pickup that has been taken. */
  setCollectibleVisible(id: string, visible: boolean): void {
    if (this.disposed) return;
    const group = this.built.collectibles.get(id);
    if (group) group.visible = visible;
  }

  /**
   * Advances the purely visual animation.
   *
   * `elapsedSeconds` rather than a delta for the smoke: a plume is a *cycle*, so a puff's place is
   * a pure function of the clock and a frame that takes twice as long moves it exactly twice as
   * far with nothing to integrate. Impact dust does integrate, so it is aged by the *simulated*
   * delta - which means it freezes when the game is paused, rather than drifting on behind the
   * pause menu.
   */
  animate(elapsedSeconds: number, deltaSeconds: number): void {
    if (this.disposed) return;

    const field = this.built.smoke;
    if (field) {
      field.puffs.begin();
      const pose = field.pose;
      for (let index = 0; index < field.emitters.length; index += 1) {
        // The preset's thinning, applied per emitter rather than per sprite: one batched draw has
        // no per-sprite visibility to switch off.
        if (field.visible[index] === 0) continue;
        smokePose(field.emitters[index] as (typeof field.emitters)[number], elapsedSeconds, pose);
        field.puffs.push({ x: pose.x, y: pose.y, z: pose.z, scale: pose.scale, opacity: pose.opacity });
      }
      // The dust that a landing threw up rides the same buffer, so it is aged here and the field
      // is published once - one draw call for every soft blob in the air.
      this.dust.emit(field.puffs, deltaSeconds);
      field.puffs.commit();
    }

    for (const [id, group] of this.built.collectibles) {
      const home = this.pickupHome.get(id);
      if (!home) continue;
      const pose = pickupPose(home, elapsedSeconds);
      group.position.y = pose.y;
      group.rotation.y = pose.spin;
    }
  }

  /**
   * Throws a burst of dust up from a landing.
   *
   * Driven by the *game* rather than by the view's own state, because the only thing that knows a
   * landing happened - and how hard - is the simulation. The count and the spread come from the
   * impact, so a hop off a kerb barely puffs and a long drop blooms.
   */
  burstDust(x: number, y: number, z: number, strength: number, spread: number): void {
    if (this.disposed) return;
    // Nothing to draw into: without the puff texture there is no batched field, so spawning would
    // fill a pool that never ages and never renders.
    if (!this.built.smoke) return;
    const amount = clamp01(strength);
    if (amount <= 0.05) return;
    const count = Math.max(1, Math.round(3 + amount * 11));
    for (let index = 0; index < count; index += 1) {
      // A ring, evenly spread with a little jitter, so a burst reads as a ring of dust rather than
      // as a cone: `Math.random` would make two landings look different for no reason, so the
      // angle is the index's and only the radius wobbles.
      const angle = (index / count) * Math.PI * 2 + amount * 1.7;
      const reach = spread * (0.45 + 0.55 * ((index * 7) % 5) / 5);
      const lift = 0.6 + amount * 1.6;
      this.dust.spawn(
        x + Math.cos(angle) * 0.12,
        y + 0.06,
        z + Math.sin(angle) * 0.12,
        Math.cos(angle) * reach,
        lift,
        Math.sin(angle) * reach,
        0.45 + amount * 0.5,
        0.28 + amount * 0.5,
        0.16 + amount * 0.3,
      );
    }
  }

  /** Kills every puff of dust, for a respawn or a restart. */
  clearDust(): void {
    this.dust.clear();
  }

  /** Places and poses the player's body. */
  setPlayerBody(feet: ReadonlyVec3, yaw: number, pose: PlayerPose, dt: number): void {
    if (this.disposed) return;
    this.body.root.position.set(feet.x, feet.y, feet.z);
    this.body.root.rotation.y = yaw;
    posePlayerBody(this.body, pose, this.config, dt);
  }

  /**
   * Keeps the shadow volume over the player, snapped to its own texel grid.
   *
   * V0.5 fixed the shadow camera to the origin, which was right when the district was
   * the whole level: at a 110 m half-extent it covered everything, and the map never had
   * to change. The city is a kilometre across, so a fixed volume means shadows that are
   * either a blur or - past its edge - not there at all, and a player with no shadow is
   * a player with no idea how high they are.
   *
   * Moving it every frame would make the shadows swim, because a shadow texel covers
   * about 5 cm of ground and the sampling grid would slide under the geometry on every
   * frame. Snapping the volume to a whole number of texels is the standard fix: the
   * shadows stay where they are on the ground and the volume steps along with the player.
   */
  /**
   * Switches the nearest lamps on, and the rest off.
   *
   * Re-evaluated when the player has moved far enough for a different set to be nearest rather
   * than every frame: the selection is over five hundred lights, and the answer does not change
   * between two steps.
   */
  private followLamps(eye: ReadonlyVec3): void {
    // **The selection, not the lights themselves.** Six of five hundred and seventy-six sources
    // are lit at once and the set changes every twenty-four metres, so the O(576) search runs on a
    // cell change and the eight-slot assignment runs every frame - see `selectLamps`.
    const cell = `${Math.round(eye.x / 24)}|${Math.round(eye.z / 24)}`;
    if (cell === this.lampCell) return;
    this.lampCell = cell;
    // **Six, not twelve.** A point light is a per-fragment loop over the whole screen. Six pools of
    // light around the player and the neon carrying the rest: the city is a neon city, and it is
    // emissive surfaces rather than lamps that make it one. The count is the *pool* rather than a
    // fresh round() of the preset, so the selection and the shader's loop are the same number.
    this.lampsOn = selectLamps(this.built.lamps, eye, this.lampPool);
  }

  private followWithShadow(eye: ReadonlyVec3): void {
    const sun = this.built.sun;
    const shadow = sun.shadow;
    if (!shadow) return;

    // **Every frame, and it has to be.** Caching this by a position cell - which is what the lamp
    // selection does - was tried and reverted: a player running at eleven metres a second crosses a
    // twenty-metre cell twice a second, and the chunks at the edge of the draw distance would appear
    // and then disappear in twenty-metre steps. A pop is a worse glitch than the two hundred
    // microseconds this costs, and six hundred and twenty-six array reads is nothing.
    this.casters = updateShadowCasters(this.built.chunks, eye, this.shadowReach);
    this.chunksDrawn = updateChunkVisibility(this.built.chunks, eye);
    // The moving set is where the chunk merge does not reach - gates, lift cars, pickups - so it
    // gets the same distance cull rather than relying on the far plane.
    this.movingDrawn = updateMovingVisibility(this.built.moving, eye);

    const extent = Math.max(1, shadow.camera.right);
    const texel = (extent * 2) / Math.max(1, shadow.mapSize.width);
    const snappedX = Math.round(eye.x / texel) * texel;
    const snappedZ = Math.round(eye.z / texel) * texel;

    // The light and the target move together, so the *direction* of the sunlight never
    // changes - only where its map is looking.
    sun.target.position.set(snappedX, 0, snappedZ);
    sun.target.updateMatrixWorld();
    sun.position.set(
      snappedX + this.sunOffset.x,
      this.sunOffset.y,
      snappedZ + this.sunOffset.z,
    );

    // Redraw the map when the snapped camera moved, and every third frame regardless so the player's
    // own shadow follows them: at 20 Hz a falling body's shadow is invisible as a redraw and obvious
    // as a freeze. `autoUpdate` is off - see the constructor.
    this.shadowFrames += 1;
    const moved = snappedX !== this.shadowX || snappedZ !== this.shadowZ;
    if (moved || this.shadowFrames >= 3) {
      this.shadowX = snappedX;
      this.shadowZ = snappedZ;
      this.shadowFrames = 0;
      this.renderer.shadowMap.needsUpdate = true;
    }
  }

  /**
   * Sets the vertical field of view.
   *
   * Idempotent for a value it already has, which is what the render path relies on: the game
   * passes the setting *plus* whatever the speed and crouch effects are doing with it every frame,
   * and a frame in which neither changed must not rebuild the projection matrix.
   */
  setFov(fov: number): void {
    if (this.disposed) return;
    if (!Number.isFinite(fov) || fov <= 0) return;
    if (this.camera.fov === fov) return;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Applies a graphics preset.
   *
   * Every knob a preset owns is set here, and all of it is safe to apply at any time
   * - including in the middle of a run, because the settings screen is reachable
   * from the pause menu.
   *
   * Two need care:
   *
   *  - **Shadows.** Toggling `renderer.shadowMap.enabled` changes which shader a
   *    material compiles to, and three.js recompiles nothing by itself, so every
   *    material has to be marked dirty or the scene carries on with the old program.
   *  - **Shadow resolution.** Setting `mapSize` on a light whose shadow map already
   *    exists does nothing: the render target has to be thrown away so it is
   *    rebuilt at the new size.
   */
  setQuality(preset: QualityPreset): void {
    if (this.disposed) return;
    const previous = this.quality;
    this.quality = preset;
    // A preset change is a fresh start on purpose: the player has just said what they want, so the
    // adaptation begins again at the new cap rather than carrying a guess about the last one.
    this.renderScale = 1;

    this.applyDrawingSize();

    const shadowsChanged = previous.shadows !== preset.shadows;
    this.renderer.shadowMap.enabled = preset.shadows;
    if (shadowsChanged) {
      this.renderer.shadowMap.needsUpdate = true;
      for (const material of this.built.materials.values()) material.needsUpdate = true;
    }

    if (preset.shadows) {
      const sun = this.built.sun;
      if (sun.shadow.mapSize.width !== preset.shadowMapSize) {
        sun.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
        sun.shadow.map?.dispose();
        sun.shadow.map = null;
      }
    }

    // Filtering belongs to the texture and is applied when it is uploaded - so asking for it again
    // is a full re-upload of every texture in the game, mipmaps and all. Only when it changed.
    if (previous.anisotropy !== preset.anisotropy) {
      applyAnisotropy(this.assets, Math.min(maxAnisotropy(this.renderer), preset.anisotropy));
    }
    // The preset's share of the smoke, applied per *emitter*: one batched draw has no per-sprite
    // visibility to switch off, so the list of what is drawn is thinned instead - the same even
    // stride, and a setting that still means the same thing.
    const field = this.built.smoke;
    if (field) {
      applyEvenScale(field.emitters.length, preset.smokeScale, (index, visible) => {
        field.visible[index] = visible ? 1 : 0;
      });
    }
    // The preset's share of the lamps is a *cap* now, not a fixed pattern: which ones are lit is
    // decided per frame by how close they are - see `followLamps`. The pool is resized here too,
    // because a light nobody can see is a light the shader still evaluates: this is the one place
    // the visible count may change, since three.js recompiles every material when it does.
    this.lampPool = applyLampPool(this.built.lamps, lampPoolFor(preset.lightScale));
    // ...and the selection is redone against the new pool size, so a shrunken pool cannot keep a
    // lamp in a slot that is no longer lit.
    this.lampCell = '';

    // The post chain, built or torn down to match. Last, because it is the most expensive thing a
    // preset does and nothing above it depends on it.
    this.syncBloom();

    logger.info('render', 'quality applied', {
      quality: preset.label,
      shadows: preset.shadows,
      shadowMapSize: preset.shadowMapSize,
      parts: [...this.built.parts.values()].reduce((total, info) => total + info.count, 0),
      chunks: this.built.chunks.length,
      casters: this.casters,
      drawn: this.chunksDrawn,
    });
  }

  /** Releases the GPU context and all scene resources. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.body.dispose();
    this.built.dispose();
    this.dust.clear();
    this.bloomChain?.dispose();
    this.bloomChain = null;
    this.renderer.setAnimationLoop(null);
    this.renderer.dispose();
    // Frees the context immediately instead of waiting for GC, which matters
    // because browsers cap the number of live WebGL contexts.
    this.renderer.forceContextLoss();

    logger.info('render', 'view disposed');
  }
}


