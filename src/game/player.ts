/**
 * Player state and movement integration.
 *
 * The movement model is deliberately the classic "Quake" one: friction is
 * applied first, then acceleration is capped so it can never push the player
 * past their wish speed. That combination gives snappy starts and stops, and it
 * is what makes the multi-speed locomotion (walk / sprint / crouch) trivial -
 * each is just a different wish speed through the same accelerator.
 *
 * Sprint, jump and crouch all funnel through this one function so that the
 * whole locomotion model stays deterministic and testable without a renderer.
 */

import type { PlayerConfig } from '../core/config.js';
import {
  applySafetyFloor,
  clampSpeed,
  createMoveResult,
  playerBox,
  type MoveResult,
} from './physics/collision.js';
import type { CollisionWorld } from './physics/collision.js';
import {
  copyVec3,
  lerpVec3,
  vec3,
  yawBasis,
  type ReadonlyVec3,
  type Vec3,
} from '../core/vec3.js';
import type { PlayerSize } from './level/level.js';
import type { SpawnPoint } from './level/levelData.js';

/** Movement intent for one step. */
export interface MoveInput {
  /** +1 forward, -1 backward. */
  readonly forward: number;
  /** +1 right, -1 left. */
  readonly right: number;
  /** Hold to run. Ignored while crouched. */
  readonly sprint: boolean;
  /** Hold to jump; only takes effect from the ground. */
  readonly jump: boolean;
  /** Hold to crouch. Releasing only stands up if there is headroom. */
  readonly crouch: boolean;
}

export const NO_INPUT: MoveInput = {
  forward: 0,
  right: 0,
  sprint: false,
  jump: false,
  crouch: false,
};

/** Locomotion state, derived from the crouch flag. */
export type Stance = 'standing' | 'crouched';

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
  /** False between falling to their death and respawning. */
  alive: boolean;
  /** Seconds since the player died; drives the respawn delay. */
  deadFor: number;
  /** Deaths so far this session. */
  deaths: number;
  /** Where `respawnPlayer` sends the player back to. */
  readonly spawn: { position: Vec3; yaw: number; pitch: number };
}

export interface PlayerStepOptions {
  readonly world: CollisionWorld;
  readonly config: PlayerConfig;
  /**
   * Fall detection: the Y below which the player is considered to have fallen
   * off the level and dies. Omit to disable.
   */
  readonly killPlaneY?: number;
  /** Seconds between death and the automatic respawn. */
  readonly respawnDelaySeconds?: number;
  /** Emergency anti-void floor. Set to `-Infinity` to disable. */
  readonly safetyFloorY?: number;
}

export interface PlayerStepOutcome {
  /** Contact information from this step's collision sweep. */
  readonly move: MoveResult;
  /** True on the step the player fell to their death. */
  readonly died: boolean;
  /** True on the step the player was returned to their spawn point. */
  readonly respawned: boolean;
}

export function createPlayerState(spawn: SpawnPoint): PlayerState {
  const spawnPosition = vec3(spawn.position.x, spawn.position.y, spawn.position.z);
  return {
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
    spawn: {
      position: spawnPosition,
      yaw: spawn.yaw,
      pitch: spawn.pitch,
    },
  };
}

/**
 * The player's largest footprint.
 *
 * Level validation needs a single height, and using the standing height means
 * the spawn is validated for the worst case.
 */
export function standingSize(config: PlayerConfig): PlayerSize {
  return { radius: config.radius, height: config.standHeight };
}

/** The player's collision-box height for their current stance. */
export function playerHeight(state: PlayerState, config: PlayerConfig): number {
  return state.crouching ? config.crouchHeight : config.standHeight;
}

/** The camera's height above the player's feet for their current stance. */
export function eyeHeight(state: PlayerState, config: PlayerConfig): number {
  return state.crouching ? config.crouchEyeHeight : config.standEyeHeight;
}

export function stance(state: PlayerState): Stance {
  return state.crouching ? 'crouched' : 'standing';
}

/**
 * Returns the player to their spawn point and clears all motion, including the
 * crouch. Keeps the death count, so it can be used for a respawn.
 */
export function respawnPlayer(state: PlayerState): void {
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
}

/** Full session reset: as `respawnPlayer`, and the death count goes back to zero. */
export function resetPlayerState(state: PlayerState): void {
  respawnPlayer(state);
  state.deaths = 0;
}

/**
 * Advances the player by one fixed step.
 *
 * Mutates `state` in place. `options.world` is stepped against the player's
 * box; blocked velocity components are zeroed by the solver.
 *
 * @param dt fixed step length in seconds.
 */
export function stepPlayer(
  state: PlayerState,
  input: MoveInput,
  dt: number,
  options: PlayerStepOptions,
): PlayerStepOutcome {
  if (!Number.isFinite(dt) || dt <= 0) {
    return { move: createMoveResult(), died: false, respawned: false };
  }

  // While dead the player keeps falling - so the death reads as a fall rather
  // than a freeze - but no input is accepted and the death cannot re-trigger.
  //
  // An omitted respawn delay means "never respawn", not "respawn immediately":
  // the latter would make a death invisible and unobservable.
  if (!state.alive) {
    state.deadFor += dt;

    if (state.deadFor >= (options.respawnDelaySeconds ?? Number.POSITIVE_INFINITY)) {
      respawnPlayer(state);
      return { move: createMoveResult(), died: false, respawned: true };
    }

    return { move: stepDeadPlayer(state, dt, options), died: false, respawned: false };
  }

  const { config, world } = options;
  copyVec3(state.previousPosition, state.position);

  updateStance(state, input.crouch, world, config);

  // ---------------------------------------------------------------- wish dir
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

  // Diagonal input must not exceed the target speed, hence the input magnitude.
  const inputMagnitude = Math.min(1, Math.hypot(input.forward, input.right));
  const wishSpeed = targetSpeed(state.crouching, input.sprint, config) * inputMagnitude;

  // ---------------------------------------------------------------- friction
  if (state.grounded) applyGroundFriction(state.velocity, config, dt);

  // ------------------------------------------------------------ acceleration
  if (wishSpeed > 0) {
    const acceleration = state.grounded ? config.groundAcceleration : config.airAcceleration;
    const currentSpeed = state.velocity.x * wishX + state.velocity.z * wishZ;
    const addSpeed = wishSpeed - currentSpeed;
    if (addSpeed > 0) {
      const accelSpeed = Math.min(acceleration * wishSpeed * dt, addSpeed);
      state.velocity.x += wishX * accelSpeed;
      state.velocity.z += wishZ * accelSpeed;
    }
  }

  // ----------------------------------------------------------------- gravity
  if (state.grounded) {
    if (state.velocity.y < 0) state.velocity.y = 0;
    // Jumping from the ground is the only way to leave it.
    if (input.jump) state.velocity.y = config.jumpSpeed;
  } else {
    state.velocity.y -= config.gravity * dt;
    if (state.velocity.y < -config.maxFallSpeed) state.velocity.y = -config.maxFallSpeed;
  }

  clampSpeed(state.velocity, config.maxSpeed);

  // --------------------------------------------------------------- integrate
  const box = playerBox(state.position, config.radius, playerHeight(state, config));
  const move = world.move(
    box,
    { x: state.velocity.x * dt, y: state.velocity.y * dt, z: state.velocity.z * dt },
    state.velocity,
  );

  state.position.x = box.min.x + config.radius;
  state.position.y = box.min.y;
  state.position.z = box.min.z + config.radius;
  state.grounded = move.grounded;
  state.groundId = move.groundId;

  if (options.safetyFloorY !== undefined && Number.isFinite(options.safetyFloorY)) {
    applySafetyFloor(state.position, state.velocity, options.safetyFloorY, state.spawn.position);
  }

  // ---------------------------------------------------------- fall detection
  if (options.killPlaneY !== undefined && state.position.y <= options.killPlaneY) {
    killPlayer(state);
    return { move, died: true, respawned: false };
  }

  return { move, died: false, respawned: false };
}

/**
 * Keeps a dead player falling, so a fatal drop reads as a fall.
 *
 * No input is accepted and gravity still applies; the horizontal velocity was
 * cleared when they died, so this is a straight drop.
 */
function stepDeadPlayer(
  state: PlayerState,
  dt: number,
  options: PlayerStepOptions,
): MoveResult {
  const { config, world } = options;
  copyVec3(state.previousPosition, state.position);

  state.velocity.y -= config.gravity * dt;
  if (state.velocity.y < -config.maxFallSpeed) state.velocity.y = -config.maxFallSpeed;

  const box = playerBox(state.position, config.radius, playerHeight(state, config));
  const move = world.move(box, { x: 0, y: state.velocity.y * dt, z: 0 }, state.velocity);

  state.position.x = box.min.x + config.radius;
  state.position.y = box.min.y;
  state.position.z = box.min.z + config.radius;
  state.grounded = move.grounded;
  state.groundId = move.groundId;

  if (options.safetyFloorY !== undefined && Number.isFinite(options.safetyFloorY)) {
    applySafetyFloor(state.position, state.velocity, options.safetyFloorY, state.spawn.position);
  }

  return move;
}

/**
 * Crouching is instant; standing back up requires headroom.
 *
 * Without that check the player would be able to grow into a ceiling and end up
 * embedded in the geometry - which the solver would then have to unpick from a
 * position it cannot resolve.
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

function targetSpeed(crouching: boolean, sprinting: boolean, config: PlayerConfig): number {
  // Crouching wins: you cannot sprint out of a crawl.
  if (crouching) return config.crouchSpeed;
  return sprinting ? config.sprintSpeed : config.walkSpeed;
}

function applyGroundFriction(velocity: Vec3, config: PlayerConfig, dt: number): void {
  const speed = Math.hypot(velocity.x, velocity.z);
  if (speed <= 1e-6) {
    velocity.x = 0;
    velocity.z = 0;
    return;
  }

  const control = Math.max(speed, config.stopSpeed);
  const drop = control * config.groundFriction * dt;
  const scale = Math.max(speed - drop, 0) / speed;
  velocity.x *= scale;
  velocity.z *= scale;
}

function killPlayer(state: PlayerState): void {
  state.alive = false;
  state.deadFor = 0;
  state.deaths += 1;
  state.velocity.x = 0;
  state.velocity.y = 0;
  state.velocity.z = 0;
  state.grounded = false;
  state.groundId = null;
}

/** Eye (camera) position for a player state, with no interpolation. */
export function eyePosition(state: PlayerState, config: PlayerConfig): Vec3 {
  return vec3(state.position.x, state.position.y + eyeHeight(state, config), state.position.z);
}

/**
 * Interpolated feet position between the previous and current simulation step.
 *
 * `alpha` comes from the fixed-step accumulator; feeding it to the renderer
 * keeps motion smooth on displays whose refresh rate is not a multiple of the
 * tick rate.
 */
export function interpolatePlayerPosition(
  state: PlayerState,
  alpha: number,
  out: Vec3 = vec3(),
): Vec3 {
  return lerpVec3(out, state.previousPosition, state.position, alpha);
}

/** Horizontal speed, in m/s. */
export function horizontalSpeed(state: PlayerState): number {
  return Math.hypot(state.velocity.x, state.velocity.z);
}

/** Full speed magnitude, in m/s. */
export function speed(state: PlayerState): number {
  const { x, y, z } = state.velocity;
  return Math.hypot(x, y, z);
}

/** Snapshot used by the debug HUD and crash reports. */
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
  };
}
