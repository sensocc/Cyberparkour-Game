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
import { buildScene, type BuiltScene } from './sceneBuilder.js';
import { pickupPose, smokePose } from './effects.js';
import { GraphicsUnavailableError, NO_ASSETS, type GameViewLike, type SceneAssets } from './types.js';

export { GraphicsUnavailableError };
export type { GameViewLike };

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

    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(new THREE.Color(options.definition.environment.skyColor), 1);

    this.camera = new THREE.PerspectiveCamera(
      options.config.camera.fov,
      1,
      options.config.camera.near,
      options.config.camera.far,
    );
    // YXZ keeps yaw and pitch independent, which is what stops the view from
    // rolling as the player turns.
    this.camera.rotation.order = 'YXZ';

    this.built = buildScene(options.definition, options.assets ?? NO_ASSETS);
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

    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
    this.renderer.setSize(safeWidth, safeHeight, false);

    this.camera.aspect = safeWidth / safeHeight;
    this.camera.updateProjectionMatrix();
  }

  /** Renders one frame from an eye position and orientation. */
  render(eye: ReadonlyVec3, orientation: Orientation): void {
    if (this.disposed) return;

    this.camera.position.set(eye.x, eye.y, eye.z);
    this.camera.rotation.set(orientation.pitch, orientation.yaw, 0);

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

  /** Releases the GPU context and all scene resources. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.built.dispose();
    this.renderer.setAnimationLoop(null);
    this.renderer.dispose();
    // Frees the context immediately instead of waiting for GC, which matters
    // because browsers cap the number of live WebGL contexts.
    this.renderer.forceContextLoss();

    logger.info('render', 'view disposed');
  }
}


