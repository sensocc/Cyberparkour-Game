import { describe, expect, it } from 'vitest';

import { FrameStats } from '../../src/diagnostics/stats.js';

describe('FrameStats', () => {
  it('reports an empty snapshot before any frames', () => {
    const stats = new FrameStats(10);
    expect(stats.snapshot()).toEqual({
      fps: 0,
      frameTimeMs: 0,
      worstFrameTimeMs: 0,
      frames: 0,
      elapsedSeconds: 0,
    });
  });

  it('derives fps from the mean frame time', () => {
    const stats = new FrameStats(60);
    for (let index = 0; index < 60; index += 1) stats.push(1 / 60);

    const snapshot = stats.snapshot();
    expect(snapshot.fps).toBeCloseTo(60, 6);
    expect(snapshot.frameTimeMs).toBeCloseTo(1000 / 60, 6);
    expect(snapshot.frames).toBe(60);
    expect(snapshot.elapsedSeconds).toBeCloseTo(1, 6);
  });

  it('reports the worst frame in the window', () => {
    const stats = new FrameStats(10);
    for (let index = 0; index < 9; index += 1) stats.push(0.01);
    stats.push(0.25); // a hitch

    const snapshot = stats.snapshot();
    expect(snapshot.worstFrameTimeMs).toBeCloseTo(250, 6);
    expect(snapshot.fps).toBeLessThan(100);
  });

  it('forgets old frames once the window slides', () => {
    const stats = new FrameStats(4);
    stats.push(1); // one very slow frame
    for (let index = 0; index < 4; index += 1) stats.push(0.01);

    const snapshot = stats.snapshot();
    expect(snapshot.worstFrameTimeMs).toBeCloseTo(10, 6);
    expect(snapshot.fps).toBeCloseTo(100, 6);
  });

  it('counts a zero-length frame without reporting infinite fps', () => {
    const stats = new FrameStats(10);
    stats.push(0);
    stats.push(0.01);

    const snapshot = stats.snapshot();
    expect(snapshot.frames).toBe(2);
    expect(Number.isFinite(snapshot.fps)).toBe(true);
    expect(snapshot.fps).toBeCloseTo(100, 6);
  });

  it('ignores negative and non-finite samples in the timing window', () => {
    const stats = new FrameStats(10);
    stats.push(-1);
    stats.push(Number.NaN);
    stats.push(Number.POSITIVE_INFINITY);
    stats.push(0.02);

    const snapshot = stats.snapshot();
    expect(Number.isFinite(snapshot.fps)).toBe(true);
    expect(snapshot.fps).toBeCloseTo(50, 6);
    expect(snapshot.worstFrameTimeMs).toBeCloseTo(20, 6);
    expect(snapshot.frames).toBe(4);
  });

  it('reset clears the window and the counters', () => {
    const stats = new FrameStats(10);
    for (let index = 0; index < 5; index += 1) stats.push(0.01);
    stats.reset();

    expect(stats.snapshot()).toEqual({
      fps: 0,
      frameTimeMs: 0,
      worstFrameTimeMs: 0,
      frames: 0,
      elapsedSeconds: 0,
    });

    stats.push(0.05);
    expect(stats.snapshot().fps).toBeCloseTo(20, 6);
  });

  it('rejects a nonsensical window size', () => {
    expect(() => new FrameStats(0)).toThrow(RangeError);
    expect(() => new FrameStats(-5)).toThrow(RangeError);
  });

  it('never reports a frame rate above what the samples justify', () => {
    const stats = new FrameStats(120);
    for (let index = 0; index < 120; index += 1) stats.push(1 / 120);
    expect(stats.snapshot().fps).toBeCloseTo(120, 6);
  });
});
