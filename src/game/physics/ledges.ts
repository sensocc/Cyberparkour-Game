/**
 * Ledge, wall and obstacle probing, for mantling, pull-ups, climbing, wall
 * running and vaulting.
 *
 * Mantling, pull-ups and climbing all ask the same question - "is there a face I
 * could get up, and is there room to stand on top of it?" - so they share one
 * query. Wall running asks a different one ("is there a wall beside me that I
 * could hold on to?") and vaulting a third ("is there a waist-high box I could
 * cross, and is there floor on the far side?"), so each gets its own function
 * here. What the queries have in common is that they are geometry only: which
 * height band counts as a mantle rather than a grab is a movement decision and
 * lives with the rest of the movement config.
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

// ------------------------------------------------------------- wall running

/** The four horizontal directions a wall is probed in. */
const SIDE_AXES: readonly ReadonlyVec3[] = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 },
];

export interface WallHit {
  readonly collider: Collider;
  /** Horizontal unit vector from the player towards the wall. */
  readonly direction: Vec3;
  /** World Y of the wall's top. */
  readonly topY: number;
  /** Gap between the player's box and the wall face, in metres. */
  readonly distance: number;
}

export interface WallQuery {
  readonly world: CollisionWorld;
  readonly box: AABB;
  /** Horizontal direction of travel. Walls parallel to it are the candidates. */
  readonly travel: ReadonlyVec3;
  /** How far to the side to look, in metres. */
  readonly reach: number;
  /** A wall only counts if its top rises this far above the player's feet. */
  readonly minHeight: number;
  /** Collider the player is standing on, which can never be the wall. */
  readonly ignoreId?: string | null;
  /** Wall that may not be used (the one just jumped off). */
  readonly ignoreWallId?: string | null;
}

/**
 * Finds the nearest wall beside the player that they could run along.
 *
 * Only walls *parallel* to the direction of travel count - a face straight ahead
 * is something to run into or climb, not along - which is why the probe skips any
 * axis the travel direction is already aligned with. Of the walls that qualify,
 * the nearest wins, so a player in a corridor attaches to the side they are
 * closest to rather than picking arbitrarily.
 */
export function findWallRunSurface(query: WallQuery): WallHit | null {
  const travel = normalizeVec3(vec3(), query.travel);
  const minTopY = query.box.min.y + query.minHeight;
  let best: WallHit | null = null;

  for (const axis of SIDE_AXES) {
    if (Math.abs(axis.x * travel.x + axis.z * travel.z) > 0.9) continue;

    let bestOnAxis: WallHit | null = null;
    for (const collider of query.world.colliders) {
      if (collider.id === query.ignoreId) continue;
      if (collider.id === query.ignoreWallId) continue;
      // Tall enough to be a wall, and tall enough to still be beside the player.
      if (collider.box.max.y < minTopY) continue;
      if (collider.box.min.y > query.box.max.y) continue;
      if (!overlapsForward(query.box, axis, query.reach, collider.box)) continue;

      const distance = faceDistance(query.box, axis, collider.box);
      if (bestOnAxis === null || distance < bestOnAxis.distance) {
        bestOnAxis = { collider, direction: vec3(axis.x, 0, axis.z), topY: collider.box.max.y, distance };
      }
    }

    if (bestOnAxis && (best === null || bestOnAxis.distance < best.distance)) best = bestOnAxis;
  }

  return best;
}

/** Gap from the player's box to a collider's face on the given axis. */
function faceDistance(box: AABB, direction: ReadonlyVec3, other: AABB): number {
  if (direction.x > 0.5) return Math.max(0, other.min.x - box.max.x);
  if (direction.x < -0.5) return Math.max(0, box.min.x - other.max.x);
  if (direction.z > 0.5) return Math.max(0, other.min.z - box.max.z);
  return Math.max(0, box.min.z - other.max.z);
}

// ------------------------------------------------------------------ vaulting

export interface VaultHit {
  readonly collider: Collider;
  /** World Y of the top of the obstacle. */
  readonly topY: number;
  /** Horizontal unit vector from the player towards the obstacle. */
  readonly direction: Vec3;
  /** Where the player's feet land, on the far side. */
  readonly landing: Vec3;
}

export interface VaultQuery {
  readonly world: CollisionWorld;
  readonly box: AABB;
  /** Horizontal direction of travel. */
  readonly direction: ReadonlyVec3;
  readonly reach: number;
  readonly minTopY: number;
  readonly maxTopY: number;
  /** Obstacles deeper than this are walls, and cannot be crossed. */
  readonly maxDepth: number;
  /** How far past the obstacle's near face the player lands. */
  readonly landingGap: number;
  /** How far below the landing spot the ground must be (m). */
  readonly supportDepth: number;
  readonly radius: number;
  readonly standHeight: number;
  readonly ignoreId?: string | null;
}

/**
 * Finds a waist-high obstacle the player could cross.
 *
 * The difference from a mantle is what is on the far side: a mantle ends *on top*
 * of the obstacle, a vault ends *past* it, still on the floor. So this query asks
 * for floor beyond the obstacle instead of room above it, and rejects anything
 * too deep to cross in one move - otherwise a player could "vault" a 20 m table.
 */
export function findVaultObstacle(query: VaultQuery): VaultHit | null {
  const direction = normalizeVec3(vec3(), query.direction);
  if (direction.x === 0 && direction.z === 0) return null;

  let best: VaultHit | null = null;

  for (const collider of query.world.colliders) {
    if (collider.id === query.ignoreId) continue;

    const topY = collider.box.max.y;
    if (topY < query.minTopY || topY > query.maxTopY) continue;
    if (!overlapsForward(query.box, direction, query.reach, collider.box)) continue;

    const depth = direction.x !== 0
      ? collider.box.max.x - collider.box.min.x
      : collider.box.max.z - collider.box.min.z;
    if (depth > query.maxDepth) continue;

    const landing = vaultLanding(query, direction, collider);
    if (!query.world.isFree(vaultLandingBox(query, landing))) continue;
    if (!hasSupportBelow(query, landing)) continue;

    if (best === null || topY > best.topY) best = { collider, topY, direction: copyVec3(vec3(), direction), landing };
  }

  return best;
}

/** Where the player's feet end up: one landing gap past the near face. */
function vaultLanding(query: VaultQuery, direction: ReadonlyVec3, collider: Collider): Vec3 {
  const centreX = (query.box.min.x + query.box.max.x) / 2;
  const centreZ = (query.box.min.z + query.box.max.z) / 2;
  const nearX = direction.x > 0 ? collider.box.min.x : collider.box.max.x;
  const nearZ = direction.z > 0 ? collider.box.min.z : collider.box.max.z;
  return vec3(
    direction.x !== 0 ? nearX + direction.x * query.landingGap : centreX,
    query.box.min.y + COLLISION_SKIN,
    direction.z !== 0 ? nearZ + direction.z * query.landingGap : centreZ,
  );
}

function vaultLandingBox(query: VaultQuery, feet: Vec3): AABB {
  return aabbFromCenterSize(
    { x: feet.x, y: feet.y + query.standHeight / 2, z: feet.z },
    { x: query.radius * 2, y: query.standHeight, z: query.radius * 2 },
  );
}

/**
 * Is there floor within `supportDepth` below the landing spot?
 *
 * Vaulting over a parapet and out of the level would be a trap rather than a
 * move, so an obstacle only counts if there is something to land on.
 */
function hasSupportBelow(query: VaultQuery, feet: Vec3): boolean {
  const below = aabbFromCenterSize(
    { x: feet.x, y: feet.y - query.supportDepth / 2, z: feet.z },
    { x: query.radius * 2, y: query.supportDepth, z: query.radius * 2 },
  );
  return !query.world.isFree(below);
}
