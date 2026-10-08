/**
 * Renderer-facing contracts.
 *
 * The three.js import here is **type-only**, so it is erased at compile time:
 * the game orchestration layer depends on an interface, not on the renderer. A
 * test (or a future headless renderer) can supply its own implementation
 * without pulling WebGL in.
 */

import type { CubeTexture, Texture } from 'three';

import type { GameConfig } from '../core/config.js';
import type { ReadonlyVec3 } from '../core/vec3.js';
import type { Orientation } from '../game/look.js';
import type { LevelDefinition } from '../game/level/levelData.js';
import type { SurfaceTextureId } from '../game/level/surfaces.js';

/**
 * Textures the scene needs.
 *
 * Every one is optional: a texture that failed to load degrades to a flat
 * colour rather than stopping the demo.
 */
export interface SceneAssets {
  /** Night skyline painted around the level. */
  readonly cityBackdrop: Texture | null;
  /** Six-face cube skybox. */
  readonly skybox: CubeTexture | null;
  /** Tileable object surfaces, keyed by texture id. */
  readonly surfaces: ReadonlyMap<SurfaceTextureId, Texture>;
  /** The soft puff the smoke plumes are built from. */
  readonly smoke: Texture | null;
}

export const NO_ASSETS: SceneAssets = {
  cityBackdrop: null,
  skybox: null,
  surfaces: new Map(),
  smoke: null,
};

/** Everything the game needs from a renderer. */
export interface GameViewLike {
  /** GPU description, used by the debug HUD and crash reports. */
  readonly rendererInfo: string | null;
  /** Resizes the drawing buffer to a CSS pixel size. */
  setSize(width: number, height: number): void;
  /** Draws one frame from an eye position and orientation. */
  render(eye: ReadonlyVec3, orientation: Orientation): void;
  /**
   * Swings a door to a fraction of its opening: 0 closed, 1 fully open.
   *
   * Unknown ids are ignored, so the game can drive doors without checking that
   * the renderer knows about them.
   */
  setDoorOpen(id: string, open: number): void;
  /** Moves a lift so its walking surface sits at `topY` (m). */
  setLift(id: string, topY: number): void;
  /** Shows or hides a pickup, which is gone once it has been taken. */
  setCollectibleVisible(id: string, visible: boolean): void;
  /**
   * Advances purely visual animation - drifting smoke, spinning pickups.
   *
   * `elapsedSeconds` rather than a delta, so the effect is a function of the
   * clock and a dropped frame cannot accumulate drift.
   */
  animate(elapsedSeconds: number): void;
  /** Releases every GPU resource. */
  dispose(): void;
}

/** Creates a view for a freshly created canvas. */
export type CreateView = (
  canvas: HTMLCanvasElement,
  definition: LevelDefinition,
  config: GameConfig,
) => GameViewLike;

/** Thrown when the browser cannot give us a WebGL context. */
export class GraphicsUnavailableError extends Error {
  override readonly name = 'GraphicsUnavailableError';

  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
  }
}
