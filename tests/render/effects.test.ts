/**
 * The visual effects.
 *
 * Smoke drifts and pickups bob and spin, and both are pure functions of the
 * clock - so they can be checked here rather than by watching a browser. The
 * shapes matter: a puff that pops into existence, or a pickup whose bob is the
 * same on every one, looks wrong in a way no screenshot catches.
 */

import { describe, expect, it } from 'vitest';

import { pickupPose, smokePose, type SmokeEmitter } from '../../src/render/effects.js';

const EMITTER: SmokeEmitter = {
  position: { x: 10, y: 0, z: -4 },
  radius: 2,
  rise: 8,
  drift: 3,
  period: 10,
  opacity: 0.5,
  phase: 0,
};

describe('smokePose', () => {
  it('is transparent at both ends of its life, so nothing pops', () => {
    expect(smokePose(EMITTER, 0).opacity).toBeCloseTo(0, 9);
    expect(smokePose(EMITTER, 5).opacity).toBeCloseTo(0.5, 9);
    expect(smokePose(EMITTER, 9.999).opacity).toBeLessThan(0.01);
  });

  it('climbs steadily over its cycle', () => {
    expect(smokePose(EMITTER, 0).y).toBeCloseTo(0, 9);
    expect(smokePose(EMITTER, 5).y).toBeCloseTo(4, 9);
    expect(smokePose(EMITTER, 9).y).toBeCloseTo(7.2, 9);
  });

  it('grows as it rises and thins out, like a plume', () => {
    const early = smokePose(EMITTER, 1).scale;
    const late = smokePose(EMITTER, 9).scale;
    expect(late).toBeGreaterThan(early);
  });

  it('wanders sideways, but only a little', () => {
    let maxSway = 0;
    for (let t = 0; t < 10; t += 0.1) {
      maxSway = Math.max(maxSway, Math.abs(smokePose(EMITTER, t).x - EMITTER.position.x));
    }
    expect(maxSway).toBeGreaterThan(0);
    expect(maxSway).toBeLessThanOrEqual(EMITTER.drift + 1e-9);
  });

  it('wraps: after a full period it is back where it started', () => {
    const start = smokePose(EMITTER, 0);
    const wrapped = smokePose(EMITTER, EMITTER.period);
    expect(wrapped.opacity).toBeCloseTo(start.opacity, 9);
    expect(wrapped.y).toBeCloseTo(start.y, 9);
    expect(wrapped.x).toBeCloseTo(start.x, 9);
    expect(wrapped.z).toBeCloseTo(start.z, 9);
  });

  it('offsets by phase, so a plume is not one puff', () => {
    const first = smokePose(EMITTER, 2);
    const second = smokePose({ ...EMITTER, phase: 0.5 }, 2);
    expect(second.y).not.toBeCloseTo(first.y, 3);
  });

  it('survives a nonsense period rather than dividing by zero', () => {
    expect(Number.isFinite(smokePose({ ...EMITTER, period: 0 }, 3).y)).toBe(true);
  });
});

describe('pickupPose', () => {
  const HOME = { x: 3, y: 5, z: 2 };

  it('bobs around where it was placed', () => {
    let lowest = Number.POSITIVE_INFINITY;
    let highest = Number.NEGATIVE_INFINITY;
    for (let t = 0; t < 10; t += 0.05) {
      const { y } = pickupPose(HOME, t);
      lowest = Math.min(lowest, y);
      highest = Math.max(highest, y);
    }
    expect(lowest).toBeGreaterThanOrEqual(HOME.y - 0.18);
    expect(highest).toBeLessThanOrEqual(HOME.y + 0.18);
  });

  it('spins steadily', () => {
    expect(pickupPose(HOME, 0).spin).toBe(0);
    expect(pickupPose(HOME, 1).spin).toBeGreaterThan(0);
    expect(pickupPose(HOME, 2).spin).toBeGreaterThan(pickupPose(HOME, 1).spin);
  });

  it('offsets the bob by the pickup’s own position, so a row is not in unison', () => {
    const other = { x: HOME.x + 2, y: HOME.y, z: HOME.z };
    expect(pickupPose(other, 0.4).y).not.toBeCloseTo(pickupPose(HOME, 0.4).y, 6);
  });
});
