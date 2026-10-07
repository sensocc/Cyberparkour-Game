import { describe, expect, it } from 'vitest';

import {
  addScaledVec3,
  addVec3,
  cloneVec3,
  copyVec3,
  dotVec3,
  equalsVec3,
  lengthSqVec3,
  lengthVec3,
  lengthXZ,
  lerpVec3,
  normalizeVec3,
  scaleVec3,
  setVec3,
  subVec3,
  vec3,
  yawBasis,
  type Vec3,
} from '../../src/core/vec3.js';

const out = (): Vec3 => vec3();

describe('vec3 basics', () => {
  it('defaults to the origin', () => {
    expect(vec3()).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('clone and copy produce independent values', () => {
    const source = vec3(1, 2, 3);
    const cloned = cloneVec3(source);
    expect(cloned).toEqual(source);
    expect(cloned).not.toBe(source);

    const target = vec3();
    expect(copyVec3(target, source)).toBe(target);
    expect(target).toEqual(source);
  });

  it('setVec3 writes all three components', () => {
    const target = out();
    expect(setVec3(target, 4, 5, 6)).toBe(target);
    expect(target).toEqual({ x: 4, y: 5, z: 6 });
  });

  it('add / sub / scale return the out object', () => {
    const a = vec3(1, 2, 3);
    const b = vec3(10, 20, 30);
    const target = out();

    expect(addVec3(target, a, b)).toBe(target);
    expect(target).toEqual({ x: 11, y: 22, z: 33 });

    subVec3(target, b, a);
    expect(target).toEqual({ x: 9, y: 18, z: 27 });

    scaleVec3(target, a, 2);
    expect(target).toEqual({ x: 2, y: 4, z: 6 });
  });

  it('addScaledVec3 computes a + b * scalar', () => {
    const target = out();
    addScaledVec3(target, vec3(1, 1, 1), vec3(2, 4, 6), 0.5);
    expect(target).toEqual({ x: 2, y: 3, z: 4 });
  });

  it('supports an aliased out parameter', () => {
    const target = vec3(1, 2, 3);
    addVec3(target, target, vec3(1, 1, 1));
    expect(target).toEqual({ x: 2, y: 3, z: 4 });
  });
});

describe('vec3 measurements', () => {
  it('dot and length', () => {
    expect(dotVec3(vec3(1, 2, 3), vec3(4, -5, 6))).toBe(12);
    expect(lengthVec3(vec3(3, 4, 0))).toBeCloseTo(5, 12);
    expect(lengthSqVec3(vec3(3, 4, 0))).toBe(25);
    expect(lengthVec3(vec3())).toBe(0);
  });

  it('lengthXZ ignores the vertical component', () => {
    expect(lengthXZ(vec3(3, 100, 4))).toBeCloseTo(5, 12);
  });

  it('equalsVec3 compares per component with a tolerance', () => {
    expect(equalsVec3(vec3(1, 2, 3), vec3(1, 2, 3))).toBe(true);
    expect(equalsVec3(vec3(1, 2, 3), vec3(1, 2, 4))).toBe(false);
    expect(equalsVec3(vec3(1, 2, 3), vec3(1.0000001, 2, 3), 1e-4)).toBe(true);
  });
});

describe('normalizeVec3', () => {
  it('produces a unit vector', () => {
    const target = out();
    normalizeVec3(target, vec3(0, 0, -5));
    // Object.is-style equality would trip over the -0 that 0 * -0.2 produces,
    // so compare numerically.
    expect(target.x).toBeCloseTo(0, 12);
    expect(target.y).toBeCloseTo(0, 12);
    expect(target.z).toBeCloseTo(-1, 12);
    expect(lengthVec3(target)).toBeCloseTo(1, 12);
  });

  it('normalizes an arbitrary direction', () => {
    const target = out();
    normalizeVec3(target, vec3(3, 0, 4));
    expect(target.x).toBeCloseTo(0.6, 12);
    expect(target.z).toBeCloseTo(0.8, 12);
  });

  it('yields zero for a zero-length input instead of NaN', () => {
    const target = out();
    normalizeVec3(target, vec3());
    expect(target).toEqual({ x: 0, y: 0, z: 0 });
    expect(Number.isNaN(target.x)).toBe(false);
  });
});

describe('lerpVec3', () => {
  it('interpolates per component', () => {
    const target = out();
    lerpVec3(target, vec3(0, 0, 0), vec3(10, 20, 30), 0.25);
    expect(target).toEqual({ x: 2.5, y: 5, z: 7.5 });
  });

  it('returns the endpoints at t = 0 and t = 1', () => {
    const target = out();
    lerpVec3(target, vec3(1, 2, 3), vec3(4, 5, 6), 0);
    expect(target).toEqual({ x: 1, y: 2, z: 3 });
    lerpVec3(target, vec3(1, 2, 3), vec3(4, 5, 6), 1);
    expect(target).toEqual({ x: 4, y: 5, z: 6 });
  });
});

describe('yawBasis', () => {
  it('at yaw 0 looks down -Z with +X to the right', () => {
    const { forward, right } = yawBasis(0);
    expect(forward.x).toBeCloseTo(0, 12);
    expect(forward.z).toBeCloseTo(-1, 12);
    expect(right.x).toBeCloseTo(1, 12);
    expect(right.z).toBeCloseTo(0, 12);
  });

  it('turns left as yaw increases', () => {
    const { forward } = yawBasis(Math.PI / 2);
    // Facing -Z, the player's left is -X.
    expect(forward.x).toBeCloseTo(-1, 12);
    expect(forward.z).toBeCloseTo(0, 12);
  });

  it('keeps forward and right orthogonal, horizontal and unit length', () => {
    for (const yaw of [0, 0.7, Math.PI / 3, -2.4, 5.9]) {
      const { forward, right } = yawBasis(yaw);
      expect(forward.y).toBe(0);
      expect(right.y).toBe(0);
      expect(lengthVec3(forward)).toBeCloseTo(1, 12);
      expect(lengthVec3(right)).toBeCloseTo(1, 12);
      expect(dotVec3(forward, right)).toBeCloseTo(0, 12);

      // right = forward x up, i.e. the familiar right-handed FPS basis.
      expect(right.x).toBeCloseTo(-forward.z, 12);
      expect(right.z).toBeCloseTo(forward.x, 12);
    }
  });
});
