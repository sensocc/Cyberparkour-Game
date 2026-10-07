/**
 * Player state and movement integration.
 *
 * The movement model is deliberately the classic "Quake" one: friction is
 * applied first, then acceleration is capped so it can never push the player
 * past their wish speed. That combination gives snappy starts and stops while
 * staying trivially extensible for the air control, wall-running and sliding
 * that later versions add.
 */

import type { PlayerConfig } from '../core/config.js';
import { clampSpeed, applySafetyFloor, createMoveResult, playerBox, type MoveResult } from './physics/collision.js';
import type { CollisionWorld } from './physics/collision.js';
import {
  copyVec3,
  lerpVec3,
  vec3,
  yawBasis,
  type ReadonlyVec3,
  type Vec3,
} from '../core/vec3.js';
import type { SpawnPoint } from './level/levelData.js';

/** Movement intent for one step, each axis in `[-1, 1]`. */
export interface MoveInput {
  /** +1 forward, -1 backward. */
  readonly forward: number;
  /** +1 right, -1 left. */
  readonly right: number;
}

export const NO_INPUT: MoveInput = { forward: 0, right: 0 };

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
  /** Where `resetPlayerState` sends the player back to. */
  readonly spawn: { position: Vec3; yaw: number; pitch: number };
}

export interface PlayerStepOptions {
  readonly world: CollisionWorld;
  readonly config: PlayerConfig;
  /**
   * Emergency floor. When the player drops below it they are snapped back to
   * their spawn point. Set to `-Infinity` to disable.
   */
  readonly safetyFloorY?: number;
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
    spawn: {
      position: spawnPosition,
      yaw: spawn.yaw,
      pitch: spawn.pitch,
    },
  };
}

/** Returns the player to their spawn point and clears all motion. */
export function resetPlayerState(state: PlayerState): void {
  copyVec3(state.position, state.spawn.position);
  copyVec3(state.previousPosition, state.spawn.position);
  state.velocity.x = 0;
  state.velocity.y = 0;
  state.velocity.z = 0;
  state.yaw = state.spawn.yaw;
  state.pitch = state.spawn.pitch;
  state.grounded = false;
  state.groundId = null;
}

/**
 * Advances the player by one fixed step.
 *
 * Mutates `state` in place. `options.world` is stepped against the player's
 * AABB; blocked velocity components are zeroed by the solver.
 *
 * @param dt fixed step length in seconds.
 */
export function stepPlayer(
  state: PlayerState,
  input: MoveInput,
  dt: number,
  options: PlayerStepOptions,
): MoveResult {
  if (!Number.isFinite(dt) || dt <= 0) return createMoveResult();

  const { config, world } = options;
  copyVec3(state.previousPosition, state.position);

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

  // Diagonal input must not exceed the walk speed, hence the input magnitude.
  const inputMagnitude = Math.min(1, Math.hypot(input.forward, input.right));
  const wishSpeed = config.walkSpeed * inputMagnitude;

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
  } else {
    state.velocity.y -= config.gravity * dt;
    if (state.velocity.y < -config.maxFallSpeed) state.velocity.y = -config.maxFallSpeed;
  }

  clampSpeed(state.velocity, config.maxSpeed);

  // --------------------------------------------------------------- integrate
  const box = playerBox(state.position, config.radius, config.height);
  const result = world.move(
    box,
    { x: state.velocity.x * dt, y: state.velocity.y * dt, z: state.velocity.z * dt },
    state.velocity,
  );

  state.position.x = box.min.x + config.radius;
  state.position.y = box.min.y;
  state.position.z = box.min.z + config.radius;
  state.grounded = result.grounded;
  state.groundId = result.groundId;

  if (options.safetyFloorY !== undefined && Number.isFinite(options.safetyFloorY)) {
    applySafetyFloor(state.position, state.velocity, options.safetyFloorY, state.spawn.position);
  }

  return result;
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

/** Eye (camera) position for a player state, with no interpolation. */
export function eyePosition(state: PlayerState, eyeHeight: number): Vec3 {
  return vec3(state.position.x, state.position.y + eyeHeight, state.position.z);
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
  };
}
