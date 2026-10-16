/**
 * The render view: WebGL renderer + scene + first-person camera.
 *
 * Owns every GPU resource and is responsible for giving them all back on
 * `dispose()`, so "restart" and "quit" can be honest operations rather than a
 * page reload.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

import type { GameConfig } from '../core/config.js';
import { logger } from '../core/log.js';
import { clamp01 } from '../core/math.js';
import type { ReadonlyVec3 } from '../core/vec3.js';
import type { Orientation } from '../game/look.js';
import type { LevelDefinition } from '../game/level/levelData.js';
import type { PlayerPose } from '../game/pose.js';
import { applyAnisotropy } from './assets.js';
import { buildPlayerBody, posePlayerBody, type PlayerBody } from './playerModel.js';
import {
  buildScene,
  shadowReachFor,
  updateChunkVisibility,
  updateLamps,
  updateShadowCasters,
  type BuiltScene,
} from './sceneBuilder.js';
import { pickupPose, smokePose } from './effects.js';
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
  private readonly body: PlayerBody;
  private readonly config: GameConfig;
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
  /** How many of the level's lamps are lit this frame. */
  private lampsOn = 0;
  /** The last place the lamp selection was made for. */
  private lampCell = '';
  /** The graphics preset's share of the lamps, applied to the cap. */
  private lightScale = 1;
  /**
   * The bloom chain, when the preset asks for one.
   *
   * Built once and enabled or disabled by the preset rather than created and destroyed: a composer
   * owns render targets, and rebuilding them on every settings change is a hitch the player would
   * feel for no reason.
   */
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  /** Whether the post chain has been checked against a direct render yet. */
  private bloomVerified = false;
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
    // **The city is a night city, and ACES darkens a night city.** The tone curve rolls off the
    // highlights and pulls the mid-tones down with them, so an exposure that looks right on a grey
    // test cube leaves a cyberpunk skyline in the mud. This is the single value that decides whether
    // the neon reads; everything else here is detail.
    this.renderer.toneMappingExposure = 1.45;
    this.renderer.shadowMap.enabled = true;
    // `PCFSoftShadowMap` was removed from three.js in r186: setting it logs a warning
    // and silently falls back to `PCFShadowMap`, so the demo spent a version asking
    // for soft shadows it was not getting. `VSMShadowMap` is the soft option that is
    // left, and it bleeds light through thin geometry - which this district is made
    // of - so the honest choice is hard PCF with a shadow map sized by the graphics
    // preset, where resolution is something the player can turn up.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
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

    logger.info('render', 'view created', {
      renderer: this.rendererInfo ?? 'unknown',
      skybox: options.assets?.skybox != null,
      backdrop: this.built.backdrop !== null,
      parts: [...this.built.parts.values()].reduce((total, info) => total + info.count, 0),
      chunks: this.built.chunks.length,
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

  /**
   * The bloom chain, built against the current quality.
   *
   * `UnrealBloomPass` blurs a bright-pass at a quarter, an eighth and a sixteenth of the frame and
   * adds them back, which is what makes a sign *glow* rather than merely be bright. It is the most
   * expensive thing in the renderer by design, which is why it is the first thing a preset turns off.
   */
  private buildBloom(): void {
    const size = new THREE.Vector2();
    this.renderer.getSize(size);
    const resolution = new THREE.Vector2(
      Math.max(1, size.x * drawingRatio(this.quality)),
      Math.max(1, size.y * drawingRatio(this.quality)),
    );

    const composer = new EffectComposer(this.renderer);
    composer.addPass(new RenderPass(this.built.scene, this.camera));
    const bloom = new UnrealBloomPass(resolution, 0.7, 0.85, 0.62);
    composer.addPass(bloom);
    // The output pass is what applies the renderer's tone mapping and colour space once the frame has
    // been through a float target - without it a composer renders a linear image and everything the
    // game does with ACES is silently thrown away.
    composer.addPass(new OutputPass());
    composer.setSize(size.x, size.y);

    this.composer = composer;
    this.bloomPass = bloom;
  }

  /** Resizes the drawing buffer and camera to the given CSS pixel size. */
  setSize(width: number, height: number): void {
    if (this.disposed) return;

    const safeWidth = Math.max(1, Math.floor(width));
    const safeHeight = Math.max(1, Math.floor(height));

    this.renderer.setPixelRatio(drawingRatio(this.quality));
    this.renderer.setSize(safeWidth, safeHeight, false);
    if (!this.composer && this.quality.bloom > 0) this.buildBloom();
    this.composer?.setSize(safeWidth, safeHeight);

    this.camera.aspect = safeWidth / safeHeight;
    this.camera.updateProjectionMatrix();
  }

  /** Renders one frame from an eye position and orientation. */
  render(eye: ReadonlyVec3, orientation: Orientation): void {
    if (this.disposed) return;

    this.followWithShadow(eye);
    this.followLamps(eye);

    this.camera.position.set(eye.x, eye.y, eye.z);
    // Roll is in degrees on the way in (it comes from the settings-facing effect
    // values) and radians on the way out, which is the one conversion the renderer
    // does for the game.
    this.camera.rotation.set(orientation.pitch, orientation.yaw, ((orientation.roll ?? 0) * Math.PI) / 180);

    if (this.composer && this.bloomPass && this.bloomPass.enabled) {
      this.composer.render();
      // Once, on the first composed frame: see `verifyBloom`.
      if (!this.bloomVerified) this.verifyBloom();
      return;
    }
    this.renderer.render(this.built.scene, this.camera);
  }

  /**
   * Checks that the bloom chain actually draws something, and gives up on it if it does not.
   *
   * **A composer that renders black on this machine is a black screen for the player**, and no amount
   * of capability checking predicts it: it depends on half-float render targets, on the driver's idea
   * of them, and on things a `try`/`catch` around the constructor never sees. So the first composed
   * frame is compared against a direct render of the same scene, once, and if the chain produces
   * nothing while the plain path produces something then the chain is switched off for the session
   * and the log says why.
   *
   * It costs one extra frame at startup and one `readPixels` of nine pixels.
   */
  private verifyBloom(): void {
    this.bloomVerified = true;
    if (!this.bloomPass) return;
    try {
      const gl = this.renderer.getContext();
      const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      const x = Math.max(0, Math.floor(size.x / 2) - 1);
      const y = Math.max(0, Math.floor(size.y / 2) - 1);
      const pixels = new Uint8Array(4 * 9);
      const brightness = (): number => {
        gl.readPixels(x, y, 3, 3, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let total = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          total += (pixels[index] as number) + (pixels[index + 1] as number) + (pixels[index + 2] as number);
        }
        return total;
      };

      const composed = brightness();
      if (composed > 0) return;

      // Nothing on screen from the chain: draw the same frame the plain way and look again.
      this.renderer.render(this.built.scene, this.camera);
      if (brightness() > 0) {
        this.bloomPass.enabled = false;
        logger.warn('render', 'bloom disabled: the post chain renders black on this machine');
      }
    } catch {
      // A driver that cannot even read the frame back is a driver to keep the plain path on.
      this.bloomPass.enabled = false;
    }
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
      const gate = this.built.gates.get(`${id}-gate-${index}`);
      if (!gate) continue;
      // Only the gate at the car's own floor is up; the rest are shut.
      const height = this.gateHeights.get(`${id}-gate-${index}`) ?? 0;
      gate.position.y = index === floor ? Math.max(0, Math.min(1, doorsOpen)) * height : 0;
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
   * `elapsedSeconds` rather than a delta: smoke drifts and pickups bob, and both
   * are functions of the clock, so a frame that takes twice as long moves them
   * exactly twice as far without anything having to be integrated.
   */
  animate(elapsedSeconds: number): void {
    if (this.disposed) return;

    for (const { sprite, emitter } of this.built.smoke) {
      const pose = smokePose(emitter, elapsedSeconds);
      sprite.position.set(pose.x, pose.y, pose.z);
      sprite.scale.set(pose.scale, pose.scale, 1);
      (sprite.material as THREE.SpriteMaterial).opacity = pose.opacity;
    }

    for (const [id, group] of this.built.collectibles) {
      const home = this.pickupHome.get(id);
      if (!home) continue;
      const pose = pickupPose(home, elapsedSeconds);
      group.position.y = pose.y;
      group.rotation.y = pose.spin;
    }
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
    const cell = `${Math.round(eye.x / 24)}|${Math.round(eye.z / 24)}`;
    if (cell === this.lampCell) return;
    this.lampCell = cell;
    // **Six, not twelve.** A point light is a per-fragment loop over the whole screen, and the
    // nearest twelve of five hundred and seventy-six was still the most expensive thing in the frame.
    // Six pools of light around the player and the neon carrying the rest: the city is a neon city,
    // and it is emissive surfaces rather than lamps that make it one.
    this.lampsOn = updateLamps(this.built.lamps, eye, Math.max(3, Math.round(6 * this.lightScale)));
  }

  private followWithShadow(eye: ReadonlyVec3): void {
    const sun = this.built.sun;
    const shadow = sun.shadow;
    if (!shadow) return;

    // Cheap enough to do every frame, and it has to be: the reach changes with the
    // graphics preset, so the cell cache would have to be invalidated by it.
    this.casters = updateShadowCasters(this.built.chunks, eye, this.shadowReach);
    this.chunksDrawn = updateChunkVisibility(this.built.chunks, eye);

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
  }

  /** Sets the vertical field of view. */
  setFov(fov: number): void {
    if (this.disposed) return;
    if (!Number.isFinite(fov) || fov <= 0) return;
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

    const size = this.renderer.getSize(new THREE.Vector2());
    this.renderer.setPixelRatio(drawingRatio(preset));
    this.renderer.setSize(size.x, size.y, false);

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

    // Filtering belongs to the texture and is applied when it is uploaded.
    applyAnisotropy(this.assets, Math.min(maxAnisotropy(this.renderer), preset.anisotropy));
    applyEvenScale(this.built.smoke.length, preset.smokeScale, (index, visible) => {
      const mesh = this.built.smoke[index];
      if (mesh) mesh.sprite.visible = visible;
    });
    // The preset's share of the lamps is a *cap* now, not a fixed pattern: which ones are lit is
    // decided per frame by how close they are - see `followLamps`.
    this.lightScale = preset.lightScale;

    // The bloom is the preset's, and it is *enabled* rather than rebuilt: `strength` alone leaves the
    // three full-screen blurs running, which is the whole cost of it.
    if (preset.bloom > 0 && !this.composer) {
      const size = this.renderer.getSize(new THREE.Vector2());
      if (size.x > 0) this.buildBloom();
    }
    if (this.bloomPass) {
      this.bloomPass.enabled = preset.bloom > 0;
      this.bloomPass.strength = preset.bloom;
    }
    this.lampCell = '';

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

    this.composer?.dispose();
    this.composer = null;
    this.bloomPass = null;
    this.body.dispose();
    this.built.dispose();
    this.renderer.setAnimationLoop(null);
    this.renderer.dispose();
    // Frees the context immediately instead of waiting for GC, which matters
    // because browsers cap the number of live WebGL contexts.
    this.renderer.forceContextLoss();

    logger.info('render', 'view disposed');
  }
}


