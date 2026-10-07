/**
 * Deterministic frame scheduler for tests.
 *
 * Frames only happen when a test asks for one, so nothing depends on wall-clock
 * timing or on `requestAnimationFrame` being driven by a browser.
 */

import type { FrameScheduler } from '../../src/core/loop.js';

export class FakeScheduler implements FrameScheduler {
  private nextHandle = 1;
  private readonly pending = new Map<number, (timestampMs: number) => void>();
  time = 0;
  requestCount = 0;
  cancelCount = 0;

  request(callback: (timestampMs: number) => void): number {
    this.requestCount += 1;
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.pending.set(handle, callback);
    return handle;
  }

  cancel(handle: number): void {
    this.cancelCount += 1;
    this.pending.delete(handle);
  }

  now(): number {
    return this.time;
  }

  /** Frames queued but not yet run. */
  get queued(): number {
    return this.pending.size;
  }

  /** Runs the oldest queued frame after advancing the clock. */
  runFrame(deltaMs = 16): void {
    const entry = this.pending.entries().next();
    if (entry.done) throw new Error('no frame is queued');
    const [handle, callback] = entry.value;
    this.pending.delete(handle);
    this.time += deltaMs;
    callback(this.time);
  }

  /** Runs up to `count` frames, stopping early if nothing is queued. */
  runFrames(count: number, deltaMs = 16): number {
    let ran = 0;
    while (ran < count && this.queued > 0) {
      this.runFrame(deltaMs);
      ran += 1;
    }
    return ran;
  }

  /** Advances the clock and delivers a single frame, as the browser would. */
  advance(deltaMs: number): void {
    this.runFrame(deltaMs);
  }
}
