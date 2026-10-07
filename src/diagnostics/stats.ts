/**
 * Frame timing statistics for the debug HUD and crash reports.
 *
 * Uses a fixed-length sliding window over frame times, so FPS reflects the
 * last `sampleCount` frames rather than an average that hides hitches.
 */

export interface StatsSnapshot {
  /** Frames per second over the current window. */
  readonly fps: number;
  /** Mean frame time over the window, in milliseconds. */
  readonly frameTimeMs: number;
  /** Worst frame time in the window, in milliseconds. */
  readonly worstFrameTimeMs: number;
  /** Frames counted since the last reset. */
  readonly frames: number;
  /** Seconds of simulated time since the last reset. */
  readonly elapsedSeconds: number;
}

export class FrameStats {
  private readonly samples: Float64Array;
  private cursor = 0;
  private filled = 0;
  private frameCount = 0;
  private elapsed = 0;

  constructor(sampleCount = 120) {
    if (sampleCount < 1) throw new RangeError('FrameStats sampleCount must be >= 1');
    this.samples = new Float64Array(sampleCount);
  }

  /** Records one frame. `deltaSeconds` is the frame's clamped delta. */
  push(deltaSeconds: number): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
      // A zero-length frame still counts, but must not poison the window with
      // an infinite frame rate.
      this.frameCount += 1;
      return;
    }

    this.samples[this.cursor] = deltaSeconds;
    this.cursor = (this.cursor + 1) % this.samples.length;
    this.filled = Math.min(this.filled + 1, this.samples.length);
    this.frameCount += 1;
    this.elapsed += deltaSeconds;
  }

  reset(): void {
    this.samples.fill(0);
    this.cursor = 0;
    this.filled = 0;
    this.frameCount = 0;
    this.elapsed = 0;
  }

  snapshot(): StatsSnapshot {
    if (this.filled === 0) {
      return {
        fps: 0,
        frameTimeMs: 0,
        worstFrameTimeMs: 0,
        frames: this.frameCount,
        elapsedSeconds: this.elapsed,
      };
    }

    let total = 0;
    let worst = 0;
    let counted = 0;
    for (let index = 0; index < this.filled; index += 1) {
      const sample = this.samples[index] ?? 0;
      if (sample <= 0) continue;
      total += sample;
      if (sample > worst) worst = sample;
      counted += 1;
    }

    const mean = counted > 0 ? total / counted : 0;
    return {
      fps: mean > 0 ? 1 / mean : 0,
      frameTimeMs: mean * 1000,
      worstFrameTimeMs: worst * 1000,
      frames: this.frameCount,
      elapsedSeconds: this.elapsed,
    };
  }
}
