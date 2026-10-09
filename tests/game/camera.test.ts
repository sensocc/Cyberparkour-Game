/**
 * Camera effects.
 *
 * The point of these tests is not that the numbers are right - they are taste - but
 * that every effect *decays*: nothing here can leave the camera permanently dipped,
 * leaned or shaken, and the setting that turns motion off really does turn it off.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '../../src/core/config.js';
import { CameraEffects, type MotionSample } from '../../src/game/camera.js';

const EFFECTS = DEFAULT_CONFIG.cameraEffects;
const STEP = 1 / 60;

const IDLE: MotionSample = {
  speedFraction: 0,
  crouching: false,
  slideFraction: 0,
  wallRunFraction: 0,
  wallRunSide: 0,
};

function sample(overrides: Partial<MotionSample> = {}): MotionSample {
  return { ...IDLE, ...overrides };
}

/** Runs `steps` frames and returns the effects' frame. */
function settle(
  effects: CameraEffects,
  steps: number,
  at: MotionSample = IDLE,
  scale = 1,
  dt = STEP,
): ReturnType<CameraEffects['update']> {
  let frame = effects.update(0, at, EFFECTS, scale);
  for (let step = 0; step < steps; step += 1) {
    frame = effects.update(dt, at, EFFECTS, scale);
  }
  return frame;
}

describe('a camera doing nothing', () => {
  it('reports no effect at all', () => {
    const effects = new CameraEffects();
    const frame = effects.update(STEP, IDLE, EFFECTS);
    expect(frame.fov).toBe(0);
    expect(frame.roll).toBe(0);
    expect(frame.offsetX).toBe(0);
    expect(frame.offsetY).toBe(0);
    expect(frame.offsetZ).toBe(0);
  });

  it('hands back the same object every frame, so the render path allocates nothing', () => {
    const effects = new CameraEffects();
    expect(effects.update(STEP, IDLE, EFFECTS)).toBe(effects.update(STEP, IDLE, EFFECTS));
  });
});

describe('the field of view', () => {
  it('opens with speed, and approaches rather than jumping', () => {
    const effects = new CameraEffects();
    const first = effects.update(STEP, sample({ speedFraction: 1 }), EFFECTS);

    expect(first.fov).toBeGreaterThan(0);
    expect(first.fov).toBeLessThan(EFFECTS.speedFov);

    const settled = settle(effects, 120, sample({ speedFraction: 1 }));
    expect(settled.fov).toBeCloseTo(EFFECTS.speedFov, 2);
  });

  it('narrows when crouched', () => {
    const effects = new CameraEffects();
    const frame = settle(effects, 120, sample({ crouching: true }));
    expect(frame.fov).toBeCloseTo(EFFECTS.crouchFov, 2);
    expect(frame.fov).toBeLessThan(0);
  });

  it('comes back to level when the player stops', () => {
    const effects = new CameraEffects();
    settle(effects, 120, sample({ speedFraction: 1 }));
    const stopped = settle(effects, 240, IDLE);
    expect(stopped.fov).toBeCloseTo(0, 2);
  });

  it('treats a nonsensical speed as none rather than as infinite', () => {
    const effects = new CameraEffects();
    const frame = settle(effects, 60, sample({ speedFraction: Number.NaN }));
    expect(Number.isFinite(frame.fov)).toBe(true);
    expect(frame.fov).toBe(0);
    const huge = settle(effects, 60, sample({ speedFraction: 1e9 }));
    expect(huge.fov).toBeLessThanOrEqual(EFFECTS.speedFov + 1e-6);
  });
});

describe('a landing', () => {
  it('dips the camera and pushes it back up again', () => {
    const effects = new CameraEffects();
    effects.land(1, EFFECTS);

    const during = effects.update(STEP, IDLE, EFFECTS);
    expect(during.offsetY).toBeLessThan(0);

    const after = settle(effects, 240);
    expect(after.offsetY).toBeCloseTo(0, 3);
  });

  it('scales the dip with how hard the landing was', () => {
    const soft = new CameraEffects();
    const hard = new CameraEffects();
    soft.land(0.2, EFFECTS);
    hard.land(1, EFFECTS);

    const softFrame = soft.update(STEP, IDLE, EFFECTS);
    const hardFrame = hard.update(STEP, IDLE, EFFECTS);
    expect(hardFrame.offsetY).toBeLessThan(softFrame.offsetY);
  });

  it('rings, and then stops ringing', () => {
    const effects = new CameraEffects();
    effects.land(1, EFFECTS);

    const shaking = effects.update(STEP, IDLE, EFFECTS);
    expect(Math.abs(shaking.offsetX) + Math.abs(shaking.offsetZ)).toBeGreaterThan(0);

    // The shake must be *gone*, not merely small: a residual wobble on a stationary
    // camera is the thing this exists to avoid.
    for (let step = 0; step < 240; step += 1) effects.update(STEP, IDLE, EFFECTS);
    const still = effects.update(STEP, IDLE, EFFECTS);
    expect(still.offsetX).toBe(0);
    expect(still.offsetZ).toBe(0);
  });

  it('ignores a nonsensical strength', () => {
    const effects = new CameraEffects();
    effects.land(Number.NaN, EFFECTS);
    expect(effects.update(STEP, IDLE, EFFECTS).offsetY).toBe(0);
    effects.land(-5, EFFECTS);
    expect(effects.update(STEP, IDLE, EFFECTS).offsetY).toBe(0);
  });
});

describe('a lean', () => {
  it('rolls into a slide', () => {
    const effects = new CameraEffects();
    const frame = settle(effects, 120, sample({ slideFraction: 1 }));
    expect(frame.roll).toBeCloseTo(EFFECTS.slideRoll, 2);
  });

  it('rolls away from the wall it is running, whichever side it is on', () => {
    const left = new CameraEffects();
    const right = new CameraEffects();
    const leftFrame = settle(left, 120, sample({ wallRunFraction: 1, wallRunSide: -1 }));
    const rightFrame = settle(right, 120, sample({ wallRunFraction: 1, wallRunSide: 1 }));

    expect(Math.sign(leftFrame.roll)).toBe(-1);
    expect(Math.sign(rightFrame.roll)).toBe(1);
    expect(Math.abs(leftFrame.roll)).toBeCloseTo(Math.abs(rightFrame.roll), 6);
  });

  it('does not lean for a wall that is dead ahead', () => {
    const effects = new CameraEffects();
    const frame = settle(effects, 120, sample({ wallRunFraction: 1, wallRunSide: 0 }));
    expect(frame.roll).toBeCloseTo(0, 6);
  });

  it('comes back to level when the run ends', () => {
    const effects = new CameraEffects();
    settle(effects, 120, sample({ wallRunFraction: 1, wallRunSide: 1 }));
    expect(settle(effects, 240).roll).toBeCloseTo(0, 3);
  });
});

describe('the camera motion setting', () => {
  it('turns every effect off at zero', () => {
    const effects = new CameraEffects();
    effects.land(1, EFFECTS);
    const frame = settle(effects, 60, sample({ speedFraction: 1, slideFraction: 1 }), 0);

    expect(frame.fov).toBe(0);
    expect(frame.roll).toBe(0);
    expect(frame.offsetX).toBe(0);
    expect(frame.offsetY).toBe(0);
    expect(frame.offsetZ).toBe(0);
  });

  it('scales the effect down without changing its shape', () => {
    const full = new CameraEffects();
    const reduced = new CameraEffects();
    const fullFrame = settle(full, 120, sample({ speedFraction: 1 }), 1);
    const reducedFrame = settle(reduced, 120, sample({ speedFraction: 1 }), 0.25);

    expect(reducedFrame.fov).toBeCloseTo(fullFrame.fov * 0.25, 4);
  });

  it('clears what it had when the setting is turned off', () => {
    const effects = new CameraEffects();
    effects.land(1, EFFECTS);
    settle(effects, 2, sample({ speedFraction: 1 }));
    effects.setScale(0);

    const frame = effects.update(STEP, IDLE, EFFECTS);
    expect(frame.fov).toBe(0);
    expect(frame.offsetY).toBe(0);
    expect(frame.roll).toBe(0);
  });
});

describe('time', () => {
  it('ignores a zero or backwards step, rather than dividing by it', () => {
    const effects = new CameraEffects();
    effects.land(1, EFFECTS);
    const before = effects.update(0, IDLE, EFFECTS).offsetY;
    const after = effects.update(-1, IDLE, EFFECTS).offsetY;
    expect(Number.isFinite(before)).toBe(true);
    expect(Number.isFinite(after)).toBe(true);
  });

  it('decays by elapsed time rather than by frames', () => {
    // One second of small steps and one second in a single step have to agree, or
    // the effect would be a function of frame rate.
    const coarse = new CameraEffects();
    const fine = new CameraEffects();
    coarse.land(1, EFFECTS);
    fine.land(1, EFFECTS);

    for (let step = 0; step < 10; step += 1) fine.update(0.1, IDLE, EFFECTS);
    coarse.update(1, IDLE, EFFECTS);

    expect(coarse.update(STEP, IDLE, EFFECTS).offsetY).toBeCloseTo(
      fine.update(STEP, IDLE, EFFECTS).offsetY,
      4,
    );
  });

  it('puts everything back on reset', () => {
    const effects = new CameraEffects();
    effects.land(1, EFFECTS);
    settle(effects, 3, sample({ speedFraction: 1, slideFraction: 1, wallRunSide: 1 }));
    effects.reset();

    const frame = effects.update(STEP, IDLE, EFFECTS);
    expect(frame).toEqual({ fov: 0, roll: 0, offsetX: 0, offsetY: 0, offsetZ: 0 });
  });
});
