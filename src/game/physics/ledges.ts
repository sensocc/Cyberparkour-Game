/**
 * Ledge probing, for mantling, pull-ups and climbing.
 *
 * All three abilities ask the same question - "is there a face I could get up,
 * and is there room to stand on top of it?" - so they share one query. The query
 * is geometry only: which height band counts as a mantle rather than a grab is a
 * movement decision and lives with the rest of the movement config.
 */

import { aabbFromCenterSize, overlapsWhenOffset, type AABB } from './aabb.js';
import { COLLISION_SKIN, type Collider, type CollisionWorld } from './collision.js';
import { copyVec3, normalizeVec3, vec3, type ReadonlyVec3, type Vec3 } from '../../core/vec3.js';

export interface LedgeHit {
  readonly collider: Collider;
  /** World Y of the flat top of the ledge. */
  readonly topY: number;
  /** Horizontal unit vector from the player towards the ledge. */
  readonly direction: Vec3;
}

export interface LedgeQuery {
  readonly world: CollisionWorld;
  /** The player's collision box, in world space. */
  readonly box: AABB;
  /** Horizontal direction to look in. Does not need to be normalised. */
  readonly direction: ReadonlyVec3;
  /** How far ahead of the box to look, in metres. */
  readonly reach: number;
  /** Ignore anything whose top is below this Y. */
  readonly minTopY: number;
  /** Ignore anything whose top is above this Y. */
  readonly maxTopY: number;
  /** Player radius, for the landing-space test. */
  readonly radius: number;
  /** Standing height, so the landing space is tested at full height. */
  readonly standHeight: number;
  /** Collider the player is standing on, which can never be the ledge. */
  readonly ignoreId?: string | null;
}

/**
 * Finds the highest ledge the player is facing inside a height band.
 *
 * A ledge counts only if a standing player would fit on top of it, which is what
 * stops the game from starting a mantle into a space that has no room for the
 * body it is about to move there.
 */
export function findLedge(query: LedgeQuery): LedgeHit | null {
  const direction = normalizeVec3(vec3(), query.direction);
  if (direction.x === 0 && direction.z === 0) return null;

  const probe: AABB = {
    min: { ...query.box.min },
    max: { ...query.box.max },
  };

  let best: LedgeHit | null = null;

  for (const collider of query.world.colliders) {
    if (collider.id === query.ignoreId) continue;

    const topY = collider.box.max.y;
    if (topY < query.minTopY || topY > query.maxTopY) continue;

    // Is the player up against it, or within reach of it?
    if (!overlapsForward(probe, direction, query.reach, collider.box)) continue;

    // Is there room to stand on top?
    const landing = landingBox(query, direction, topY);
    if (!query.world.isFree(landing)) continue;

    if (best === null || topY > best.topY) {
      best = { collider, topY, direction: copyVec3(vec3(), direction) };
    }
  }

  return best;
}

/** Overlap test for the player's box translated forward along the direction. */
export function overlapsForward(box: AABB, direction: ReadonlyVec3, distance: number, other: AABB): boolean {
  // The direction is axis-aligned in practice (the player is either pushed into
  // a face or probing along one axis), so resolving it into a single-axis offset
  // test keeps this exact rather than approximated.
  const shifted: AABB = {
    min: {
      x: box.min.x + direction.x * distance,
      y: box.min.y,
      z: box.min.z + direction.z * distance,
    },
    max: {
      x: box.max.x + direction.x * distance,
      y: box.max.y,
      z: box.max.z + direction.z * distance,
    },
  };
  return overlapsWhenOffset(shifted, 'y', 0, other);
}

/**
 * Where the player's feet would be if they stood on top of the ledge.
 *
 * The height is one collision skin *above* the ledge, which is both where the
 * solver would leave them and, crucially, the difference between working and not
 * working. Asking for exactly `topY` lets rounding decide whether the landing box
 * overlaps the ledge by 1e-16, and a strict overlap test then reads that as "no
 * room to stand" - which silently made some ledges unmantleable depending on
 * nothing more than the height's last bit.
 */
export function landingFeet(query: LedgeQuery, direction: ReadonlyVec3, topY: number): Vec3 {
  const travel = query.reach + query.radius;
  return vec3(
    (query.box.min.x + query.box.max.x) / 2 + direction.x * travel,
    topY + COLLISION_SKIN,
    (query.box.min.z + query.box.max.z) / 2 + direction.z * travel,
  );
}

function landingBox(query: LedgeQuery, direction: ReadonlyVec3, topY: number): AABB {
  const feet = landingFeet(query, direction, topY);
  return aabbFromCenterSize(
    { x: feet.x, y: feet.y + query.standHeight / 2, z: feet.z },
    { x: query.radius * 2, y: query.standHeight, z: query.radius * 2 },
  );
}

/**
 * Finds a climbable face within reach whose top is well above the feet.
 *
 * `minHeight` is what stops the player from "climbing" a kerb: only faces that
 * genuinely tower over them qualify.
 */
export function findClimbable(query: LedgeQuery & { readonly climbableIds: ReadonlySet<string> }): Collider | null {
  const direction = normalizeVec3(vec3(), query.direction);
  if (direction.x === 0 && direction.z === 0) return null;

  const feetY = query.box.min.y;
  let best: Collider | null = null;

  for (const collider of query.world.colliders) {
    if (collider.id === query.ignoreId) continue;
    if (!query.climbableIds.has(collider.id)) continue;
    if (collider.box.max.y < feetY + query.minTopY) continue;
    if (!overlapsForward(query.box, direction, query.reach, collider.box)) continue;

    if (best === null || collider.box.max.y > best.box.max.y) best = collider;
  }

  return best;
}
