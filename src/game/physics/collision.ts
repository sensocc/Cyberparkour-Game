/**
 * Axis-separated AABB collision solver.
 *
 * The player is an axis-aligned box that is swept along one axis at a time
 * (X, then Z, then Y) in sub-steps small enough that it can never skip past a
 * collider. Blocking is resolved by pushing the box back out along the axis it
 * was travelling on, which yields the "slide along a wall" behaviour players
 * expect from a first-person game without any swept-surface maths.
 *
 * Kept free of three.js so the whole solver is unit-testable.
 */

import { type ReadonlyVec3, type Vec3 } from '../../core/vec3.js';
import {
  aabbFromFeet,
  minThickness,
  overlaps,
  overlapsWhenOffset,
  type AABB,
  type Axis,
} from './aabb.js';

/** Small separation left between the player and any surface it touches. */
export const COLLISION_SKIN = 1e-3;

/**
 * Semantic tag for a collider.
 *
 * `climbable` is what the climbing ability looks for: a face the player can
 * ascend by holding forward into it. `pipe` is a climbable the player may also
 * descend, and `door` is a collider the game may switch off when the door swings
 * open.
 */
export type ColliderKind = 'floor' | 'wall' | 'prop' | 'boundary' | 'climbable' | 'pipe' | 'door';

export interface Collider {
  readonly id: string;
  readonly kind: ColliderKind;
  readonly box: AABB;
  /**
   * What the surface sounds like underfoot (`AcousticMaterial`).
   *
   * Kept as a plain string so the physics layer stays independent of the level
   * tables; the level decides it from the prop's model.
   */
  readonly surface?: string;
}

export interface MoveResult {
  /** Standing on (or resting against) something below. */
  grounded: boolean;
  hitCeiling: boolean;
  hitWall: boolean;
  /** Per-axis blocking flags, in the direction of travel. */
  readonly blocked: Record<Axis, boolean>;
  /** Id of the collider supporting the player, if any. */
  groundId: string | null;
  /** Acoustic material of the ground, for surface-aware footsteps. */
  groundSurface: string | null;
}

export function createMoveResult(): MoveResult {
  return {
    grounded: false,
    hitCeiling: false,
    hitWall: false,
    blocked: { x: false, y: false, z: false },
    groundId: null,
    groundSurface: null,
  };
}

export function resetMoveResult(result: MoveResult): void {
  result.grounded = false;
  result.hitCeiling = false;
  result.hitWall = false;
  result.blocked.x = false;
  result.blocked.y = false;
  result.blocked.z = false;
  result.groundId = null;
  result.groundSurface = null;
}

export interface CollisionWorldOptions {
  /** Upper bound on how far the player is moved before re-testing (m). */
  maxSubStep?: number;
  /** Distance below the feet that still counts as "grounded" (m). */
  groundProbe?: number;
}

export class CollisionWorld {
  readonly colliders: readonly Collider[];
  private readonly maxSubStep: number;
  private readonly groundProbe: number;
  /**
   * Ids switched off at runtime.
   *
   * Doors are the only reason this exists: a door that has swung open must stop
   * blocking, and rebuilding the whole world to express that would be absurd. A
   * collider is solid unless its id is in here, so the common case costs one set
   * lookup per candidate.
   */
  private readonly disabled = new Set<string>();

  constructor(colliders: readonly Collider[], options: CollisionWorldOptions = {}) {
    this.colliders = colliders.slice();
    this.groundProbe = options.groundProbe ?? 0.02;

    // A collider thinner than the sub-step could be stepped straight over, so
    // the sub-step is clamped to the thinnest thing in the level.
    const thinnest = this.colliders.reduce(
      (min, collider) => Math.min(min, minThickness(collider.box)),
      Number.POSITIVE_INFINITY,
    );
    const requested = options.maxSubStep ?? 0.2;
    if (requested <= 0) throw new RangeError('maxSubStep must be > 0');
    this.maxSubStep = Math.min(requested, Number.isFinite(thinnest) ? thinnest : requested);
  }

  /** The sub-step actually in use (exposed for diagnostics/tests). */
  get subStep(): number {
    return this.maxSubStep;
  }

  /**
   * Sweeps `box` by `delta`, resolving collisions.
   *
   * `box` and `velocity` are mutated in place - the hot path allocates nothing.
   * Blocked velocity components are zeroed so the caller's state stays
   * consistent with the position that was actually reached.
   */
  move(
    box: AABB,
    delta: ReadonlyVec3,
    velocity: Vec3,
    result: MoveResult = createMoveResult(),
  ): MoveResult {
    resetMoveResult(result);

    // Y is resolved last: the horizontal position should be final before we
    // decide what the player is standing on.
    if (this.sweepAxis(box, 'x', delta.x)) {
      result.blocked.x = true;
      result.hitWall = true;
      velocity.x = 0;
    }
    if (this.sweepAxis(box, 'z', delta.z)) {
      result.blocked.z = true;
      result.hitWall = true;
      velocity.z = 0;
    }

    if (this.sweepAxis(box, 'y', delta.y)) {
      result.blocked.y = true;
      if (delta.y < 0) {
        result.grounded = true;
        velocity.y = 0;
      } else if (delta.y > 0) {
        result.hitCeiling = true;
        velocity.y = 0;
      }
    }

    // Resting contact produces a delta of zero on Y, which the sweep cannot
    // see. Probe a hair downwards so friction and gravity keep applying.
    //
    // A rising player is deliberately not probed: they are leaving the ground,
    // and reporting them as supported would let a jump re-trigger every step.
    if (!result.grounded && velocity.y <= 0) {
      const ground = this.findGround(box, this.groundProbe);
      if (ground) {
        result.grounded = true;
        if (velocity.y < 0) velocity.y = 0;
        result.groundId = ground.id;
        result.groundSurface = ground.surface ?? null;
      }
    } else if (result.grounded) {
      const ground = this.findGround(box, this.groundProbe);
      result.groundId = ground?.id ?? null;
      result.groundSurface = ground?.surface ?? null;
    }

    return result;
  }

  /**
   * Switches a collider on or off.
   *
   * Used by doors: an open door stops blocking without the world being rebuilt.
   * Unknown ids are ignored rather than throwing, so the game can call this from
   * a render loop without existence checks.
   */
  setColliderEnabled(id: string, enabled: boolean): void {
    if (enabled) this.disabled.delete(id);
    else this.disabled.add(id);
  }

  isColliderEnabled(id: string): boolean {
    return !this.disabled.has(id);
  }

  /** True when the box does not overlap any *enabled* collider. */
  isFree(box: AABB): boolean {
    for (const collider of this.colliders) {
      if (this.disabled.has(collider.id)) continue;
      if (overlaps(box, collider.box)) return false;
    }
    return true;
  }

  /** True when the box is supported from below within `distance`. */
  isSupported(box: AABB, distance = this.groundProbe): boolean {
    return this.findGround(box, distance) !== null;
  }

  private findGround(box: AABB, distance: number): Collider | null {
    for (const collider of this.colliders) {
      if (this.disabled.has(collider.id)) continue;
      if (overlapsWhenOffset(box, 'y', -distance, collider.box)) return collider;
    }
    return null;
  }

  /**
   * Moves `box` along one axis, stopping at the first blocking contact.
   *
   * @returns whether the movement was blocked.
   */
  private sweepAxis(box: AABB, axis: Axis, amount: number): boolean {
    if (amount === 0 || !Number.isFinite(amount)) return false;

    const direction = Math.sign(amount);
    let remaining = Math.abs(amount);

    while (remaining > 0) {
      const step = Math.min(remaining, this.maxSubStep) * direction;
      box.min[axis] += step;
      box.max[axis] += step;
      remaining -= Math.abs(step);

      const push = this.depenetrateAxis(box, axis, direction);
      if (push !== 0) {
        box.min[axis] += push;
        box.max[axis] += push;
        return true;
      }
    }
    return false;
  }

  /**
   * Computes the smallest translation on `axis` that separates the box from
   * everything it currently overlaps, in the direction opposing travel.
   * Returns 0 when there is no overlap.
   */
  private depenetrateAxis(box: AABB, axis: Axis, direction: number): number {
    let push = 0;

    for (const collider of this.colliders) {
      if (this.disabled.has(collider.id)) continue;
      if (!overlaps(box, collider.box)) continue;

      const separation =
        direction > 0 ? collider.box.min[axis] - box.max[axis] : collider.box.max[axis] - box.min[axis];

      // Keep the largest magnitude: with several overlaps the deepest one wins.
      if (direction > 0) push = Math.min(push, separation);
      else push = Math.max(push, separation);
    }

    if (push === 0) return 0;
    return direction > 0 ? push - COLLISION_SKIN : push + COLLISION_SKIN;
  }
}

/** Builds the player's collision box for a feet position. */
export function playerBox(position: ReadonlyVec3, radius: number, height: number): AABB {
  return aabbFromFeet(position, radius, height);
}

export type SafetyFloorReason = 'below-floor' | 'non-finite';

/**
 * Rescues a player that escaped the demo geometry.
 *
 * V0.0 has no death/respawn system (that arrives in V0.1), so this only
 * guarantees the demo cannot end up staring into the void forever. The player
 * is snapped back to `origin` and stopped.
 *
 * @returns the reason a rescue happened, or `null` when the player is fine.
 */
export function applySafetyFloor(
  position: Vec3,
  velocity: Vec3,
  floorY: number,
  origin: ReadonlyVec3,
): SafetyFloorReason | null {
  const finite =
    Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z);

  const reason: SafetyFloorReason | null = !finite
    ? 'non-finite'
    : position.y < floorY
      ? 'below-floor'
      : null;

  if (reason === null) return null;

  position.x = origin.x;
  position.y = origin.y;
  position.z = origin.z;
  velocity.x = 0;
  velocity.y = 0;
  velocity.z = 0;
  return reason;
}

/** Clamps the player's velocity magnitude, guarding against simulation blow-ups. */
export function clampSpeed(velocity: Vec3, maxSpeed: number): boolean {
  const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
  if (Number.isFinite(speed) && speed <= maxSpeed) return false;

  if (!Number.isFinite(speed)) {
    // Scaling a non-finite velocity cannot bring it back into range - it would
    // produce NaN (Infinity * 0). Stop the player instead.
    velocity.x = 0;
    velocity.y = 0;
    velocity.z = 0;
    return true;
  }

  const scale = maxSpeed / speed;
  velocity.x *= scale;
  velocity.y *= scale;
  velocity.z *= scale;
  return true;
}

/** Clamps a raw delta vector so a single step cannot exceed `maxDistance`. */
export function clampDelta(delta: Vec3, maxDistance: number): void {
  const distance = Math.hypot(delta.x, delta.y, delta.z);
  if (Number.isFinite(distance) && distance <= maxDistance) return;

  if (!Number.isFinite(distance)) {
    delta.x = 0;
    delta.y = 0;
    delta.z = 0;
    return;
  }

  const scale = maxDistance / distance;
  delta.x *= scale;
  delta.y *= scale;
  delta.z *= scale;
}
