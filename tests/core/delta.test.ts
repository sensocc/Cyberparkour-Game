import { describe, expect, it, vi } from 'vitest';

import { DeltaTimer, FixedStepAccumulator } from '../../src/core/delta.js';

describe('DeltaTimer', () => {
  it('returns 0 on the first tick to establish a baseline', () => {
    const timer = new DeltaTimer(0.25);
    expect(timer.tick(1000)).toBe(0);
    expect(timer.elapsed).toBe(0);
  });

  it('converts milliseconds into seconds', () => {
    const timer = new DeltaTimer(1);
    timer.tick(0);
    expect(timer.tick(16)).toBeCloseTo(0.016, 12);
    expect(timer.tick(32)).toBeCloseTo(0.016, 12);
    expect(timer.elapsed).toBeCloseTo(0.032, 12);
  });

  it('clamps a long hitch so physics cannot teleport', () => {
    const timer = new DeltaTimer(0.25);
    timer.tick(0);
    // A five-second stall (tab switch, breakpoint, GC pause).
    expect(timer.tick(5000)).toBe(0.25);
    expect(timer.elapsed).toBeCloseTo(0.25, 12);
  });

  it('treats a backwards clock as a hitch rather than negative time', () => {
    const timer = new DeltaTimer(0.25);
    timer.tick(1000);
    expect(timer.tick(500)).toBe(0);
    expect(timer.elapsed).toBe(0);
  });

  it('reset drops the baseline but keeps the elapsed total', () => {
    const timer = new DeltaTimer(1);
    timer.tick(0);
    timer.tick(100);
    expect(timer.elapsed).toBeCloseTo(0.1, 12);

    timer.reset();
    expect(timer.tick(999_999)).toBe(0);
    expect(timer.elapsed).toBeCloseTo(0.1, 12);
  });

  it('restart clears the elapsed total as well', () => {
    const timer = new DeltaTimer(1);
    timer.tick(0);
    timer.tick(100);
    timer.restart(100);
    expect(timer.elapsed).toBe(0);
    expect(timer.tick(150)).toBeCloseTo(0.05, 12);
  });

  it('honours a custom clamp', () => {
    const timer = new DeltaTimer(0.05);
    timer.tick(0);
    expect(timer.tick(1000)).toBe(0.05);
  });
});

describe('FixedStepAccumulator', () => {
  const step = 1 / 60;

  it('runs one step per step-length of accumulated time', () => {
    const accumulator = new FixedStepAccumulator(step, 5);
    const ticks: number[] = [];

    expect(accumulator.run(step, (dt) => ticks.push(dt))).toBe(1);
    expect(ticks).toEqual([step]);

    expect(accumulator.run(step * 3, (dt) => ticks.push(dt))).toBe(3);
    expect(ticks).toHaveLength(4);
    expect(ticks.every((dt) => dt === step)).toBe(true);
  });

  it('carries the remainder into the next frame', () => {
    const accumulator = new FixedStepAccumulator(step, 5);

    // 1.5 steps' worth: one step runs, half a step is buffered.
    expect(accumulator.run(step * 1.5, () => {})).toBe(1);
    expect(accumulator.pending).toBeCloseTo(step * 0.5, 12);
    expect(accumulator.alpha).toBeCloseTo(0.5, 12);

    // Another half step completes a second step.
    expect(accumulator.run(step * 0.5, () => {})).toBe(1);
    expect(accumulator.pending).toBeCloseTo(0, 12);
  });

  it('does nothing for a zero, negative or non-finite delta', () => {
    const accumulator = new FixedStepAccumulator(step, 5);
    const tick = vi.fn();

    expect(accumulator.run(0, tick)).toBe(0);
    expect(accumulator.run(-1, tick)).toBe(0);
    expect(accumulator.run(Number.NaN, tick)).toBe(0);
    expect(accumulator.run(Number.POSITIVE_INFINITY, tick)).toBe(0);
    expect(tick).not.toHaveBeenCalled();
    expect(accumulator.pending).toBe(0);
  });

  it('caps the number of steps per frame instead of spiralling', () => {
    const accumulator = new FixedStepAccumulator(step, 5);
    let steps = 0;

    // A full second of backlog for a 5-step budget.
    expect(accumulator.run(1, () => void (steps += 1))).toBe(5);
    expect(steps).toBe(5);
    // The surplus is discarded rather than queued: slow motion, not a spiral.
    expect(accumulator.pending).toBeCloseTo(0, 9);
  });

  it('clamps alpha into 0..1', () => {
    const accumulator = new FixedStepAccumulator(step, 5);
    expect(accumulator.alpha).toBe(0);
    accumulator.run(1, () => {});
    expect(accumulator.alpha).toBeGreaterThanOrEqual(0);
    expect(accumulator.alpha).toBeLessThanOrEqual(1);
  });

  it('reset clears the buffered time', () => {
    const accumulator = new FixedStepAccumulator(step, 5);
    accumulator.run(step * 0.75, () => {});
    expect(accumulator.pending).toBeGreaterThan(0);
    accumulator.reset();
    expect(accumulator.pending).toBe(0);
    expect(accumulator.alpha).toBe(0);
  });

  it('rejects nonsensical construction arguments', () => {
    expect(() => new FixedStepAccumulator(0, 5)).toThrow(RangeError);
    expect(() => new FixedStepAccumulator(-1, 5)).toThrow(RangeError);
    expect(() => new FixedStepAccumulator(step, 0)).toThrow(RangeError);
  });

  it('simulates a whole second of wall clock in ~60 steps', () => {
    const accumulator = new FixedStepAccumulator(step, 10);
    let steps = 0;
    let simulated = 0;

    // 100 frames at 10 ms: 1 second total, 0.6 steps' worth per frame.
    for (let frame = 0; frame < 100; frame += 1) {
      steps += accumulator.run(0.01, (dt) => void (simulated += dt));
    }

    // Exactly 60 in exact arithmetic; the +-1 slack absorbs float accumulation.
    expect(steps).toBeGreaterThanOrEqual(59);
    expect(steps).toBeLessThanOrEqual(61);
    expect(simulated).toBeCloseTo(1, 1);
  });
});
