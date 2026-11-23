import { describe, expect, it, vi } from 'vitest';

import { GameLoop } from '../../src/core/loop.js';
import { FakeScheduler } from '../helpers/fakeScheduler.js';

describe('GameLoop', () => {
  it('delivers frames with clamped deltas', () => {
    const scheduler = new FakeScheduler();
    const deltas: number[] = [];
    const loop = new GameLoop({
      onFrame: (delta) => void deltas.push(delta),
      scheduler,
      maxDelta: 0.25,
    });

    loop.start();
    expect(loop.running).toBe(true);

    scheduler.runFrame(16);
    scheduler.runFrame(16);
    scheduler.runFrame(5000); // a hitch

    // start() baselines the clock, so the very first frame already carries the
    // real time that elapsed before it.
    expect(deltas).toEqual([0.016, 0.016, 0.25]);
    expect(loop.frames).toBe(3);
    expect(loop.lastDelta).toBe(0.25);
  });

  it('keeps scheduling the next frame after each tick', () => {
    const scheduler = new FakeScheduler();
    const loop = new GameLoop({ onFrame: () => {}, scheduler });

    loop.start();
    expect(scheduler.queued).toBe(1);

    scheduler.runFrame(16);
    expect(scheduler.queued).toBe(1);

    scheduler.runFrame(16);
    expect(scheduler.queued).toBe(1);
    expect(loop.frames).toBe(2);
  });

  it('stop cancels the pending frame and is idempotent', () => {
    const scheduler = new FakeScheduler();
    const loop = new GameLoop({ onFrame: () => {}, scheduler });

    loop.start();
    loop.stop();
    expect(loop.running).toBe(false);
    expect(scheduler.queued).toBe(0);

    loop.stop();
    expect(scheduler.cancelCount).toBe(1);
  });

  it('start is a no-op while already running', () => {
    const scheduler = new FakeScheduler();
    const loop = new GameLoop({ onFrame: () => {}, scheduler });

    loop.start();
    loop.start();
    expect(scheduler.queued).toBe(1);
    expect(scheduler.requestCount).toBe(1);
  });

  it('accumulates elapsed simulated time and resets it on restart', () => {
    const scheduler = new FakeScheduler();
    const loop = new GameLoop({ onFrame: () => {}, scheduler });

    loop.start();
    scheduler.runFrame(16);
    scheduler.runFrame(16);
    expect(loop.elapsed).toBeCloseTo(0.032, 12);

    loop.stop();
    loop.start();
    expect(loop.elapsed).toBe(0);
    expect(loop.frames).toBe(0);
  });

  it('contains a throwing frame so the loop survives', () => {
    const scheduler = new FakeScheduler();
    const onError = vi.fn((_error: unknown): boolean => true);
    const onFrame = vi.fn(() => {
      throw new Error('frame blew up');
    });

    const loop = new GameLoop({ onFrame, onError, scheduler });
    loop.start();
    scheduler.runFrame(16);
    scheduler.runFrame(16);

    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenLastCalledWith(expect.any(Error));
    expect(loop.running).toBe(true);
    expect(loop.frames).toBe(2);
  });

  it('stops when the error handler returns false', () => {
    const scheduler = new FakeScheduler();
    const loop = new GameLoop({
      onFrame: () => {
        throw new Error('fatal');
      },
      onError: () => false,
      scheduler,
    });

    loop.start();
    scheduler.runFrame(16);

    expect(loop.running).toBe(false);
    expect(scheduler.queued).toBe(0);
  });

  it('leaves a non-throwing frame alone even with an error handler', () => {
    const scheduler = new FakeScheduler();
    const onError = vi.fn();
    const loop = new GameLoop({ onFrame: () => {}, onError, scheduler });

    loop.start();
    scheduler.runFrame(16);
    expect(onError).not.toHaveBeenCalled();
  });

  it('can be restarted after being stopped by a fatal frame error', () => {
    const scheduler = new FakeScheduler();
    let shouldThrow = true;
    const loop = new GameLoop({
      onFrame: () => {
        if (shouldThrow) throw new Error('fatal');
      },
      onError: () => false,
      scheduler,
    });

    loop.start();
    scheduler.runFrame(16);
    expect(loop.running).toBe(false);

    shouldThrow = false;
    loop.start();
    expect(loop.running).toBe(true);
    scheduler.runFrame(16);
    scheduler.runFrame(16);
    expect(loop.frames).toBe(2);
  });

  it('does not queue a second frame when restarted from inside a frame', () => {
    // **The bug this is for.** `Game.restart()` calls `loop.stop()` then `loop.start()` from inside
    // the frame handler - which is what pressing R does. `start()` schedules a frame; then the
    // callback that triggered the restart reached its own `if (this.active) this.schedule()` and
    // scheduled a *second*. `this.handle` only remembers the newer one, so both survived: two
    // independent rAF chains, forever, and every frame's delta applied twice. Measured: the game
    // ran at double speed from the first restart on, which reads as "navigation is broken".
    const scheduler = new FakeScheduler();
    let restarted = false;
    let frames = 0;
    const loop = new GameLoop({
      onFrame: () => {
        frames += 1;
        if (restarted) return;
        restarted = true;
        loop.stop();
        loop.start();
      },
      scheduler,
    });

    loop.start();
    expect(scheduler.queued, 'one frame queued before the first tick').toBe(1);

    scheduler.runFrame(16);
    expect(scheduler.queued, 'still exactly one frame queued after a restart in a frame').toBe(1);

    // And it stays one: the second chain, if it existed, would show up as extra frames.
    scheduler.runFrame(16);
    expect(scheduler.queued).toBe(1);
    expect(frames, 'one simulated frame per scheduled frame').toBe(2);
  });

  it('passes timestamps through to the frame handler', () => {
    const scheduler = new FakeScheduler();
    const stamps: number[] = [];
    const loop = new GameLoop({ onFrame: (_delta, now) => void stamps.push(now), scheduler });

    loop.start();
    scheduler.runFrame(16);
    scheduler.runFrame(16);
    expect(stamps).toEqual([16, 32]);
  });
});
