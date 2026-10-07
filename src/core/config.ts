/**
 * Central tuning table.
 *
 * Every gameplay/physics constant lives here so that a later version can expose
 * them in a settings menu without hunting through the codebase.
 */

/** The player is approximated by an axis-aligned box. */
export interface PlayerConfig {
  /** Half-width of the player box on X/Z. */
  readonly radius: number;
  /** Box height while standing. */
  readonly standHeight: number;
  /** Box height while crouched (the V0.1 "crouch height change"). */
  readonly crouchHeight: number;
  /** Camera height above the feet while standing. */
  readonly standEyeHeight: number;
  /** Camera height above the feet while crouched. */
  readonly crouchEyeHeight: number;
  /** Target horizontal speed when walking (m/s). */
  readonly walkSpeed: number;
  /** Target horizontal speed when sprinting (m/s). */
  readonly sprintSpeed: number;
  /** Target horizontal speed when crouched (m/s). */
  readonly crouchSpeed: number;
  /** Upward velocity a jump imparts (m/s). */
  readonly jumpSpeed: number;
  /** Acceleration factor applied to the movement input (1/s), Quake-style. */
  readonly groundAcceleration: number;
  /** Weaker acceleration while airborne, so movement stays air-controllable. */
  readonly airAcceleration: number;
  /** Ground friction coefficient (1/s). */
  readonly groundFriction: number;
  /** Total speed shed per second is never below this (m/s). */
  readonly stopSpeed: number;
  /** Downward acceleration (m/s^2). Tuned for game feel, not realism. */
  readonly gravity: number;
  /** Terminal falling speed (m/s). */
  readonly maxFallSpeed: number;
  /** Highest speed the simulation will ever integrate (guards against blow-ups). */
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
   * Emergency floor. If the player ever drops below this the demo snaps them
   * back to their spawn point. Fall *death* is handled by the level's kill
   * plane; this only guarantees the demo cannot end up in the void.
   */
  readonly safetyFloorY: number;
}

export interface RespawnConfig {
  /** Seconds between the player's death and their automatic respawn. */
  readonly delaySeconds: number;
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
  readonly respawn: RespawnConfig;
  readonly camera: CameraConfig;
  readonly debug: DebugConfig;
}

export const DEFAULT_CONFIG: GameConfig = {
  player: {
    radius: 0.35,
    standHeight: 1.8,
    crouchHeight: 1.1,
    standEyeHeight: 1.65,
    crouchEyeHeight: 0.95,
    walkSpeed: 7.5,
    sprintSpeed: 11.5,
    // Crouching is a deliberate, slow shuffle rather than a stealth-walk.
    crouchSpeed: 3.8,
    // Apex is jumpSpeed^2 / (2 * gravity) = 1.0 m, which clears the 0.6 m and
    // 1.2 m ledges on the demo roof when chained.
    jumpSpeed: 7.2,
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
  respawn: {
    delaySeconds: 1.6,
  },
  camera: {
    fov: 82,
    near: 0.1,
    far: 1200,
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
