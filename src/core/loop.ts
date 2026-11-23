/**
 * The game loop.
 *
 * Owns the frame cadence and turns timestamps into deltas. The scheduler is
 * injectable, so tests can drive frames deterministically without a browser.
 */

import { DeltaTimer } from './delta.js';

export interface FrameScheduler {
  request(callback: (timestampMs: number) => void): number;
  cancel(handle: number): void;
  now(): number;
}

export interface GameLoopOptions {
  /** Called once per rendered frame with the clamped delta, in seconds. */
  onFrame: (deltaSeconds: number, timestampMs: number) => void;
  /**
   * Called when `onFrame` throws. The loop keeps running unless this returns
   * `false`, which stops it - that is how the crash overlay takes over.
   */
  onError?: (error: unknown) => boolean | void;
  scheduler?: FrameScheduler;
  /** Upper bound on a single frame delta, in seconds. */
  maxDelta?: number;
}

/** Browser scheduler built on `requestAnimationFrame`. */
export function createAnimationFrameScheduler(
  target: Pick<Window, 'requestAnimationFrame' | 'cancelAnimationFrame'> = window,
): FrameScheduler {
  return {
    request: (callback) => target.requestAnimationFrame(callback),
    cancel: (handle) => target.cancelAnimationFrame(handle),
    now: () => performance.now(),
  };
}

export class GameLoop {
  private readonly timer: DeltaTimer;
  private readonly scheduler: FrameScheduler;
  private readonly options: GameLoopOptions;
  /**
   * Whether the loop should keep scheduling frames.
   *
   * Deliberately separate from `handle`: inside a frame callback the handle is
   * already null, so `stop()` called from `onError` has nothing to cancel. The
   * flag is what makes "stop from inside a frame" work.
   */
  private active = false;
  private handle: number | null = null;
  /**
   * Bumped by every `start()`.
   *
   * **A frame callback must not reschedule a loop that a *different* start now owns.** `stop()`
   * followed by `start()` from inside a frame is not hypothetical - it is what `Game.restart()`
   * does, so it is what pressing R does. `start()` schedules a callback; then the callback that
   * asked for the restart reaches its own `if (this.active) this.schedule()` and schedules a
   * second one. `handle` remembers only the later of the two, so the earlier cannot be cancelled
   * and both chains run for ever, each advancing the simulation. Measured before this field: two
   * frames queued where there should be one, and the game at double speed from the first restart
   * on. The generation lets a frame tell whether it still owns the loop it was scheduled by.
   */
  private generation = 0;
  private frameCount = 0;
  private lastFrameDelta = 0;

  constructor(options: GameLoopOptions) {
    this.options = options;
    this.timer = new DeltaTimer(options.maxDelta ?? 0.25);
    this.scheduler = options.scheduler ?? createAnimationFrameScheduler();
  }

  get running(): boolean {
    return this.active;
  }

  /** Number of frames delivered since the last `start()`. */
  get frames(): number {
    return this.frameCount;
  }

  /** Delta of the most recent frame, in seconds. */
  get lastDelta(): number {
    return this.lastFrameDelta;
  }

  /** Seconds of simulated time since the last `start()`. */
  get elapsed(): number {
    return this.timer.elapsed;
  }

  start(): void {
    if (this.active) return;

    this.active = true;
    this.generation += 1;
    this.frameCount = 0;
    // Baseline the clock at *now*, not at the first frame: the time between
    // start() and the first animation frame is real time and should be
    // simulated, and it avoids one wasted zero-length frame.
    this.timer.restart(this.scheduler.now());
    this.schedule();
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;

    if (this.handle !== null) {
      this.scheduler.cancel(this.handle);
      this.handle = null;
    }
  }

  private schedule(): void {
    const generation = this.generation;
    this.handle = this.scheduler.request((timestampMs) => {
      // A callback scheduled by an *older* start must do nothing at all: a restart inside a frame
      // has already begun a new chain, and letting this one run would be the second chain.
      if (generation !== this.generation) return;
      this.handle = null;
      // A stop() from inside the previous frame must win over the reschedule.
      if (!this.active) return;

      this.frame(timestampMs);

      // **Reschedule only if this frame still owns the loop.** A `stop()` + `start()` inside
      // `frame()` bumped the generation, and that start has already queued the next frame; adding
      // another here is what used to leave two chains running.
      if (this.active && generation === this.generation) this.schedule();
    });
  }

  /** One frame: `dt -> onFrame`, with error containment. */
  private frame(timestampMs: number): void {
    const delta = this.timer.tick(timestampMs);
    this.lastFrameDelta = delta;
    this.frameCount += 1;

    try {
      this.options.onFrame(delta, timestampMs);
    } catch (error) {
      // A frame error must never kill the loop silently: hand it to the
      // reporter, then honour its verdict.
      const keepRunning = this.options.onError?.(error);
      if (keepRunning === false) this.stop();
    }
  }
}
