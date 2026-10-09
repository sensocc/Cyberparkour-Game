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

/**
 * Feel: the timing windows that make an input forgiving.
 *
 * Neither of these is visible in the world - they are both about the gap between
 * what the player pressed and what the simulation could know. A player who pressed
 * jump a tenth of a second before touching down pressed it *on purpose*, and a
 * game that answers "too early, nothing happens" is a game that feels broken
 * rather than exact.
 */
export interface FeelConfig {
  /** Seconds after walking off an edge during which a jump still counts (s). */
  readonly coyoteSeconds: number;
  /** Seconds a jump press is remembered while airborne (s). */
  readonly jumpBufferSeconds: number;
}

/**
 * Camera effects: what the view does in response to what the body is doing.
 *
 * All three are deliberately small numbers. The camera is the player's entire view
 * of the world, so these are the difference between "you can feel the speed" and
 * "the screen is wobbling" - and everything here is scaled by the player's Camera
 * motion setting, which can take it to zero.
 */
export interface CameraEffectsConfig {
  /** Extra field of view at full speed, in degrees. */
  readonly speedFov: number;
  /** Extra field of view while crouched, in degrees (negative narrows it). */
  readonly crouchFov: number;
  /** How quickly the field of view approaches its target (1/s). */
  readonly fovApproach: number;
  /** Degrees of view roll at full speed during a slide (degrees). */
  readonly slideRoll: number;
  /** Degrees of roll while wall running (degrees). */
  readonly wallRunRoll: number;
  /** How far the camera drops on a maximum-speed landing (m). */
  readonly landingDip: number;
  /** How quickly a landing dip springs back (1/s). */
  readonly landingRecover: number;
  /** Degrees of shake at a maximum-speed landing (degrees). */
  readonly landingShake: number;
  /** How quickly shake dies away (1/s). */
  readonly shakeDecay: number;
  /** Metres the camera moves with a full-strength shake (m). */
  readonly shakeReach: number;
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

/**
 * Pipe climbing.
 *
 * A pipe is the two-way cousin of a climbable face: you can go *down* it as well
 * as up, and going down is a controlled slide rather than a climb. That is the
 * whole reason it is a separate ability - a face you can only ascend is a
 * staircase, but a pipe is a decision about which way to travel.
 */
export interface PipeConfig {
  /** Upward speed while climbing a pipe (m/s). */
  readonly climbSpeed: number;
  /** Downward speed while sliding one (m/s). Faster than climbing, on purpose. */
  readonly slideSpeed: number;
  /** How far ahead the grab probe looks (m). */
  readonly reach: number;
  /** How far a pipe must rise above the feet before it can be grabbed (m). */
  readonly minHeight: number;
  /** Seconds before the same pipe can be grabbed again after letting go. */
  readonly releaseCooldownSeconds: number;
  /** Horizontal speed of a jump off a pipe (m/s). */
  readonly kickSpeed: number;
  /** Upward speed of that jump (m/s). */
  readonly kickUpSpeed: number;
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

export interface WallRunConfig {
  /** Horizontal speed needed to attach to a wall (m/s). */
  readonly minSpeed: number;
  /** Longest a single wall run can last (s). */
  readonly maxSeconds: number;
  /** Gravity multiplier while running a wall. */
  readonly gravityScale: number;
  /** Acceleration pushing the player into the wall, so contact is kept (m/s^2). */
  readonly stickAcceleration: number;
  /** Fraction of horizontal speed lost per second while wall-running (1/s). */
  readonly speedDecay: number;
  /** How far to the side to look for a wall (m). */
  readonly reach: number;
  /** A wall only counts if its top rises this far above the feet (m). */
  readonly minHeight: number;
  /**
   * Seconds the wall just left is refused, when a run ends on its own.
   *
   * Without this the run would simply start again on the next step and the
   * duration limit would mean nothing: a player could hold forward against one
   * wall and stay up forever. Short, because running a long wall and dropping
   * back onto it on purpose is legitimate.
   */
  readonly reattachCooldownSeconds: number;
}

export interface WallJumpConfig {
  /** Speed pushed away from the wall (m/s). */
  readonly outwardSpeed: number;
  /** Upward speed given by the jump (m/s). */
  readonly upwardSpeed: number;
  /** Fraction of the along-wall speed kept through the jump. */
  readonly keepSpeed: number;
  /**
   * Seconds before the *same* wall can be attached to again.
   *
   * Longer than the jump's own airtime on purpose: that is what stops a player
   * from holding jump against one wall and climbing it, while leaving a second
   * wall immediately available so two facing walls can still be chained.
   */
  readonly lockoutSeconds: number;
}

export interface RollConfig {
  /** Impact speed at which a landing can be rolled off (m/s). */
  readonly minImpact: number;
  readonly durationSeconds: number;
  /** How far the roll carries the player (m). */
  readonly distance: number;
  /** Shortest roll worth doing, when the full distance is blocked (m). */
  readonly minDistance: number;
  /**
   * Fraction of the fall damage still taken when an impact is rolled.
   *
   * A roll is the reward for a well-timed landing, not an immunity: it turns a
   * fatal drop into a survivable one and a survivable one into a scratch.
   */
  readonly damageFraction: number;
  /** Speed the roll leaves the player with (m/s). */
  readonly exitSpeed: number;
}

export interface VaultConfig {
  /** Lowest obstacle top that can be vaulted, above the feet (m). */
  readonly minHeight: number;
  /** Highest obstacle top that can be vaulted, above the feet (m). */
  readonly maxHeight: number;
  /** How far ahead of the box to look (m). */
  readonly reach: number;
  /** Deepest obstacle that can be crossed (m). Anything wider is a wall. */
  readonly maxDepth: number;
  /** How far past the obstacle's near face the player lands (m). */
  readonly landingGap: number;
  /** How far below the landing spot the ground may be (m). */
  readonly supportDepth: number;
  readonly vault: {
    /** Entry speed needed (m/s). */
    readonly minSpeed: number;
    readonly durationSeconds: number;
    /** Fraction of the entry speed kept on landing. */
    readonly speedRetention: number;
    /** How far above the obstacle the body clears it (m). */
    readonly clearance: number;
  };
  /**
   * The Kong vault: a diving vault off a sprint.
   *
   * Same obstacle band, but it needs real speed, travels further, clears the
   * obstacle lower (it is a dive, not a hop) and - the point of it - keeps far
   * more of its speed, so it is how a route stays fast.
   */
  readonly kong: {
    readonly minSpeed: number;
    readonly durationSeconds: number;
    /** Extra travel compared with a plain vault (m). */
    readonly distanceBonus: number;
    readonly speedRetention: number;
    readonly clearance: number;
  };
}

export interface CheckpointConfig {
  /** How close the player must pass, horizontally (m). */
  readonly radius: number;
  /** How far above or below a checkpoint still counts (m). */
  readonly heightTolerance: number;
}

/**
 * Lifts.
 *
 * A lift is the one piece of geometry that moves under its own power, so its
 * numbers are about *patience* rather than speed: a slow lift with a long dwell
 * is a place to stand and look around, and a fast one is a ride.
 */
export interface ElevatorConfig {
  /** Seconds a lift waits at each end before it starts back (s). */
  readonly dwellSeconds: number;
  /** Travel speed while moving (m/s). */
  readonly speed: number;
}

/** Pickups: how close the player has to pass to take one. */
export interface CollectibleConfig {
  readonly radius: number;
  readonly heightTolerance: number;
}

/** The finishing line, and how close counts as crossing it. */
export interface GoalConfig {
  readonly radius: number;
  readonly heightTolerance: number;
}

export interface HeadBobConfig {
  /** Metres of travel per full bob cycle, by gait. */
  readonly strideLength: Readonly<{ walk: number; sprint: number; crouch: number }>;
  /** Vertical travel at full amplitude (m). */
  readonly verticalAmplitude: number;
  /** Sideways travel at full amplitude (m). */
  readonly lateralAmplitude: number;
  /** How quickly the bob fades in and out (1/s). Smaller is gentler. */
  readonly settleRate: number;
  /**
   * Amplitude multiplier once the player is at sprint speed.
   *
   * The bob's *frequency* rises with speed, so a constant amplitude means the
   * camera moves faster and faster the quicker you go - which is what made
   * sprinting feel like being shaken. Scaling the amplitude down with speed keeps
   * the perceived shake roughly constant.
   */
  readonly speedFalloff: number;
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
    readonly pipe: PipeConfig;
    readonly slide: SlideConfig;
    readonly wallRun: WallRunConfig;
    readonly wallJump: WallJumpConfig;
    readonly roll: RollConfig;
    readonly vault: VaultConfig;
  };
  readonly checkpoint: CheckpointConfig;
  readonly elevator: ElevatorConfig;
  readonly collectible: CollectibleConfig;
  readonly goal: GoalConfig;
  readonly headBob: HeadBobConfig;
  readonly feel: FeelConfig;
  readonly cameraEffects: CameraEffectsConfig;
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

    pipe: {
      // A little faster than a face climb, because a pipe is the route that is
      // *meant* to be climbed, and the descent is a genuine slide: nearly three
      // times the speed, which is what makes dropping down a pipe a move rather
      // than a hand-over-hand crawl.
      climbSpeed: 3.4,
      slideSpeed: 9.5,
      reach: 0.5,
      minHeight: 1.2,
      releaseCooldownSeconds: 0.3,
      // A hop off the pipe: out and up, so leaving it keeps the height gained.
      kickSpeed: 4.5,
      kickUpSpeed: 5.6,
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

    wallRun: {
      // A run-up, but a shorter one than a slide needs: leaving a wall jump is
      // often slower than a run, and it should still be possible to re-attach.
      minSpeed: 6,
      maxSeconds: 1.5,
      // Low enough that a wall run clearly fights gravity, high enough that it
      // does not simply hang: 0.16g gives about a 6 m drop over the full run.
      gravityScale: 0.16,
      stickAcceleration: 14,
      speedDecay: 0.15,
      reach: 0.55,
      minHeight: 1.6,
      reattachCooldownSeconds: 0.35,
    },
    wallJump: {
      outwardSpeed: 6.4,
      // Higher than a standing jump, so a wall jump gains height.
      upwardSpeed: 7.8,
      keepSpeed: 0.92,
      lockoutSeconds: 0.55,
    },
    roll: {
      // Below this a roll is pointless; above it, it is the difference between
      // walking away and dying.
      minImpact: 13,
      durationSeconds: 0.5,
      distance: 3.4,
      minDistance: 0.9,
      damageFraction: 0.25,
      exitSpeed: 3.5,
    },
    vault: {
      // Starts where the mantle band ends, so "waist high" is unambiguous: a
      // low obstacle is stepped onto, a waist-high one is crossed.
      minHeight: 0.5,
      maxHeight: 1.15,
      reach: 0.6,
      // Wide obstacles are climbed onto, thin ones are crossed. Without this a
      // crate would be vaulted and a rail mantled, which is exactly backwards.
      maxDepth: 1.1,
      landingGap: 1.7,
      supportDepth: 0.7,
      vault: {
        minSpeed: 7,
        durationSeconds: 0.44,
        speedRetention: 0.62,
        clearance: 0.12,
      },
      kong: {
        // A sprint, so a Kong vault is something you have to wind up for.
        minSpeed: 9.5,
        durationSeconds: 0.52,
        distanceBonus: 1.3,
        // Nearly all of it: that is what makes the Kong vault worth the risk.
        speedRetention: 0.92,
        clearance: 0.04,
      },
    },
  },
  checkpoint: {
    // Generous, because a checkpoint is a kindness rather than a challenge, and
    // a route should not be lost to a near miss.
    radius: 3,
    heightTolerance: 2.5,
  },
  elevator: {
    // Slow, with a real pause at each end: a lift is where the route stops being
    // about momentum for a moment, and a rider should be able to look around.
    dwellSeconds: 2.4,
    speed: 3.2,
  },
  collectible: {
    // Tighter than a checkpoint: a pickup is a *thing to get*, so it should feel
    // taken rather than merely passed.
    radius: 1.3,
    heightTolerance: 1.6,
  },
  goal: {
    // Forgiving: crossing the line is the point, and a near miss at the end of a
    // run would be cruel.
    radius: 2.6,
    heightTolerance: 2.5,
  },
  headBob: {
    // One bob cycle per stride, and one footstep per half stride. These are
    // metres, and the demo's locomotion is fast (7.5 m/s is 27 km/h), so the
    // strides are long: at a realistic 0.9 m step a walk would be a 4 Hz buzz
    // rather than a run. Sprint strides are longer still, so the cadence rises
    // with speed without needing a separate timer.
    // Lengthened in V0.6.1, which slows the cadence by about a fifth: one leg cycle
    // per 6.4 m at a walk is 1.2 Hz rather than 1.5, and at sprint speed the legs stop
    // reading as a scuttle. The camera's bob rides the same stride, so this is also
    // what calmed the last of the head movement.
    strideLength: { walk: 6.4, sprint: 8.6, crouch: 3.8 },
    // Softened again in 0.5.1, to roughly half what 0.3 settled on. The camera is
    // the player's whole view of the world, and a bob the eye has to *track* stops
    // being atmosphere and becomes noise - especially on the works level, where
    // long drops to a narrow deck are the point of the route. What is left is a
    // 3.4 cm rise and fall at a walk (1.9 cm at a sprint), which the eye reads as
    // weight rather than as the screen moving.
    verticalAmplitude: 0.017,
    lateralAmplitude: 0.008,
    // A slow fade in and out: at 9/s the bob snapped on and off the moment you
    // started or stopped, which read as a jolt on top of the bob itself.
    settleRate: 3.2,
    speedFalloff: 0.45,
  },
  feel: {
    // Twelve hundredths of a second is about the length of a human's "oops" - long
    // enough to cover a player who was watching their feet rather than the edge,
    // short enough that it never looks like flight.
    coyoteSeconds: 0.12,
    // The other half of the same idea: press jump too early and the game holds it
    // until there is something to jump from.
    jumpBufferSeconds: 0.15,
  },
  cameraEffects: {
    speedFov: 4.5,
    crouchFov: -3,
    fovApproach: 6,
    slideRoll: 3.2,
    wallRunRoll: 5.5,
    landingDip: 0.11,
    landingRecover: 9,
    landingShake: 1.1,
    shakeDecay: 7.5,
    shakeReach: 0.035,
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

/**
 * The config with the camera's motion effects scaled.
 *
 * The head bob is a *config* value read by the step and the render path, so scaling
 * the amplitudes here is what makes the "Camera motion" setting a real setting
 * rather than a flag the bob has to check. `1` returns the same object, so nothing
 * that never changes the setting pays for a copy.
 */
export function withMotionScale(config: GameConfig, scale: number): GameConfig {
  if (!(scale >= 0) || scale === 1) return config;
  return {
    ...config,
    headBob: {
      ...config.headBob,
      verticalAmplitude: config.headBob.verticalAmplitude * scale,
      lateralAmplitude: config.headBob.lateralAmplitude * scale,
    },
  };
}
