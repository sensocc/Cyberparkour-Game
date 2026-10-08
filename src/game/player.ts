/**
 * Player state and movement.
 *
 * V0.1 had one movement mode. V0.2 has six, and rather than a formal state
 * machine they are resolved by a priority chain at the top of `stepPlayer`:
 *
 *   dead -> mantling -> hanging -> climbing -> sliding -> ordinary locomotion
 *
 * A manoeuvre in progress owns the player completely - input is ignored while
 * mantling, because the body is mid-move and being able to steer out of it would
 * let the player end up inside geometry. Manoeuvres therefore report when they
 * *start* and *end* through the step outcome, which is what the audio and the HUD
 * key off.
 *
 * Everything here is deterministic and free of the browser, so the whole
 * locomotion model is testable headlessly.
 */

import type { GameConfig, PlayerConfig, SlideConfig } from '../core/config.js';
import { clamp, damp } from '../core/math.js';
import {
  applySafetyFloor,
  clampSpeed,
  COLLISION_SKIN,
  createMoveResult,
  playerBox,
  type CollisionWorld,
  type MoveResult,
} from './physics/collision.js';
import { findClimbable, findLedge, landingFeet } from './physics/ledges.js';
import {
  copyVec3,
  lerpVec3,
  lengthXZ,
  vec3,
  yawBasis,
  type ReadonlyVec3,
  type Vec3,
} from '../core/vec3.js';
import type { SpawnPoint } from './level/levelData.js';

/** Movement intent for one step. */
export interface MoveInput {
  /** +1 forward, -1 backward. */
  readonly forward: number;
  /** +1 right, -1 left. */
  readonly right: number;
  /** Hold to run. Ignored while crouched or sliding. */
  readonly sprint: boolean;
  /** Hold to jump; only takes effect from the ground, or as a pull-up while hanging. */
  readonly jump: boolean;
  /** Hold to crouch; releasing only stands up if there is headroom. */
  readonly crouch: boolean;
}

export const NO_INPUT: MoveInput = {
  forward: 0,
  right: 0,
  sprint: false,
  jump: false,
  crouch: false,
};

/** What the player is doing, for the HUD and for tests. */
export type Locomotion =
  | 'grounded'
  | 'airborne'
  | 'mantling'
  | 'pulling-up'
  | 'hanging'
  | 'climbing'
  | 'sliding'
  | 'dead';

export type Stance = 'standing' | 'crouched';

/** Why the player died. */
export type DeathCause = 'fell' | 'impact';

/** One of the discrete moves, as reported to the audio director. */
export type ManeuverKind = 'mantle' | 'pull-up' | 'climb' | 'slide' | 'hang';

/** A scripted move from one position to another. */
export interface ManeuverMove {
  elapsed: number;
  readonly durationSeconds: number;
  readonly from: Vec3;
  readonly to: Vec3;
  readonly arcHeight: number;
  /** True when the move began from a hang, which changes its speed and sound. */
  readonly fromHang: boolean;
}

export interface PlayerState {
  /** Centre of the bottom face of the player box (their feet). */
  position: Vec3;
  /** Feet position at the start of the latest simulation step (for interpolation). */
  previousPosition: Vec3;
  velocity: Vec3;
  /** Facing, in radians. */
  yaw: number;
  /** Camera pitch, in radians. */
  pitch: number;
  grounded: boolean;
  /** Id of the collider the player is standing on, if any. */
  groundId: string | null;
  /** True while the player is crouched. */
  crouching: boolean;
  alive: boolean;
  /** Seconds since the player died; drives the respawn delay. */
  deadFor: number;
  deaths: number;
  deathCause: DeathCause | null;
  health: number;
  sliding: boolean;
  /** Seconds spent sliding, so a slide cannot last forever. */
  slideElapsed: number;
  /** Collider the player is hanging from, if any. */
  hangId: string | null;
  /** Direction the player faced when they grabbed. */
  hangDirection: Vec3;
  /** Seconds until the same ledge can be grabbed again. */
  grabCooldown: number;
  /**
   * Whether the jump key was already down when the player grabbed a ledge.
   *
   * Without this, the jump press that got you to the ledge would also trigger the
   * pull-up on the very next step and the hang would never be visible: you would
   * have to release and press again, which is what makes grabbing feel like
   * grabbing.
   */
  jumpLatch: boolean;
  /** Collider being climbed, if any. */
  climbId: string | null;
  /** In-progress scripted move, if any. */
  maneuver: ManeuverMove | null;
  /** Deepest downward speed since leaving the ground, for fall damage. */
  peakFallSpeed: number;
  /** Head-bob phase in radians, advanced by distance travelled. */
  bobPhase: number;
  /** Head-bob amplitude multiplier, 0..1, faded in and out. */
  bobAmount: number;
  /** Where `respawnPlayer` sends the player back to. */
  readonly spawn: { position: Vec3; yaw: number; pitch: number };
}

export interface PlayerStepOptions {
  readonly world: CollisionWorld;
  readonly config: PlayerConfig;
  /** The manoeuvre, head-bob and fall-damage tuning. */
  readonly game: Pick<GameConfig, 'maneuver' | 'headBob' | 'fallDamage'>;
  /** Ids of colliders that can be climbed. */
  readonly climbableIds?: ReadonlySet<string>;
  /** Fall detection: the Y at or below which the player dies. */
  readonly killPlaneY?: number;
  /** Seconds between death and the automatic respawn. */
  readonly respawnDelaySeconds?: number;
  /** Emergency anti-void floor. Set to `-Infinity` to disable. */
  readonly safetyFloorY?: number;
}

export interface Landing {
  /** Impact speed, in m/s. */
  readonly impact: number;
  /** Health lost. */
  readonly damage: number;
}

export interface PlayerStepOutcome {
  readonly move: MoveResult;
  readonly died: boolean;
  readonly respawned: boolean;
  /** Set on the step the player landed after being airborne. */
  readonly landing: Landing | null;
  /** Set on the step a manoeuvre began. */
  readonly started: ManeuverKind | null;
  /** Set on the step a manoeuvre finished. */
  readonly ended: ManeuverKind | null;
}

function outcome(
  move: MoveResult,
  extra: {
    died?: boolean;
    respawned?: boolean;
    landing?: Landing | null;
    started?: ManeuverKind | null;
    ended?: ManeuverKind | null;
  } = {},
): PlayerStepOutcome {
  return {
    move,
    died: extra.died ?? false,
    respawned: extra.respawned ?? false,
    landing: extra.landing ?? null,
    started: extra.started ?? null,
    ended: extra.ended ?? null,
  };
}

export function createPlayerState(spawn: SpawnPoint, config: GameConfig): PlayerState {
  const spawnPosition = vec3(spawn.position.x, spawn.position.y, spawn.position.z);
  const state: PlayerState = {
    position: vec3(spawnPosition.x, spawnPosition.y, spawnPosition.z),
    previousPosition: vec3(spawnPosition.x, spawnPosition.y, spawnPosition.z),
    velocity: vec3(0, 0, 0),
    yaw: spawn.yaw,
    pitch: spawn.pitch,
    grounded: false,
    groundId: null,
    crouching: false,
    alive: true,
    deadFor: 0,
    deaths: 0,
    deathCause: null,
    health: config.fallDamage.maxHealth,
    sliding: false,
    slideElapsed: 0,
    hangId: null,
    hangDirection: vec3(0, 0, -1),
    grabCooldown: 0,
    jumpLatch: false,
    climbId: null,
    maneuver: null,
    peakFallSpeed: 0,
    bobPhase: 0,
    bobAmount: 0,
    spawn: { position: spawnPosition, yaw: spawn.yaw, pitch: spawn.pitch },
  };
  return state;
}

// ------------------------------------------------------------------ queries

export function playerHeight(state: PlayerState, config: PlayerConfig): number {
  return state.crouching ? config.crouchHeight : config.standHeight;
}

export function eyeHeight(state: PlayerState, config: PlayerConfig): number {
  return state.crouching ? config.crouchEyeHeight : config.standEyeHeight;
}

export function stance(state: PlayerState): Stance {
  return state.crouching ? 'crouched' : 'standing';
}

/** What the player is doing right now. */
export function locomotion(state: PlayerState): Locomotion {
  if (!state.alive) return 'dead';
  if (state.maneuver) return state.maneuver.fromHang ? 'pulling-up' : 'mantling';
  if (state.hangId) return 'hanging';
  if (state.climbId) return 'climbing';
  if (state.sliding) return 'sliding';
  if (!state.grounded) return 'airborne';
  return 'grounded';
}

/**
 * The player's largest footprint, for level validation.
 *
 * Validation needs a single height, so it uses the standing height and therefore
 * validates every spawn for the worst case.
 */
export function standingSize(config: PlayerConfig): { radius: number; height: number } {
  return { radius: config.radius, height: config.standHeight };
}

// ---------------------------------------------------------------- lifecycle

/** Clears every manoeuvre and returns the player to a neutral, standing pose. */
export function respawnPlayer(state: PlayerState, config?: GameConfig): void {
  copyVec3(state.position, state.spawn.position);
  copyVec3(state.previousPosition, state.spawn.position);
  state.velocity.x = 0;
  state.velocity.y = 0;
  state.velocity.z = 0;
  state.yaw = state.spawn.yaw;
  state.pitch = state.spawn.pitch;
  state.grounded = false;
  state.groundId = null;
  state.crouching = false;
  state.alive = true;
  state.deadFor = 0;
  state.deathCause = null;
  state.sliding = false;
  state.slideElapsed = 0;
  state.hangId = null;
  state.grabCooldown = 0;
  state.jumpLatch = false;
  state.climbId = null;
  state.maneuver = null;
  state.peakFallSpeed = 0;
  state.bobPhase = 0;
  state.bobAmount = 0;
  if (config) state.health = config.fallDamage.maxHealth;
}

/** Full session reset: as `respawnPlayer`, and the death count goes back to zero. */
export function resetPlayerState(state: PlayerState, config?: GameConfig): void {
  respawnPlayer(state, config);
  state.deaths = 0;
}

// -------------------------------------------------------------------- step

export function stepPlayer(
  state: PlayerState,
  input: MoveInput,
  dt: number,
  options: PlayerStepOptions,
): PlayerStepOutcome {
  if (!Number.isFinite(dt) || dt <= 0) return outcome(createMoveResult());

  if (state.grabCooldown > 0) state.grabCooldown = Math.max(0, state.grabCooldown - dt);

  // While dead the player keeps falling - so the death reads as a fall rather
  // than a freeze - but no input is accepted and the death cannot re-trigger.
  if (!state.alive) {
    state.deadFor += dt;
    if (state.deadFor >= (options.respawnDelaySeconds ?? Number.POSITIVE_INFINITY)) {
      respawnPlayer(state);
      state.health = options.game.fallDamage.maxHealth;
      advanceHeadBob(state, options, dt, 0);
      return outcome(createMoveResult(), { respawned: true });
    }
    const move = stepDeadPlayer(state, dt, options);
    advanceHeadBob(state, options, dt, 0);
    return outcome(move);
  }

  // A scripted move in progress owns the body until it finishes.
  if (state.maneuver) return stepManeuver(state, dt, options);

  if (state.hangId) return stepHanging(state, input, dt, options);
  if (state.climbId) return stepClimbing(state, input, dt, options);

  const move = stepLocomotion(state, input, dt, options);
  return move;
}

// ------------------------------------------------------------- dead / manoeuvre

function stepDeadPlayer(state: PlayerState, dt: number, options: PlayerStepOptions): MoveResult {
  const { config, world } = options;
  copyVec3(state.previousPosition, state.position);

  state.velocity.x = 0;
  state.velocity.z = 0;
  state.velocity.y -= config.gravity * dt;
  if (state.velocity.y < -config.maxFallSpeed) state.velocity.y = -config.maxFallSpeed;

  const box = playerBox(state.position, config.radius, playerHeight(state, config));
  const move = world.move(box, { x: 0, y: state.velocity.y * dt, z: 0 }, state.velocity);
  adoptBox(state, box, config, move);

  if (options.safetyFloorY !== undefined && Number.isFinite(options.safetyFloorY)) {
    applySafetyFloor(state.position, state.velocity, options.safetyFloorY, state.spawn.position);
  }
  return move;
}

/**
 * Advances a mantle or a pull-up.
 *
 * The path is a straight horizontal lerp plus a vertical arc that rises above the
 * destination and settles onto it, which reads as a haul-up rather than as a
 * teleport. Collision is deliberately not applied mid-move: the destination was
 * checked for headroom before the move started, and letting the solver interfere
 * could leave the player wedged halfway up a wall.
 */
function stepManeuver(state: PlayerState, dt: number, options: PlayerStepOptions): PlayerStepOutcome {
  const maneuver = state.maneuver;
  if (!maneuver) return outcome(createMoveResult());

  copyVec3(state.previousPosition, state.position);
  maneuver.elapsed += dt;

  const raw = clamp(maneuver.elapsed / maneuver.durationSeconds, 0, 1);
  const eased = raw * raw * (3 - 2 * raw);
  lerpVec3(state.position, maneuver.from, maneuver.to, eased);
  // A single sine arch: zero at both ends, `arcHeight` at the apex.
  state.position.y += Math.sin(eased * Math.PI) * maneuver.arcHeight;

  state.velocity.x = 0;
  state.velocity.y = 0;
  state.velocity.z = 0;
  state.grounded = false;
  state.groundId = null;

  if (raw < 1) {
    advanceHeadBob(state, options, dt, 0);
    return outcome(createMoveResult());
  }

  const kind: ManeuverKind = maneuver.fromHang ? 'pull-up' : 'mantle';
  copyVec3(state.position, maneuver.to);
  copyVec3(state.previousPosition, maneuver.to);
  state.maneuver = null;
  state.crouching = false;
  state.grounded = true;
  state.peakFallSpeed = 0;

  advanceHeadBob(state, options, dt, 0);
  return outcome(createMoveResult(), { ended: kind });
}

/** Hauling up from a hang, or letting go. */
function stepHanging(
  state: PlayerState,
  input: MoveInput,
  dt: number,
  options: PlayerStepOptions,
): PlayerStepOutcome {
  copyVec3(state.previousPosition, state.position);
  state.velocity.x = 0;
  state.velocity.y = 0;
  state.velocity.z = 0;
  state.grounded = false;
  advanceHeadBob(state, options, dt, 0);

  if (input.jump && !state.jumpLatch) {
    const target = climbTargetFromHang(state, options);
    if (target) {
      startManeuver(state, target, true, options);
      return outcome(createMoveResult(), { started: 'pull-up' });
    }
  }
  state.jumpLatch = input.jump;

  // Letting go drops the player clear of the face so they do not re-grab it.
  // Only an explicit drop intent counts: holding the direction that got you here
  // (which is what a player is doing) must not peel you off the wall.
  if (input.crouch || input.forward < 0) {
    state.hangId = null;
    state.grabCooldown = options.game.maneuver.pullUp.releaseCooldownSeconds;
    state.velocity.x = state.hangDirection.x * -1.2;
    state.velocity.z = state.hangDirection.z * -1.2;
    return outcome(createMoveResult(), { ended: 'hang' });
  }

  return outcome(createMoveResult());
}

/** Ascending a climbable face. */
function stepClimbing(
  state: PlayerState,
  input: MoveInput,
  dt: number,
  options: PlayerStepOptions,
): PlayerStepOutcome {
  const { config, world } = options;
  const climbableIds = options.climbableIds ?? new Set<string>();
  copyVec3(state.previousPosition, state.position);

  const body = playerBox(state.position, config.radius, playerHeight(state, config));
  const facing = yawBasis(state.yaw).forward;
  const surface = findClimbable({
    world,
    box: body,
    direction: facing,
    reach: options.game.maneuver.climb.reach,
    minTopY: 0,
    maxTopY: Number.POSITIVE_INFINITY,
    radius: config.radius,
    standHeight: config.standHeight,
    climbableIds,
  });

  // Lost the face - or let go - and gravity takes over.
  if (!surface || surface.id !== state.climbId || input.forward <= 0) {
    state.climbId = null;
    state.velocity.y = 0;
    return outcome(createMoveResult(), { ended: 'climb' });
  }

  const climb = options.game.maneuver.climb;
  const feetY = state.position.y;
  // Reaching the top hands over to a mantle, so climbing a riser gets you onto
  // whatever it was carrying rather than leaving you pinned to its edge.
  if (feetY + config.standHeight >= surface.box.max.y) {
    const to = landingFeet(
      {
        world,
        box: body,
        direction: facing,
        reach: climb.reach,
        minTopY: 0,
        maxTopY: Number.POSITIVE_INFINITY,
        radius: config.radius,
        standHeight: config.standHeight,
      },
      facing,
      surface.box.max.y,
    );
    state.climbId = null;
    startManeuver(state, to, false, options);
    return outcome(createMoveResult(), { ended: 'climb', started: 'mantle' });
  }

  state.velocity.x = 0;
  state.velocity.z = 0;
  state.velocity.y = climb.speed;

  const box = playerBox(state.position, config.radius, playerHeight(state, config));
  const move = world.move(box, { x: 0, y: climb.speed * dt, z: 0 }, state.velocity);
  adoptBox(state, box, config, move);
  // Climbing is a controlled ascent, not a fall.
  state.peakFallSpeed = 0;
  advanceHeadBob(state, options, dt, 0);

  return outcome(move);
}

// ---------------------------------------------------------------- locomotion

function stepLocomotion(
  state: PlayerState,
  input: MoveInput,
  dt: number,
  options: PlayerStepOptions,
): PlayerStepOutcome {
  const { config, world } = options;
  const wasGrounded = state.grounded;
  copyVec3(state.previousPosition, state.position);

  updateStance(state, input.crouch, world, config);
  const slideEvent = updateSlide(
    state,
    input,
    config,
    options.game.maneuver.slide,
    wasGrounded,
    dt,
  );

  const basis = yawBasis(state.yaw);
  let wishX = basis.forward.x * input.forward + basis.right.x * input.right;
  let wishZ = basis.forward.z * input.forward + basis.right.z * input.right;
  const wishLength = Math.hypot(wishX, wishZ);
  if (wishLength > 1e-6) {
    wishX /= wishLength;
    wishZ /= wishLength;
  } else {
    wishX = 0;
    wishZ = 0;
  }

  const inputMagnitude = Math.min(1, Math.hypot(input.forward, input.right));
  const wishSpeed = targetSpeed(state, input, config) * inputMagnitude;

  if (state.grounded) {
    const friction = state.sliding ? options.game.maneuver.slide.friction : config.groundFriction;
    applyGroundFriction(state.velocity, friction, config, dt);
  }

  if (state.sliding) {
    applySteering(state, input, config, options, dt);
  } else if (wishSpeed > 0) {
    const acceleration = state.grounded ? config.groundAcceleration : config.airAcceleration;
    const currentSpeed = state.velocity.x * wishX + state.velocity.z * wishZ;
    const addSpeed = wishSpeed - currentSpeed;
    if (addSpeed > 0) {
      const accelSpeed = Math.min(acceleration * wishSpeed * dt, addSpeed);
      state.velocity.x += wishX * accelSpeed;
      state.velocity.z += wishZ * accelSpeed;
    }
  }

  if (state.grounded && !state.sliding) {
    if (state.velocity.y < 0) state.velocity.y = 0;
    if (input.jump) state.velocity.y = config.jumpSpeed;
  } else {
    state.velocity.y -= config.gravity * dt;
    if (state.velocity.y < -config.maxFallSpeed) state.velocity.y = -config.maxFallSpeed;
  }

  clampSpeed(state.velocity, config.maxSpeed);

  const box = playerBox(state.position, config.radius, playerHeight(state, config));
  const move = world.move(
    box,
    { x: state.velocity.x * dt, y: state.velocity.y * dt, z: state.velocity.z * dt },
    state.velocity,
  );
  adoptBox(state, box, config, move);

  if (options.safetyFloorY !== undefined && Number.isFinite(options.safetyFloorY)) {
    applySafetyFloor(state.position, state.velocity, options.safetyFloorY, state.spawn.position);
  }

  let landing: Landing | null = null;
  let died = false;
  let started: ManeuverKind | null = slideEvent.started;
  let ended: ManeuverKind | null = slideEvent.ended;

  if (!state.grounded) {
    state.peakFallSpeed = Math.max(state.peakFallSpeed, -state.velocity.y);
  } else if (!wasGrounded) {
    landing = applyLanding(state, options);
    // A hard landing can kill outright, and that death has to reach the game the
    // same way a fall off the level does.
    if (!state.alive) died = true;
  }

  if (state.alive && !state.grounded && !state.maneuver) {
    if (tryGrab(state, input, options)) started = 'hang';
  }

  if (state.alive && state.grounded) {
    const mantle = tryMantle(state, input, options);
    if (mantle) started = 'mantle';
    else if (tryClimb(state, input, options)) started = 'climb';
  }

  advanceHeadBob(state, options, dt, state.grounded ? lengthXZ(state.velocity) : 0);

  if (options.killPlaneY !== undefined && state.alive && state.position.y <= options.killPlaneY) {
    killPlayer(state, 'fell');
    died = true;
  }

  return outcome(move, { landing, started, ended, died });
}

function adoptBox(
  state: PlayerState,
  box: { min: Vec3 },
  config: PlayerConfig,
  move: MoveResult,
): void {
  state.position.x = box.min.x + config.radius;
  state.position.y = box.min.y;
  state.position.z = box.min.z + config.radius;
  state.grounded = move.grounded;
  state.groundId = move.groundId;
}

function targetSpeed(state: PlayerState, input: MoveInput, config: PlayerConfig): number {
  if (state.crouching) return config.crouchSpeed;
  return input.sprint ? config.sprintSpeed : config.walkSpeed;
}

/**
 * Crouching is instant; standing back up requires headroom.
 *
 * Without that check the player would grow into a ceiling and end up embedded in
 * the geometry, which the solver would then have to unpick.
 */
function updateStance(
  state: PlayerState,
  wantsCrouch: boolean,
  world: CollisionWorld,
  config: PlayerConfig,
): void {
  if (wantsCrouch) {
    state.crouching = true;
    return;
  }
  if (!state.crouching) return;

  const standing = playerBox(state.position, config.radius, config.standHeight);
  if (world.isFree(standing)) state.crouching = false;
}

/**
 * Sliding: crouching at speed, on the ground, with its own low friction.
 *
 * The entry condition is a run-up, so a slide is something you commit to rather
 * than something that happens whenever you crouch. It ends on its own once the
 * friction has bled the speed off, which is what stops it needing a duration.
 */
function updateSlide(
  state: PlayerState,
  input: MoveInput,
  config: PlayerConfig,
  slide: SlideConfig,
  wasGrounded: boolean,
  dt: number,
): { started: ManeuverKind | null; ended: ManeuverKind | null } {
  const none = { started: null, ended: null };

  if (state.sliding) {
    state.slideElapsed += dt;
    const speed = lengthXZ(state.velocity);
    const stillSliding =
      state.grounded &&
      input.crouch &&
      speed >= slide.endSpeed &&
      state.slideElapsed <= slide.maxSeconds;

    if (stillSliding) return none;
    state.sliding = false;
    return { started: null, ended: 'slide' };
  }

  if (!wasGrounded || !input.crouch) return none;

  const speed = lengthXZ(state.velocity);
  if (speed < slide.minSpeed) return none;

  state.sliding = true;
  state.slideElapsed = 0;
  state.crouching = true;

  // The boost is what makes a slide worth doing; it is capped so it cannot be
  // used to exceed the sprint ceiling.
  const boosted = Math.min(speed * slide.boost, config.maxSpeed);
  const scale = boosted / speed;
  state.velocity.x *= scale;
  state.velocity.z *= scale;
  return { started: 'slide', ended: null };
}

/**
 * Steering during a slide.
 *
 * The speed is deliberately preserved: a slide is a committed direction that can
 * be bent, not a way to accelerate.
 */
function applySteering(
  state: PlayerState,
  input: MoveInput,
  config: PlayerConfig,
  options: PlayerStepOptions,
  dt: number,
): void {
  const speed = lengthXZ(state.velocity);
  if (speed <= 1e-6) return;

  if (input.right !== 0) {
    const basis = yawBasis(state.yaw);
    state.velocity.x += basis.right.x * options.game.maneuver.slide.steerAcceleration * input.right * dt;
    state.velocity.z += basis.right.z * options.game.maneuver.slide.steerAcceleration * input.right * dt;
  }

  const steerSpeed = lengthXZ(state.velocity);
  if (steerSpeed > 1e-6) {
    const target = speed;
    const scale = Math.min(1, target / steerSpeed);
    state.velocity.x *= scale;
    state.velocity.z *= scale;
  }
  void config;
}

/** Fall damage: how hard the landing was, and what it cost. */
function applyLanding(state: PlayerState, options: PlayerStepOptions): Landing {
  const fall = options.game.fallDamage;
  const impact = state.peakFallSpeed;
  state.peakFallSpeed = 0;

  if (impact <= fall.safeImpactSpeed) return { impact, damage: 0 };

  const span = Math.max(1e-6, fall.fatalImpactSpeed - fall.safeImpactSpeed);
  const fraction = clamp((impact - fall.safeImpactSpeed) / span, 0, 1);
  const damage = fall.maxHealth * fraction;

  state.health = Math.max(0, state.health - damage);
  if (state.health <= 0) killPlayer(state, 'impact');
  return { impact, damage };
}

/** Catches a ledge that is too high to step onto. */
function tryGrab(state: PlayerState, input: MoveInput, options: PlayerStepOptions): boolean {
  if (state.grabCooldown > 0) return false;

  const { config, world } = options;
  const pullUp = options.game.maneuver.pullUp;
  const basis = yawBasis(state.yaw);

  // Only reach for something the player is actually heading towards.
  const wishX = basis.forward.x * input.forward + basis.right.x * input.right;
  const wishZ = basis.forward.z * input.forward + basis.right.z * input.right;
  const wishLength = Math.hypot(wishX, wishZ);
  if (wishLength < 0.4) return false;

  const box = playerBox(state.position, config.radius, playerHeight(state, config));
  const hit = findLedge({
    world,
    box,
    direction: { x: wishX / wishLength, y: 0, z: wishZ / wishLength },
    reach: pullUp.reach,
    minTopY: state.position.y + pullUp.minHeight,
    maxTopY: state.position.y + pullUp.maxHeight,
    radius: config.radius,
    standHeight: config.standHeight,
    ignoreId: state.groundId,
  });
  if (!hit) return false;

  state.hangId = hit.collider.id;
  state.jumpLatch = input.jump;
  copyVec3(state.hangDirection, hit.direction);
  // Flush against the face the player pushed into - and only along that axis.
  // Snapping both axes would slide the player to the collider's corner, which
  // for a 20 m terrace means being teleported 8 m sideways.
  state.position.x = flushAgainst(
    state.position.x,
    hit.collider.box.min.x,
    hit.collider.box.max.x,
    hit.direction.x,
    config.radius,
  );
  state.position.z = flushAgainst(
    state.position.z,
    hit.collider.box.min.z,
    hit.collider.box.max.z,
    hit.direction.z,
    config.radius,
  );
  state.position.y = hit.topY - pullUp.hangDepth;
  copyVec3(state.previousPosition, state.position);
  state.velocity.x = 0;
  state.velocity.y = 0;
  state.velocity.z = 0;
  state.grounded = false;
  state.groundId = null;
  state.crouching = false;
  state.sliding = false;
  state.peakFallSpeed = 0;
  return true;
}

/** Steps up onto a ledge that is low enough not to need a jump. */
function tryMantle(state: PlayerState, input: MoveInput, options: PlayerStepOptions): boolean {
  const { config, world } = options;
  const mantle = options.game.maneuver.mantle;
  const basis = yawBasis(state.yaw);

  const wishX = basis.forward.x * input.forward + basis.right.x * input.right;
  const wishZ = basis.forward.z * input.forward + basis.right.z * input.right;
  const wishLength = Math.hypot(wishX, wishZ);
  if (wishLength < 0.4) return false;

  const box = playerBox(state.position, config.radius, playerHeight(state, config));
  const hit = findLedge({
    world,
    box,
    direction: { x: wishX / wishLength, y: 0, z: wishZ / wishLength },
    reach: mantle.reach,
    minTopY: state.position.y + mantle.minHeight,
    maxTopY: state.position.y + mantle.maxHeight,
    radius: config.radius,
    standHeight: config.standHeight,
    ignoreId: state.groundId,
  });
  if (!hit) return false;

  const to = landingFeet(
    {
      world,
      box,
      direction: hit.direction,
      reach: mantle.reach,
      minTopY: 0,
      maxTopY: Number.POSITIVE_INFINITY,
      radius: config.radius,
      standHeight: config.standHeight,
    },
    hit.direction,
    hit.topY,
  );
  startManeuver(state, to, false, options);
  return true;
}

/** Starts climbing a tagged face the player is pushing into. */
function tryClimb(state: PlayerState, input: MoveInput, options: PlayerStepOptions): boolean {
  const climbableIds = options.climbableIds;
  if (!climbableIds || climbableIds.size === 0) return false;
  if (input.forward <= 0) return false;

  const { config, world } = options;
  const climb = options.game.maneuver.climb;
  const box = playerBox(state.position, config.radius, playerHeight(state, config));
  const facing = yawBasis(state.yaw).forward;

  const surface = findClimbable({
    world,
    box,
    direction: facing,
    reach: climb.reach,
    minTopY: climb.minHeight,
    maxTopY: Number.POSITIVE_INFINITY,
    radius: config.radius,
    standHeight: config.standHeight,
    climbableIds,
  });
  if (!surface) return false;

  state.climbId = surface.id;
  state.crouching = false;
  state.sliding = false;
  state.velocity.x = 0;
  state.velocity.z = 0;
  state.velocity.y = 0;
  return true;
}

function startManeuver(
  state: PlayerState,
  to: Vec3,
  fromHang: boolean,
  options: PlayerStepOptions,
): void {
  const config = fromHang ? options.game.maneuver.pullUp : options.game.maneuver.mantle;
  state.maneuver = {
    elapsed: 0,
    durationSeconds: config.durationSeconds,
    from: { ...state.position },
    to: { ...to },
    arcHeight: config.arcHeight,
    fromHang,
  };
  state.hangId = null;
  state.climbId = null;
  state.sliding = false;
  state.grounded = false;
  state.velocity.x = 0;
  state.velocity.y = 0;
  state.velocity.z = 0;
}

/**
 * Places the player flush against a face along the axis they are pushing.
 *
 * `component` is the approach direction's component on this axis: a ledge is
 * grabbed along a single axis, so the other axis must be left exactly where the
 * player already was.
 */
function flushAgainst(
  centre: number,
  min: number,
  max: number,
  component: number,
  radius: number,
): number {
  if (component > 0.5) return min - radius;
  if (component < -0.5) return max + radius;
  return centre;
}

/**
 * Where the player ends up after pulling up from a hang.
 *
 * `position.y + hangDepth` is the ledge top, so the target is one collision skin
 * above it - the same convention the mantle uses.
 */
function climbTargetFromHang(state: PlayerState, options: PlayerStepOptions): Vec3 | null {
  const pullUp = options.game.maneuver.pullUp;
  return vec3(
    state.position.x + state.hangDirection.x * (pullUp.reach + options.config.radius),
    state.position.y + pullUp.hangDepth + COLLISION_SKIN,
    state.position.z + state.hangDirection.z * (pullUp.reach + options.config.radius),
  );
}

// ---------------------------------------------------------------- head bob

/**
 * Advances the head bob.
 *
 * The phase is driven by *distance travelled*, not by time, so the cadence rises
 * with speed without needing a separate timer, and it stays identical at any
 * frame rate.
 */
export function advanceHeadBob(
  state: PlayerState,
  options: Pick<PlayerStepOptions, 'game' | 'config'>,
  dt: number,
  travelled: number,
): void {
  const bob = options.game.headBob;
  const moving = travelled > 0.001 && state.grounded && !state.sliding;

  if (moving) {
    const stride = state.crouching ? bob.strideLength.crouch : bob.strideLength.walk;
    const speed = lengthXZ(state.velocity);
    const sprinting = speed > options.config.walkSpeed * 1.02;
    const length = sprinting ? bob.strideLength.sprint : stride;
    state.bobPhase = (state.bobPhase + (travelled / length) * Math.PI * 2) % (Math.PI * 2);
  }

  state.bobAmount = damp(state.bobAmount, moving ? 1 : 0, bob.settleRate, dt);
}

/**
 * The camera's world-space offset from the head bob.
 *
 * Two vertical bobs per stride (one per foot) and one lateral sway, which is what
 * makes a walk read as a walk rather than as a bounce.
 */
export function headBobOffset(
  state: PlayerState,
  config: GameConfig,
  out: Vec3 = vec3(),
): Vec3 {
  const bob = config.headBob;
  const amount = state.bobAmount;
  const basis = yawBasis(state.yaw);
  const lateral = Math.sin(state.bobPhase) * bob.lateralAmplitude * amount;

  out.x = basis.right.x * lateral;
  out.y = Math.sin(state.bobPhase * 2) * bob.verticalAmplitude * amount;
  out.z = basis.right.z * lateral;
  return out;
}

/** Eye (camera) position, including the head bob. */
export function eyePosition(
  state: PlayerState,
  config: GameConfig,
  out: Vec3 = vec3(),
  interpolatedFeet: ReadonlyVec3 = state.position,
): Vec3 {
  const offset = headBobOffset(state, config);
  out.x = interpolatedFeet.x + offset.x;
  out.y = interpolatedFeet.y + eyeHeight(state, config.player) + offset.y;
  out.z = interpolatedFeet.z + offset.z;
  return out;
}

/**
 * Interpolated feet position between the previous and current simulation step.
 *
 * `alpha` comes from the fixed-step accumulator; feeding it to the renderer keeps
 * motion smooth on displays whose refresh rate is not a multiple of the tick rate.
 */
export function interpolatePlayerPosition(
  state: PlayerState,
  alpha: number,
  out: Vec3 = vec3(),
): Vec3 {
  return lerpVec3(out, state.previousPosition, state.position, alpha);
}

export function horizontalSpeed(state: PlayerState): number {
  return lengthXZ(state.velocity);
}

export function speed(state: PlayerState): number {
  const { x, y, z } = state.velocity;
  return Math.hypot(x, y, z);
}

function killPlayer(state: PlayerState, cause: DeathCause): void {
  state.alive = false;
  state.deadFor = 0;
  state.deaths += 1;
  state.deathCause = cause;
  state.health = 0;
  state.velocity.x = 0;
  state.velocity.y = 0;
  state.velocity.z = 0;
  state.grounded = false;
  state.groundId = null;
  state.sliding = false;
  state.hangId = null;
  state.climbId = null;
  state.maneuver = null;
}

function applyGroundFriction(
  velocity: Vec3,
  friction: number,
  config: PlayerConfig,
  dt: number,
): void {
  const magnitude = Math.hypot(velocity.x, velocity.z);
  if (magnitude <= 1e-6) {
    velocity.x = 0;
    velocity.z = 0;
    return;
  }

  const control = Math.max(magnitude, config.stopSpeed);
  const drop = control * friction * dt;
  const scale = Math.max(magnitude - drop, 0) / magnitude;
  velocity.x *= scale;
  velocity.z *= scale;
}

export interface PlayerSnapshot {
  readonly position: ReadonlyVec3;
  readonly velocity: ReadonlyVec3;
  readonly speed: number;
  readonly horizontalSpeed: number;
  readonly yaw: number;
  readonly pitch: number;
  readonly grounded: boolean;
  readonly groundId: string | null;
  readonly stance: Stance;
  readonly alive: boolean;
  readonly deaths: number;
  readonly deathCause: DeathCause | null;
  readonly health: number;
  readonly locomotion: Locomotion;
}

export function snapshotPlayer(state: PlayerState): PlayerSnapshot {
  return {
    position: { x: state.position.x, y: state.position.y, z: state.position.z },
    velocity: { x: state.velocity.x, y: state.velocity.y, z: state.velocity.z },
    speed: speed(state),
    horizontalSpeed: horizontalSpeed(state),
    yaw: state.yaw,
    pitch: state.pitch,
    grounded: state.grounded,
    groundId: state.groundId,
    stance: stance(state),
    alive: state.alive,
    deaths: state.deaths,
    deathCause: state.deathCause,
    health: state.health,
    locomotion: locomotion(state),
  };
}
