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
  /**
   * How candidates are found.
   *
   * `grid` is what the game uses. `scan` is the V0.1 behaviour - every collider,
   * every time - and is kept because it is the thing the grid has to be *equal*
   * to: two implementations that must agree are worth more than one that must be
   * believed, and the equivalence test runs both over the whole city.
   */
  broadphase?: 'grid' | 'scan';
}

/**
 * Side of a broadphase cell, in metres.
 *
 * Sized to the things that are tested against each other rather than to the city:
 * a player is under a metre across, so 16 m is a cell that a walking step never
 * leaves and a falling step crosses at most one boundary of. Smaller cells make
 * the per-cell lists shorter but the *number* of cells to visit larger, and past
 * about this size the second effect wins.
 */
const CELL = 16;

/**
 * How many cells a collider may span before it is held aside instead.
 *
 * A collider in every cell it touches is what makes the grid work; a collider in
 * *every* cell - a 1200 m street plate - would be inserted into nine thousand of
 * them and defeat the point. There are only a handful of these, and they are the
 * ones a query is most likely to hit anyway, so they are tested every time.
 */
const MAX_CELLS = 8;

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

  /** `grid` (the game) or `scan` (the reference the equivalence test compares against). */
  private readonly broadphase: 'grid' | 'scan';

  /** Cell coordinate of a world position, on one axis. */
  private static cell(value: number): number {
    return Math.floor(value / CELL);
  }

  /** Cell key. Packs both coordinates into one number, which a Map wants. */
  private static key(x: number, z: number): number {
    return x * 100000 + z;
  }

  private readonly cells = new Map<number, number[]>();
  /** Colliders too large to file by cell, tested on every query. */
  private readonly large: number[] = [];
  /** Cell lists built in ascending collider order, so a query can rely on it. */
  private readonly scratch: number[] = [];
  private scratchCount = 0;
  /**
   * One stamp per collider, so a collider filed under several cells is visited
   * once. Stamps rather than a cleared set: the counter only ever goes up, so
   * nothing has to be reset between queries.
   */
  private readonly seen: Int32Array;
  private stamp = 0;

  /**
   * Files every collider into the cells it overlaps.
   *
   * A collider is written into each cell it touches *in ascending index order*,
   * which is what lets `findGround` pick the same collider the linear scan would
   * - the first one in the level's own order - without walking the whole level.
   */
  private index(): void {
    if (this.broadphase === 'scan') return;

    for (let index = 0; index < this.colliders.length; index += 1) {
      const { box } = this.colliders[index] as Collider;
      const x0 = CollisionWorld.cell(box.min.x);
      const x1 = CollisionWorld.cell(box.max.x);
      const z0 = CollisionWorld.cell(box.min.z);
      const z1 = CollisionWorld.cell(box.max.z);
      if (x1 - x0 >= MAX_CELLS || z1 - z0 >= MAX_CELLS) {
        this.large.push(index);
        continue;
      }
      for (let x = x0; x <= x1; x += 1) {
        for (let z = z0; z <= z1; z += 1) {
          const key = CollisionWorld.key(x, z);
          const cell = this.cells.get(key);
          if (cell) cell.push(index);
          else this.cells.set(key, [index]);
        }
      }
    }
  }

  /**
   * Collects the colliders that could overlap `box` into `this.scratch`.
   *
   * A collision query is a handful of cells rather than the level, which is the
   * whole reason the city can be five thousand colliders and still cost what the
   * district's two hundred cost. A sweeping box covers a few cells per query, so
   * this is the hot path's only allocation-free step.
   */
  private gather(box: AABB): number {
    this.scratchCount = 0;
    if (this.broadphase === 'scan') {
      for (let index = 0; index < this.colliders.length; index += 1) this.scratch[index] = index;
      this.scratchCount = this.colliders.length;
      return this.scratchCount;
    }

    this.stamp += 1;
    const stamp = this.stamp;
    for (let index = 0; index < this.large.length; index += 1) {
      const candidate = this.large[index] as number;
      this.seen[candidate] = stamp;
      this.scratch[this.scratchCount] = candidate;
      this.scratchCount += 1;
    }

    const x0 = CollisionWorld.cell(box.min.x);
    const x1 = CollisionWorld.cell(box.max.x);
    const z0 = CollisionWorld.cell(box.min.z);
    const z1 = CollisionWorld.cell(box.max.z);
    for (let x = x0; x <= x1; x += 1) {
      for (let z = z0; z <= z1; z += 1) {
        const cell = this.cells.get(CollisionWorld.key(x, z));
        if (!cell) continue;
        for (let index = 0; index < cell.length; index += 1) {
          const candidate = cell[index] as number;
          if (this.seen[candidate] === stamp) continue;
          this.seen[candidate] = stamp;
          this.scratch[this.scratchCount] = candidate;
          this.scratchCount += 1;
        }
      }
    }
    return this.scratchCount;
  }

  constructor(colliders: readonly Collider[], options: CollisionWorldOptions = {}) {
    this.colliders = colliders.slice();
    this.groundProbe = options.groundProbe ?? 0.02;
    this.broadphase = options.broadphase ?? 'grid';

    // A collider thinner than the sub-step could be stepped straight over, so
    // the sub-step is clamped to the thinnest thing in the level.
    const thinnest = this.colliders.reduce(
      (min, collider) => Math.min(min, minThickness(collider.box)),
      Number.POSITIVE_INFINITY,
    );
    const requested = options.maxSubStep ?? 0.2;
    if (requested <= 0) throw new RangeError('maxSubStep must be > 0');
    this.maxSubStep = Math.min(requested, Number.isFinite(thinnest) ? thinnest : requested);

    this.seen = new Int32Array(this.colliders.length);
    this.index();
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
    const count = this.gather(box);
    for (let index = 0; index < count; index += 1) {
      const collider = this.colliders[this.scratch[index] as number] as Collider;
      if (this.disabled.has(collider.id)) continue;
      if (overlaps(box, collider.box)) return false;
    }
    return true;
  }

  /** True when the box is supported from below within `distance`. */
  isSupported(box: AABB, distance = this.groundProbe): boolean {
    return this.findGround(box, distance) !== null;
  }

  /**
   * The supporting collider, chosen exactly as the linear scan chose it: the
   * first one in the level's own order.
   *
   * "First in order" is "lowest index", which is a fact about the candidate set
   * rather than about the order it was visited in - so the grid can answer with
   * the same collider even though it finds candidates cell by cell. Two
   * colliders that both support the player are a real case (the lip of a roof and
   * the roof itself), which is why this is pinned down rather than left to
   * whichever the walk happened to reach.
   */
  private findGround(box: AABB, distance: number): Collider | null {
    const count = this.gather(box);
    let best = -1;
    for (let index = 0; index < count; index += 1) {
      const candidate = this.scratch[index] as number;
      if (best !== -1 && candidate > best) continue;
      const collider = this.colliders[candidate] as Collider;
      if (this.disabled.has(collider.id)) continue;
      if (overlapsWhenOffset(box, 'y', -distance, collider.box)) best = candidate;
    }
    return best === -1 ? null : (this.colliders[best] as Collider);
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

    const count = this.gather(box);
    for (let index = 0; index < count; index += 1) {
      const collider = this.colliders[this.scratch[index] as number] as Collider;
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
