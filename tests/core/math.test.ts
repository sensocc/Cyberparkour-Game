import { describe, expect, it } from 'vitest';

import {
  approach,
  approxEquals,
  clamp,
  clamp01,
  damp,
  degToRad,
  invLerp,
  lerp,
  radToDeg,
  wrapAngle,
} from '../../src/core/math.js';

describe('clamp', () => {
  it('bounds values on both sides', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it('handles inverted and degenerate ranges without throwing', () => {
    expect(clamp(5, 10, 0)).toBe(10);
    expect(clamp(5, 3, 3)).toBe(3);
  });

  it('preserves NaN semantics through comparisons', () => {
    // NaN fails both comparisons, so it falls through unchanged rather than
    // silently becoming a bound.
    expect(Number.isNaN(clamp(Number.NaN, 0, 1))).toBe(true);
  });

  it('clamp01 is clamp to the unit interval', () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(0.4)).toBe(0.4);
    expect(clamp01(2)).toBe(1);
  });
});

describe('lerp / invLerp', () => {
  it('interpolates and extrapolates linearly', () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(10, 20, 0)).toBe(10);
    expect(lerp(10, 20, 1)).toBe(20);
    expect(lerp(0, 10, 2)).toBe(20);
  });

  it('invertLerp undoes lerp', () => {
    expect(invLerp(0, 10, 5)).toBeCloseTo(0.5, 12);
    expect(invLerp(20, 40, 30)).toBeCloseTo(0.5, 12);
  });

  it('invertLerp returns 0 for a degenerate range', () => {
    expect(invLerp(7, 7, 7)).toBe(0);
  });
});

describe('approach', () => {
  it('moves toward the target without overshooting', () => {
    expect(approach(0, 10, 3)).toBe(3);
    expect(approach(10, 0, 3)).toBe(7);
  });

  it('snaps exactly when within reach', () => {
    expect(approach(9.5, 10, 1)).toBe(10);
    expect(approach(9.5, 10, 0.5)).toBe(10);
  });

  it('is a no-op for a zero budget', () => {
    expect(approach(4, 10, 0)).toBe(4);
  });
});

describe('damp', () => {
  it('closes the same fraction of the gap regardless of step count', () => {
    const once = damp(0, 100, 0.5, 1);

    // Two half-second steps must land on the same value as one full second.
    let stepped = 0;
    stepped = damp(stepped, 100, 0.5, 0.5);
    stepped = damp(stepped, 100, 0.5, 0.5);

    expect(stepped).toBeCloseTo(once, 10);
    expect(once).toBeCloseTo(50, 10);
  });

  it('converges monotonically and never overshoots', () => {
    const rate = 0.4;
    const dt = 1 / 60;
    const seconds = 10;
    const steps = seconds / dt;

    let value = 0;
    let previous = 0;
    for (let index = 0; index < steps; index += 1) {
      previous = value;
      value = damp(value, 10, rate, dt);
      expect(value).toBeGreaterThanOrEqual(previous);
      expect(value).toBeLessThanOrEqual(10);
    }

    // The closed form of this recurrence is 10 * (1 - (1 - rate)^seconds), so
    // after ten seconds at 40%/s the remaining gap is 10 * 0.6^10 = 0.0605.
    const expected = 10 * (1 - Math.pow(1 - rate, seconds));
    expect(value).toBeCloseTo(expected, 9);
    expect(value).toBeGreaterThan(9.9);
  });

  it('a rate of 1 snaps immediately and a rate of 0 does nothing', () => {
    expect(damp(0, 100, 1, 1 / 60)).toBe(100);
    expect(damp(3, 100, 0, 1 / 60)).toBe(3);
  });
});

describe('angle helpers', () => {
  it('wrapAngle maps into (-PI, PI]', () => {
    expect(wrapAngle(0)).toBe(0);
    expect(wrapAngle(Math.PI * 2)).toBeCloseTo(0, 12);
    expect(wrapAngle(Math.PI * 2 + 0.5)).toBeCloseTo(0.5, 12);
    expect(wrapAngle(-0.5)).toBeCloseTo(-0.5, 12);
    expect(wrapAngle(-Math.PI * 2 - 0.5)).toBeCloseTo(-0.5, 12);
    expect(wrapAngle(Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(Math.PI * 1.5)).toBeCloseTo(-Math.PI * 0.5, 12);
  });

  it('wrapping is idempotent', () => {
    for (const angle of [0.3, -4.2, 12.9, -100.25]) {
      expect(wrapAngle(wrapAngle(angle))).toBeCloseTo(wrapAngle(angle), 12);
    }
  });

  it('converts between degrees and radians', () => {
    expect(degToRad(180)).toBeCloseTo(Math.PI, 12);
    expect(radToDeg(Math.PI)).toBeCloseTo(180, 12);
    expect(radToDeg(degToRad(37))).toBeCloseTo(37, 12);
  });
});

describe('approxEquals', () => {
  it('compares within a tolerance', () => {
    expect(approxEquals(1, 1 + 1e-9)).toBe(true);
    expect(approxEquals(1, 1.001, 1e-6)).toBe(false);
    expect(approxEquals(1, 1.001, 1e-2)).toBe(true);
    expect(approxEquals(Number.NaN, Number.NaN)).toBe(false);
  });
});
