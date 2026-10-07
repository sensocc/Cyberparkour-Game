/**
 * Delta-time system.
 *
 * Two pieces:
 *  - `DeltaTimer` converts wall-clock milliseconds into a clamped delta.
 *  - `FixedStepAccumulator` turns that variable delta into a whole number of
 *    fixed simulation steps, which keeps physics deterministic regardless of
 *    the display refresh rate.
 *
 * Both take the timestamp as an argument (rather than reading a clock), which
 * is what makes them unit-testable.
 */

import { clamp } from './math.js';

export class DeltaTimer {
  private lastMs: number | null = null;
  private elapsedSeconds = 0;

  /**
   * @param maxDelta Upper bound on a single delta, in seconds. Without this a
   *   single long hitch (tab switch, GC pause, debugger breakpoint) would
   *   teleport the player through the level.
   */
  constructor(private readonly maxDelta = 0.25) {}

  /** Seconds simulated since the last `reset()`. */
  get elapsed(): number {
    return this.elapsedSeconds;
  }

  /**
   * Feeds a timestamp (milliseconds, e.g. `performance.now()`) and returns the
   * clamped delta in seconds. The first call returns 0 and only establishes
   * the baseline.
   */
  tick(nowMs: number): number {
    const previous = this.lastMs;
    this.lastMs = nowMs;

    if (previous === null) return 0;

    const rawDelta = (nowMs - previous) / 1000;
    // A negative delta means the clock went backwards (suspend/resume, NTP
    // correction). Treat it as a hitch instead of running time in reverse.
    const safeDelta = rawDelta > 0 ? rawDelta : 0;
    const delta = Math.min(safeDelta, this.maxDelta);
    this.elapsedSeconds += delta;
    return delta;
  }

  /** Drops the baseline so the next `tick` returns 0. Keeps `elapsed`. */
  reset(nowMs: number | null = null): void {
    this.lastMs = nowMs;
  }

  /** Resets both the baseline and the elapsed-time counter. */
  restart(nowMs: number | null = null): void {
    this.lastMs = nowMs;
    this.elapsedSeconds = 0;
  }
}

export class FixedStepAccumulator {
  private accumulator = 0;

  constructor(
    private readonly step: number,
    private readonly maxSubSteps = 5,
  ) {
    if (step <= 0) throw new RangeError('FixedStepAccumulator step must be > 0');
    if (maxSubSteps < 1) throw new RangeError('FixedStepAccumulator maxSubSteps must be >= 1');
  }

  /**
   * Consumes a variable frame delta and invokes `tick` once per fixed step.
   *
   * Leftover time is carried into the next frame. When the frame budget is
   * exceeded the accumulator is dropped (rather than spiralling), which trades
   * slow-motion for a stable frame rate.
   *
   * @returns the number of steps that ran.
   */
  run(frameDelta: number, tick: (step: number) => void): number {
    if (!Number.isFinite(frameDelta) || frameDelta <= 0) return 0;

    this.accumulator += frameDelta;

    const budget = this.step * this.maxSubSteps;
    if (this.accumulator > budget) this.accumulator = budget;

    let steps = 0;
    while (this.accumulator >= this.step) {
      tick(this.step);
      this.accumulator -= this.step;
      steps += 1;
    }
    return steps;
  }

  /**
   * Fraction of the next fixed step already accumulated (0..1).
   *
   * Renderers use this to interpolate between the previous and current
   * simulation state, which removes judder on refresh rates that are not a
   * multiple of the tick rate.
   */
  get alpha(): number {
    return clamp(this.accumulator / this.step, 0, 1);
  }

  /** Un-simulated time currently buffered, in seconds. */
  get pending(): number {
    return this.accumulator;
  }

  reset(): void {
    this.accumulator = 0;
  }
}
