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
import type { LevelDefinition } from '../game/level/levelData.js';
import type { PlayerPose } from '../game/pose.js';
import { applyAnisotropy } from './assets.js';
import { buildPlayerBody, posePlayerBody, type PlayerBody } from './playerModel.js';
import { buildScene, type BuiltScene } from './sceneBuilder.js';
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
  private readonly pickupHome: ReadonlyMap<string, ReadonlyVec3>;
  /** Borrowed, not owned: the loader disposes them, and settings re-filter them. */
  private readonly assets: SceneAssets;
  private quality: QualityPreset = QUALITY_PRESETS.high;
  private readonly body: PlayerBody;
  private readonly config: GameConfig;
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
    this.renderer.toneMappingExposure = 1.1;
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
    this.pickupHome = new Map(
      (options.definition.collectibles ?? []).map((pickup) => [pickup.id, pickup.position] as const),
    );

    logger.info('render', 'view created', {
      renderer: this.rendererInfo ?? 'unknown',
      skybox: options.assets?.skybox != null,
      backdrop: this.built.backdrop !== null,
      parts: [...this.built.meshes.values()].reduce((total, list) => total + list.length, 0),
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

  /** Resizes the drawing buffer and camera to the given CSS pixel size. */
  setSize(width: number, height: number): void {
    if (this.disposed) return;

    const safeWidth = Math.max(1, Math.floor(width));
    const safeHeight = Math.max(1, Math.floor(height));

    this.renderer.setPixelRatio(drawingRatio(this.quality));
    this.renderer.setSize(safeWidth, safeHeight, false);

    this.camera.aspect = safeWidth / safeHeight;
    this.camera.updateProjectionMatrix();
  }

  /** Renders one frame from an eye position and orientation. */
  render(eye: ReadonlyVec3, orientation: Orientation): void {
    if (this.disposed) return;

    this.camera.position.set(eye.x, eye.y, eye.z);
    // Roll is in degrees on the way in (it comes from the settings-facing effect
    // values) and radians on the way out, which is the one conversion the renderer
    // does for the game.
    this.camera.rotation.set(orientation.pitch, orientation.yaw, ((orientation.roll ?? 0) * Math.PI) / 180);

    this.renderer.render(this.built.scene, this.camera);
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

  /** Moves a lift's car so its walking surface sits at `topY`. */
  setLift(id: string, topY: number): void {
    if (this.disposed) return;
    const group = this.built.lifts.get(id);
    const thickness = this.liftThickness.get(id);
    if (!group || thickness === undefined) return;
    group.position.y = topY - thickness;
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
  setPlayerBody(feet: ReadonlyVec3, yaw: number, pose: PlayerPose): void {
    if (this.disposed) return;
    this.body.root.position.set(feet.x, feet.y, feet.z);
    this.body.root.rotation.y = yaw;
    posePlayerBody(this.body, pose, this.config);
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
    applyEvenScale(this.built.lamps.length, preset.lightScale, (index, visible) => {
      const lamp = this.built.lamps[index];
      if (lamp) lamp.visible = visible;
    });

    logger.info('render', 'quality applied', {
      quality: preset.label,
      shadows: preset.shadows,
      shadowMapSize: preset.shadowMapSize,
      parts: [...this.built.meshes.values()].reduce((total, list) => total + list.length, 0),
    });
  }

  /** Releases the GPU context and all scene resources. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

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


