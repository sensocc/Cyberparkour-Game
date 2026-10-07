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
import type { ReadonlyVec3 } from '../core/vec3.js';
import type { Orientation } from '../game/look.js';
import type { LevelDefinition } from '../game/level/levelData.js';
import { buildScene, type BuiltScene } from './sceneBuilder.js';
import { GraphicsUnavailableError, type GameViewLike } from './types.js';

export { GraphicsUnavailableError };
export type { GameViewLike };

export interface GameViewOptions {
  readonly canvas: HTMLCanvasElement;
  readonly definition: LevelDefinition;
  readonly config: GameConfig;
}

export class GameView implements GameViewLike {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly built: BuiltScene;
  private readonly camera: THREE.PerspectiveCamera;
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

    this.built = buildScene(options.definition);

    logger.info('render', 'view created', { renderer: this.rendererInfo ?? 'unknown' });
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


