/** Axis-aligned bounding boxes - the V0.0 collision primitive. */

import { cloneVec3, copyVec3, vec3, type ReadonlyVec3, type Vec3 } from '../../core/vec3.js';

export type Axis = 'x' | 'y' | 'z';

export const AXES: readonly Axis[] = ['x', 'y', 'z'];

export interface AABB {
  min: Vec3;
  max: Vec3;
}

export function createAABB(min: ReadonlyVec3, max: ReadonlyVec3): AABB {
  return { min: cloneVec3(min), max: cloneVec3(max) };
}

/** Builds a box from its centre and full extents. */
export function aabbFromCenterSize(center: ReadonlyVec3, size: ReadonlyVec3): AABB {
  const halfX = size.x / 2;
  const halfY = size.y / 2;
  const halfZ = size.z / 2;
  return {
    min: vec3(center.x - halfX, center.y - halfY, center.z - halfZ),
    max: vec3(center.x + halfX, center.y + halfY, center.z + halfZ),
  };
}

/**
 * Builds the player's collision box from the position of their **feet**
 * (the centre of the bottom face), the half-width and the total height.
 */
export function aabbFromFeet(position: ReadonlyVec3, radius: number, height: number): AABB {
  return {
    min: vec3(position.x - radius, position.y, position.z - radius),
    max: vec3(position.x + radius, position.y + height, position.z + radius),
  };
}

export function copyAABB(out: AABB, source: AABB): AABB {
  copyVec3(out.min, source.min);
  copyVec3(out.max, source.max);
  return out;
}

/**
 * Strict overlap test: boxes that merely touch are *not* overlapping.
 *
 * That distinction matters because the solver leaves a hair-thin skin between
 * the player and a surface; a non-strict test would report a permanent
 * collision while standing still.
 */
export function overlaps(a: AABB, b: AABB): boolean {
  return (
    a.min.x < b.max.x &&
    a.max.x > b.min.x &&
    a.min.y < b.max.y &&
    a.max.y > b.min.y &&
    a.min.z < b.max.z &&
    a.max.z > b.min.z
  );
}

/**
 * Overlap test against `box` translated by `amount` on a single axis.
 *
 * The two unshifted axes are tested normally; for the shifted axis the box is
 * moved first. Used by the ground probe, which must answer "would I be
 * touching something after dropping by `amount`?" without mutating the box.
 */
export function overlapsWhenOffset(box: AABB, axis: Axis, amount: number, other: AABB): boolean {
  for (const candidate of AXES) {
    const min = box.min[candidate] + (candidate === axis ? amount : 0);
    const max = box.max[candidate] + (candidate === axis ? amount : 0);
    if (min >= other.max[candidate] || max <= other.min[candidate]) return false;
  }
  return true;
}

export function containsPoint(box: AABB, point: ReadonlyVec3): boolean {
  return (
    point.x >= box.min.x &&
    point.x <= box.max.x &&
    point.y >= box.min.y &&
    point.y <= box.max.y &&
    point.z >= box.min.z &&
    point.z <= box.max.z
  );
}

export function centerOf(box: AABB): Vec3 {
  return vec3(
    (box.min.x + box.max.x) / 2,
    (box.min.y + box.max.y) / 2,
    (box.min.z + box.max.z) / 2,
  );
}

export function sizeOf(box: AABB): Vec3 {
  return vec3(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z);
}

export function thicknessOn(box: AABB, axis: Axis): number {
  return box.max[axis] - box.min[axis];
}

/** Smallest extent across all three axes. */
export function minThickness(box: AABB): number {
  return Math.min(thicknessOn(box, 'x'), thicknessOn(box, 'y'), thicknessOn(box, 'z'));
}
