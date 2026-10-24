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
import type { QualityPreset } from '../core/settings.js';
import type { ReadonlyVec3 } from '../core/vec3.js';
import type { Orientation } from '../game/look.js';
import type { PlayerPose } from '../game/pose.js';
import type { GltfPropModelId, LevelDefinition } from '../game/level/levelData.js';
import type { SurfaceTextureId } from '../game/level/surfaces.js';
import type { PropModel } from './propModels.js';

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
  /**
   * Imported GLTF prop models, keyed by id.
   *
   * Like the textures, a missing model is not a failure: the scene builder falls
   * back to the prop's ordinary box parts.
   */
  readonly props: ReadonlyMap<GltfPropModelId, PropModel>;
}

export const NO_ASSETS: SceneAssets = {
  cityBackdrop: null,
  skybox: null,
  surfaces: new Map(),
  smoke: null,
  props: new Map(),
};

/** Everything the game needs from a renderer. */
export interface GameViewLike {
  /**
   * What the last frame asked the GPU to do. Optional: the tests' stand-in view has no GPU to
   * account for, and a diagnostic must not be a requirement.
   */
  readonly renderStats?: {
    readonly calls: number;
    readonly triangles: number;
    readonly programs: number;
    readonly objects?: number;
    readonly chunksDrawn?: number;
    readonly chunksTotal?: number;
    readonly movingDrawn?: number;
    readonly movingTotal?: number;
    /** Ratio of drawing-buffer pixels to CSS pixels actually in use, adaptation included. */
    readonly pixelRatio?: number;
  };

  /** GPU description, used by the debug HUD and crash reports. */
  readonly rendererInfo: string | null;
  /** Resizes the drawing buffer to a CSS pixel size. */
  setSize(width: number, height: number): void;
  /**
   * Scales the drawing buffer against the preset's cap, 0.6..1.
   *
   * This is the dial dynamic resolution turns: 1 is the preset's own resolution, 0.8 is eighty per
   * cent of it per axis. It exists on the interface because the *game* owns the frame statistics
   * that decide when to turn it, and the view owns the renderer that obeys.
   */
  setRenderScale(scale: number): void;
  /** Draws one frame from an eye position and orientation. */
  render(eye: ReadonlyVec3, orientation: Orientation): void;
  /**
   * Swings a door to a fraction of its opening: 0 closed, 1 fully open.
   *
   * Unknown ids are ignored, so the game can drive doors without checking that
   * the renderer knows about them.
   */
  setDoorOpen(id: string, open: number): void;
  /**
   * Places an elevator car, and slides its gates.
   *
   * One call rather than two because they are one fact: a car is at a height and its
   * gates are as open as `doorsOpen` says. A gate that lags its car by a frame is a
   * gate you can see through at the wrong moment.
   */
  setElevator(id: string, topY: number, floor: number, doorsOpen: number): void;
  /** Shows or hides a pickup, which is gone once it has been taken. */
  setCollectibleVisible(id: string, visible: boolean): void;
  /**
   * Advances purely visual animation - drifting smoke, spinning pickups, landing dust.
   *
   * `elapsedSeconds` rather than a delta, so the effect is a function of the
   * clock and a dropped frame cannot accumulate drift. `deltaSeconds` is passed as well for the
   * one exception - impact dust, which is integrated rather than sampled, and which must be aged by
   * *simulated* time so that pausing the game pauses the dust with it.
   */
  animate(elapsedSeconds: number, deltaSeconds: number): void;
  /**
   * Places and poses the player's body.
   *
   * The body is in the world, not attached to the camera: it casts a shadow and it
   * stays where the player is, which is what makes looking down at your own feet
   * work. `feet` is the *interpolated* foot position, so the body does not jitter
   * against the camera at a refresh rate the simulation does not share.
   */
  setPlayerBody(feet: ReadonlyVec3, yaw: number, pose: PlayerPose, dt: number): void;
  /**
   * Throws a burst of dust up from a landing, at a point.
   *
   * Optional: a stand-in view has nothing to throw dust with, and a missing effect must not be a
   * reason a landing fails. The game calls this when it *knows* an impact happened - which only the
   * simulation does - so the view never has to guess.
   */
  burstDust?(x: number, y: number, z: number, strength: number, spread: number): void;
  /** Kills any live dust, for a respawn or a restart. */
  clearDust?(): void;
  /**
   * Sets the vertical field of view, in degrees.
   *
   * A setting rather than a constructor argument: the player can change it from the
   * settings screen, and the projection matrix has to follow without a restart.
   */
  setFov(fov: number): void;
  /**
   * Applies a graphics preset.
   *
   * Every knob a preset owns - drawing-buffer scale, shadows, shadow resolution,
   * texture filtering, how much smoke and how many lamps survive - is set from the
   * one object, so "low" cannot mean five different things in five files.
   */
  setQuality(preset: QualityPreset): void;
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
