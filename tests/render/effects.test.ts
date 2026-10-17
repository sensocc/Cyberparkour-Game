/**
 * The visual effects.
 *
 * Smoke drifts and pickups bob and spin, and both are pure functions of the
 * clock - so they can be checked here rather than by watching a browser. The
 * shapes matter: a puff that pops into existence, or a pickup whose bob is the
 * same on every one, looks wrong in a way no screenshot catches.
 */

import { describe, expect, it } from 'vitest';

import {
  emptyPickupPose,
  emptySpritePose,
  pickupPose,
  smokePose,
  type SmokeEmitter,
} from '../../src/render/effects.js';

const EMITTER: SmokeEmitter = {
  position: { x: 10, y: 0, z: -4 },
  radius: 2,
  rise: 8,
  drift: 3,
  period: 10,
  opacity: 0.5,
  phase: 0,
};

/** A scratch pose per call: the production path reuses one, and the tests do not care. */
const emptyPose = () => emptySpritePose();

describe('smokePose', () => {
  it('is transparent at both ends of its life, so nothing pops', () => {
    expect(smokePose(EMITTER, 0, emptyPose()).opacity).toBeCloseTo(0, 9);
    expect(smokePose(EMITTER, 5, emptyPose()).opacity).toBeCloseTo(0.5, 9);
    expect(smokePose(EMITTER, 9.999, emptyPose()).opacity).toBeLessThan(0.01);
  });

  it('climbs steadily over its cycle', () => {
    expect(smokePose(EMITTER, 0, emptyPose()).y).toBeCloseTo(0, 9);
    expect(smokePose(EMITTER, 5, emptyPose()).y).toBeCloseTo(4, 9);
    expect(smokePose(EMITTER, 9, emptyPose()).y).toBeCloseTo(7.2, 9);
  });

  it('grows as it rises and thins out, like a plume', () => {
    const early = smokePose(EMITTER, 1, emptyPose()).scale;
    const late = smokePose(EMITTER, 9, emptyPose()).scale;
    expect(late).toBeGreaterThan(early);
  });

  it('wanders sideways, but only a little', () => {
    let maxSway = 0;
    for (let t = 0; t < 10; t += 0.1) {
      maxSway = Math.max(maxSway, Math.abs(smokePose(EMITTER, t, emptyPose()).x - EMITTER.position.x));
    }
    expect(maxSway).toBeGreaterThan(0);
    expect(maxSway).toBeLessThanOrEqual(EMITTER.drift + 1e-9);
  });

  it('wraps: after a full period it is back where it started', () => {
    const start = smokePose(EMITTER, 0, emptyPose());
    const wrapped = smokePose(EMITTER, EMITTER.period, emptyPose());
    expect(wrapped.opacity).toBeCloseTo(start.opacity, 9);
    expect(wrapped.y).toBeCloseTo(start.y, 9);
    expect(wrapped.x).toBeCloseTo(start.x, 9);
    expect(wrapped.z).toBeCloseTo(start.z, 9);
  });

  it('offsets by phase, so a plume is not one puff', () => {
    const first = smokePose(EMITTER, 2, emptyPose());
    const second = smokePose({ ...EMITTER, phase: 0.5 }, 2, emptyPose());
    expect(second.y).not.toBeCloseTo(first.y, 3);
  });

  it('survives a nonsense period rather than dividing by zero', () => {
    expect(Number.isFinite(smokePose({ ...EMITTER, period: 0 }, 3, emptyPose()).y)).toBe(true);
  });
});

describe('pickupPose', () => {
  const HOME = { x: 3, y: 5, z: 2 };

  it('bobs around where it was placed', () => {
    let lowest = Number.POSITIVE_INFINITY;
    let highest = Number.NEGATIVE_INFINITY;
    const out = emptyPickupPose();
    for (let t = 0; t < 10; t += 0.05) {
      pickupPose(HOME, t, out);
      lowest = Math.min(lowest, out.y);
      highest = Math.max(highest, out.y);
    }
    expect(lowest).toBeGreaterThanOrEqual(HOME.y - 0.18);
    expect(highest).toBeLessThanOrEqual(HOME.y + 0.18);
  });

  it('spins steadily', () => {
    const out = emptyPickupPose();
    pickupPose(HOME, 0, out);
    expect(out.spin).toBe(0);
    pickupPose(HOME, 1, out);
    expect(out.spin).toBeGreaterThan(0);
    const atOne = out.spin;
    pickupPose(HOME, 2, out);
    expect(out.spin).toBeGreaterThan(atOne);
  });

  it('offsets the bob by the pickup’s own position, so a row is not in unison', () => {
    const other = { x: HOME.x + 2, y: HOME.y, z: HOME.z };
    const a = emptyPickupPose();
    const b = emptyPickupPose();
    pickupPose(other, 0.4, a);
    pickupPose(HOME, 0.4, b);
    expect(a.y).not.toBeCloseTo(b.y, 6);
  });
});
