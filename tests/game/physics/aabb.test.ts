import { describe, expect, it } from 'vitest';

import { vec3 } from '../../../src/core/vec3.js';
import {
  aabbFromCenterSize,
  aabbFromFeet,
  centerOf,
  containsPoint,
  copyAABB,
  createAABB,
  minThickness,
  overlaps,
  overlapsWhenOffset,
  sizeOf,
  thicknessOn,
  type AABB,
} from '../../../src/game/physics/aabb.js';

const unit = (): AABB => createAABB(vec3(0, 0, 0), vec3(1, 1, 1));

describe('AABB construction', () => {
  it('createAABB copies its inputs', () => {
    const min = vec3(1, 2, 3);
    const max = vec3(4, 5, 6);
    const box = createAABB(min, max);

    min.x = 99;
    expect(box.min.x).toBe(1);
    expect(box.max).toEqual({ x: 4, y: 5, z: 6 });
  });

  it('aabbFromCenterSize centres the extents', () => {
    const box = aabbFromCenterSize(vec3(10, 0, -10), vec3(2, 4, 6));
    expect(box.min).toEqual({ x: 9, y: -2, z: -13 });
    expect(box.max).toEqual({ x: 11, y: 2, z: -7 });
  });

  it('aabbFromFeet grows upward from the feet position', () => {
    const box = aabbFromFeet(vec3(1, 0, 2), 0.35, 1.8);
    expect(box.min.x).toBeCloseTo(0.65, 12);
    expect(box.min.y).toBe(0);
    expect(box.min.z).toBeCloseTo(1.65, 12);
    expect(box.max.y).toBeCloseTo(1.8, 12);
    expect(box.max.x).toBeCloseTo(1.35, 12);
  });

  it('copyAABB writes into the target', () => {
    const target = unit();
    const source = createAABB(vec3(-1, -2, -3), vec3(4, 5, 6));
    expect(copyAABB(target, source)).toBe(target);
    expect(target.min).toEqual({ x: -1, y: -2, z: -3 });
    expect(target.max).toEqual({ x: 4, y: 5, z: 6 });
  });
});

describe('overlaps', () => {
  it('detects a clear overlap', () => {
    expect(overlaps(unit(), createAABB(vec3(0.5, 0.5, 0.5), vec3(2, 2, 2)))).toBe(true);
  });

  it('treats touching faces as NOT overlapping', () => {
    const a = createAABB(vec3(0, 0, 0), vec3(1, 1, 1));
    const b = createAABB(vec3(1, 0, 0), vec3(2, 1, 1));
    expect(overlaps(a, b)).toBe(false);
    expect(overlaps(b, a)).toBe(false);
  });

  it('separates along each axis independently', () => {
    const a = createAABB(vec3(0, 0, 0), vec3(1, 1, 1));
    expect(overlaps(a, createAABB(vec3(2, 0, 0), vec3(3, 1, 1)))).toBe(false);
    expect(overlaps(a, createAABB(vec3(0, 2, 0), vec3(1, 3, 1)))).toBe(false);
    expect(overlaps(a, createAABB(vec3(0, 0, 2), vec3(1, 1, 3)))).toBe(false);
  });

  it('is symmetric and reflexive for a non-degenerate box', () => {
    const a = createAABB(vec3(0, 0, 0), vec3(1, 1, 1));
    const b = createAABB(vec3(0.2, 0.2, 0.2), vec3(0.8, 0.8, 0.8));
    expect(overlaps(a, b)).toBe(overlaps(b, a));
    expect(overlaps(a, a)).toBe(true);
  });
});

describe('overlapsWhenOffset', () => {
  const ground = createAABB(vec3(-10, -1, -10), vec3(10, 0, 10));

  it('reports contact after dropping onto a surface', () => {
    // Feet exactly on the surface: a 2 cm drop must register contact.
    const feet = aabbFromFeet(vec3(0, 0, 0), 0.35, 1.8);
    expect(overlapsWhenOffset(feet, 'y', -0.02, ground)).toBe(true);
  });

  it('reports no contact when the gap is larger than the offset', () => {
    const hovering = aabbFromFeet(vec3(0, 0.5, 0), 0.35, 1.8);
    expect(overlapsWhenOffset(hovering, 'y', -0.02, ground)).toBe(false);
  });

  it('agrees with overlaps for a zero offset', () => {
    const feet = aabbFromFeet(vec3(0, 0.5, 0), 0.35, 1.8);
    expect(overlapsWhenOffset(feet, 'y', 0, ground)).toBe(overlaps(feet, ground));
  });

  it('does not mutate the box', () => {
    const box = aabbFromFeet(vec3(0, 1, 0), 0.35, 1.8);
    const snapshot = { min: { ...box.min }, max: { ...box.max } };
    overlapsWhenOffset(box, 'y', -5, ground);
    expect(box.min).toEqual(snapshot.min);
    expect(box.max).toEqual(snapshot.max);
  });

  it('moves along the requested axis only', () => {
    // The obstacle sits to the box's -X, reaching exactly to x = -4.
    const obstacle = createAABB(vec3(-5, 0, 0), vec3(-4, 1, 1));
    const box = createAABB(vec3(-3, 0, 0), vec3(-2, 1, 1));

    // One metre to -X leaves the two boxes flush: touching is not overlapping.
    expect(overlapsWhenOffset(box, 'x', -1, obstacle)).toBe(false);
    // Two metres puts the box inside the obstacle.
    expect(overlapsWhenOffset(box, 'x', -2, obstacle)).toBe(true);
    // The same displacement on Y or +X changes nothing.
    expect(overlapsWhenOffset(box, 'y', -2, obstacle)).toBe(false);
    expect(overlapsWhenOffset(box, 'x', 2, obstacle)).toBe(false);
  });
});

describe('measurements', () => {
  it('centerOf and sizeOf describe the box', () => {
    const box = createAABB(vec3(-1, -1, -1), vec3(3, 5, 7));
    expect(centerOf(box)).toEqual({ x: 1, y: 2, z: 3 });
    expect(sizeOf(box)).toEqual({ x: 4, y: 6, z: 8 });
  });

  it('thicknessOn reads a single axis', () => {
    const box = createAABB(vec3(0, 0, 0), vec3(2, 3, 4));
    expect(thicknessOn(box, 'x')).toBe(2);
    expect(thicknessOn(box, 'y')).toBe(3);
    expect(thicknessOn(box, 'z')).toBe(4);
  });

  it('minThickness finds the thinnest dimension', () => {
    expect(minThickness(createAABB(vec3(0, 0, 0), vec3(2, 0.5, 4)))).toBe(0.5);
    expect(minThickness(unit())).toBe(1);
  });

  it('containsPoint is inclusive of the boundary', () => {
    const box = createAABB(vec3(0, 0, 0), vec3(1, 1, 1));
    expect(containsPoint(box, vec3(0.5, 0.5, 0.5))).toBe(true);
    expect(containsPoint(box, vec3(0, 0, 0))).toBe(true);
    expect(containsPoint(box, vec3(1, 1, 1))).toBe(true);
    expect(containsPoint(box, vec3(1.0001, 0.5, 0.5))).toBe(false);
  });
});
