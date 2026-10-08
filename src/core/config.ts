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

/** Shared shape of the two "haul yourself up" manoeuvres. */
export interface ManeuverConfig {
  /** Seconds the move takes. */
  readonly durationSeconds: number;
  /** How far above the target the body arcs on the way up, in metres. */
  readonly arcHeight: number;
  /** How far ahead of the collision box the ledge probe looks, in metres. */
  readonly reach: number;
}

export interface MantleConfig extends ManeuverConfig {
  /** Lowest ledge a grounded mantle engages on, above the feet (m). */
  readonly minHeight: number;
  /** Highest ledge a grounded mantle can clear, above the feet (m). */
  readonly maxHeight: number;
}

export interface PullUpConfig extends ManeuverConfig {
  /** Lowest ledge an airborne player will catch, above the feet (m). */
  readonly minHeight: number;
  /** Highest ledge an airborne player can reach, above the feet (m). */
  readonly maxHeight: number;
  /** How far below the ledge top the hanging player's feet dangle, in metres. */
  readonly hangDepth: number;
  /**
   * Seconds after letting go during which the ledge cannot be grabbed again.
   * Without it, dropping off re-grabs on the very next step.
   */
  readonly releaseCooldownSeconds: number;
}

export interface ClimbConfig {
  /** Upward speed while climbing (m/s). */
  readonly speed: number;
  /** How far a face must rise above the feet before it counts as climbable (m). */
  readonly minHeight: number;
  /** How far ahead the climb probe looks (m). */
  readonly reach: number;
}

export interface SlideConfig {
  /** Speed needed to start a slide (m/s). */
  readonly minSpeed: number;
  /** Speed multiplier applied at the start of a slide. */
  readonly boost: number;
  /** Friction while sliding (1/s). Much lower than running friction. */
  readonly friction: number;
  /** A slide ends once it drops below this speed (m/s). */
  readonly endSpeed: number;
  /** How hard the player can steer a slide (m/s^2). */
  readonly steerAcceleration: number;
  /** A slide never lasts longer than this (s). */
  readonly maxSeconds: number;
}

export interface HeadBobConfig {
  /** Metres of travel per full bob cycle, by gait. */
  readonly strideLength: Readonly<{ walk: number; sprint: number; crouch: number }>;
  /** Vertical travel at full amplitude (m). */
  readonly verticalAmplitude: number;
  /** Sideways travel at full amplitude (m). */
  readonly lateralAmplitude: number;
  /** How quickly the bob fades in and out (1/s). */
  readonly settleRate: number;
}

export interface FallDamageConfig {
  readonly maxHealth: number;
  /** Impact speed that does no damage at all (m/s). */
  readonly safeImpactSpeed: number;
  /** Impact speed that costs full health (m/s). */
  readonly fatalImpactSpeed: number;
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
  readonly maneuver: {
    readonly mantle: MantleConfig;
    readonly pullUp: PullUpConfig;
    readonly climb: ClimbConfig;
    readonly slide: SlideConfig;
  };
  readonly headBob: HeadBobConfig;
  readonly fallDamage: FallDamageConfig;
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
  maneuver: {
    mantle: {
      // Ledges between waist and chest height are stepped up onto automatically;
      // anything higher needs a jump and a grab.
      minHeight: 0.4,
      maxHeight: 1.4,
      reach: 0.5,
      durationSeconds: 0.34,
      arcHeight: 0.22,
    },
    pullUp: {
      // Deliberately starts above the mantle ceiling and ends just above a jump's
      // reach, so "too high to step onto, low enough to catch" is one clean band.
      minHeight: 1.4,
      maxHeight: 2.6,
      reach: 0.5,
      hangDepth: 1.25,
      durationSeconds: 0.62,
      arcHeight: 0.3,
      releaseCooldownSeconds: 0.35,
    },
    climb: {
      speed: 2.4,
      minHeight: 1.6,
      reach: 0.45,
    },

    slide: {
      // Needs a run-up: you cannot slide out of a walk.
      minSpeed: 6.5,
      boost: 1.12,
      friction: 1.05,
      endSpeed: 2.6,
      steerAcceleration: 4,
      maxSeconds: 2.6,
    },
  },
  headBob: {
    // One bob cycle per stride, and one footstep per half stride. These are
    // metres, and the demo's locomotion is fast (7.5 m/s is 27 km/h), so the
    // strides are long: at a realistic 0.9 m step a walk would be a 4 Hz buzz
    // rather than a run. Sprint strides are longer still, so the cadence rises
    // with speed without needing a separate timer.
    strideLength: { walk: 4.2, sprint: 5.4, crouch: 2.6 },
    verticalAmplitude: 0.055,
    lateralAmplitude: 0.032,
    settleRate: 9,
  },
  fallDamage: {
    maxHealth: 100,
    // ~3 m under this gravity. Landing from the deck's own height never hurts.
    safeImpactSpeed: 12,
    // ~13 m: a fall from the penthouse roof is survivable, from the mast is not.
    fatalImpactSpeed: 26,
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
