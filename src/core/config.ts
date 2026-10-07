/**
 * Central tuning table for the V0.0 Technical Demo.
 *
 * Every gameplay/physics constant lives here so that later versions can expose
 * them in a settings menu without hunting through the codebase.
 */

/** Player capsule approximated as an axis-aligned box (V0.0 uses AABB collision). */
export interface PlayerConfig {
  /** Half-width of the player box on X/Z. */
  readonly radius: number;
  /** Total height of the player box. */
  readonly height: number;
  /** Camera height above the player's feet. */
  readonly eyeHeight: number;
  /** Target horizontal speed for plain walking (m/s). */
  readonly walkSpeed: number;
  /** Acceleration factor applied to the walk input (1/s), Quake-style. */
  readonly groundAcceleration: number;
  /** Weaker acceleration while airborne, so movement stays air-controllable. */
  readonly airAcceleration: number;
  /** Ground friction coefficient (1/s). */
  readonly groundFriction: number;
  /** Friction never drops the speed below this value in one step (m/s). */
  readonly stopSpeed: number;
  /** Downward acceleration (m/s^2). Tuned for game feel, not realism. */
  readonly gravity: number;
  /** Terminal falling speed (m/s). */
  readonly maxFallSpeed: number;
  /** Highest speed the simulation will ever integrate (guards against NaN/blowups). */
  readonly maxSpeed: number;
}

export interface WorldConfig {
  /** Physics steps per second. */
  readonly tickRate: number;
  /** Maximum physics steps simulated per rendered frame (spiral-of-death guard). */
  readonly maxSubSteps: number;
  /** Largest delta the loop will ever hand to the simulation, in seconds. */
  readonly maxFrameDelta: number;
  /** Maximum distance the collision solver moves the player per sub-step (m). */
  readonly maxCollisionSubStep: number;
  /**
   * Emergency floor: if the player's feet ever drop below this Y the demo
   * snaps them back and logs a warning. V0.0 has no fall-death or respawn
   * system (those arrive in V0.1) - this only prevents an endless fall off
   * the demo geometry.
   */
  readonly safetyFloorY: number;
}

export interface CameraConfig {
  /** Vertical field of view, in degrees. */
  readonly fov: number;
  readonly near: number;
  readonly far: number;
  /** Radians of rotation per pixel of mouse movement. */
  readonly sensitivity: number;
  /** How close to straight up/down the camera may look (radians). */
  readonly maxPitch: number;
}

export interface DebugConfig {
  /** Debug HUD refresh rate (Hz) - keeps the DOM out of the frame budget. */
  readonly hudRefreshHz: number;
  /** Sliding window length used by the FPS counter. */
  readonly fpsSampleCount: number;
}

export interface GameConfig {
  readonly player: PlayerConfig;
  readonly world: WorldConfig;
  readonly camera: CameraConfig;
  readonly debug: DebugConfig;
}

export const DEFAULT_CONFIG: GameConfig = {
  player: {
    radius: 0.35,
    height: 1.8,
    eyeHeight: 1.65,
    walkSpeed: 7.5,
    groundAcceleration: 11,
    airAcceleration: 2.5,
    groundFriction: 9,
    stopSpeed: 4,
    gravity: 26,
    maxFallSpeed: 60,
    maxSpeed: 80,
  },
  world: {
    tickRate: 60,
    maxSubSteps: 5,
    maxFrameDelta: 0.25,
    maxCollisionSubStep: 0.2,
    safetyFloorY: -250,
  },
  camera: {
    fov: 82,
    near: 0.05,
    far: 1000,
    sensitivity: 0.0022,
    maxPitch: (89 * Math.PI) / 180,
  },
  debug: {
    hudRefreshHz: 10,
    fpsSampleCount: 120,
  },
};

/** Fixed simulation step, in seconds. */
export function fixedStep(config: GameConfig): number {
  return 1 / config.world.tickRate;
}
