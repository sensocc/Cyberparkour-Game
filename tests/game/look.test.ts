import { describe, expect, it } from 'vitest';

import { lengthVec3 } from '../../src/core/vec3.js';
import { applyLook, facingDirection, lookDirection, type Orientation } from '../../src/game/look.js';

const CONFIG = { sensitivity: 0.002, maxPitch: (89 * Math.PI) / 180 };

const at = (yaw = 0, pitch = 0): Orientation => ({ yaw, pitch });

describe('applyLook', () => {
  it('turns right when the pointer moves right', () => {
    const orientation = at();
    applyLook(orientation, 100, 0, CONFIG);
    // Increasing yaw turns left, so a rightward flick must decrease it.
    expect(orientation.yaw).toBeCloseTo(-0.2, 12);
    expect(orientation.pitch).toBe(0);
  });

  it('turns left when the pointer moves left', () => {
    const orientation = at();
    applyLook(orientation, -100, 0, CONFIG);
    expect(orientation.yaw).toBeCloseTo(0.2, 12);
  });

  it('looks down when the pointer moves down', () => {
    const orientation = at();
    applyLook(orientation, 0, 100, CONFIG);
    expect(orientation.pitch).toBeCloseTo(-0.2, 12);
  });

  it('looks up when the pointer moves up', () => {
    const orientation = at();
    applyLook(orientation, 0, -100, CONFIG);
    expect(orientation.pitch).toBeCloseTo(0.2, 12);
  });

  it('invertY flips the vertical axis only', () => {
    const orientation = at();
    applyLook(orientation, 100, 100, { ...CONFIG, invertY: true });
    expect(orientation.yaw).toBeCloseTo(-0.2, 12);
    expect(orientation.pitch).toBeCloseTo(0.2, 12);
  });

  it('accumulates sub-pixel motion instead of discarding it', () => {
    const orientation = at();
    for (let index = 0; index < 10; index += 1) applyLook(orientation, 0.5, 0, CONFIG);
    expect(orientation.yaw).toBeCloseTo(-0.01, 12);
  });

  it('clamps pitch just short of straight up and down', () => {
    const up = at();
    applyLook(up, 0, -100_000, CONFIG);
    expect(up.pitch).toBeCloseTo(CONFIG.maxPitch, 12);

    const down = at();
    applyLook(down, 0, 100_000, CONFIG);
    expect(down.pitch).toBeCloseTo(-CONFIG.maxPitch, 12);

    // Still strictly inside the gimbal singularity.
    expect(up.pitch).toBeLessThan(Math.PI / 2);
    expect(down.pitch).toBeGreaterThan(-Math.PI / 2);
  });

  it('clamps pitch without touching yaw', () => {
    const orientation = at();
    applyLook(orientation, 1000, 100_000, CONFIG);
    expect(orientation.pitch).toBeCloseTo(-CONFIG.maxPitch, 12);
    expect(orientation.yaw).not.toBe(0);
  });

  it('wraps yaw so it cannot grow without bound', () => {
    const orientation = at();
    for (let index = 0; index < 5000; index += 1) applyLook(orientation, -100, 0, CONFIG);
    expect(Math.abs(orientation.yaw)).toBeLessThanOrEqual(Math.PI);
  });

  it('ignores non-finite motion samples', () => {
    const orientation = at(0.5, 0.25);
    applyLook(orientation, Number.NaN, Number.POSITIVE_INFINITY, CONFIG);
    expect(orientation.yaw).toBeCloseTo(0.5, 12);
    expect(orientation.pitch).toBeCloseTo(0.25, 12);
  });

  it('returns the same object it was given, for chaining', () => {
    const orientation = at();
    expect(applyLook(orientation, 1, 1, CONFIG)).toBe(orientation);
  });

  it('a full 360-degree sweep returns to the start', () => {
    const orientation = at();
    const pixelsForFullTurn = (Math.PI * 2) / CONFIG.sensitivity;
    applyLook(orientation, pixelsForFullTurn, 0, CONFIG);
    expect(orientation.yaw).toBeCloseTo(0, 9);
  });
});

describe('lookDirection', () => {
  it('looks down -Z at yaw 0, level pitch', () => {
    const direction = lookDirection(at());
    expect(direction.x).toBeCloseTo(0, 12);
    expect(direction.y).toBeCloseTo(0, 12);
    expect(direction.z).toBeCloseTo(-1, 12);
  });

  it('looks up and down with pitch', () => {
    expect(lookDirection(at(0, Math.PI / 2)).y).toBeCloseTo(1, 12);
    expect(lookDirection(at(0, -Math.PI / 2)).y).toBeCloseTo(-1, 12);
  });

  it('is always a unit vector', () => {
    for (const yaw of [0, 1.2, -2.7, 4.4]) {
      for (const pitch of [0, 0.8, -1.4, 1.55]) {
        expect(lengthVec3(lookDirection(at(yaw, pitch)))).toBeCloseTo(1, 12);
      }
    }
  });

  it('tilting up shortens the horizontal reach but keeps the heading', () => {
    const level = lookDirection(at(0.7, 0));
    const tilted = lookDirection(at(0.7, 1));
    expect(Math.sign(tilted.x)).toBe(Math.sign(level.x));
    expect(Math.sign(tilted.z)).toBe(Math.sign(level.z));
    expect(Math.abs(tilted.x)).toBeLessThan(Math.abs(level.x));
  });
});

describe('facingDirection', () => {
  it('matches lookDirection when the pitch is level', () => {
    const level = lookDirection(at(0.9, 0));
    expect(facingDirection(at(0.9, 0.7))).toEqual(level);
  });

  it('is horizontal and unit length', () => {
    const facing = facingDirection(at(3.3, -0.5));
    expect(facing.y).toBe(0);
    expect(lengthVec3(facing)).toBeCloseTo(1, 12);
  });
});
