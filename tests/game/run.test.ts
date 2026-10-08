/**
 * The run: the clock, the pickups, the record.
 *
 * This is the state a time trial is made of, and it is deliberately plain - a
 * number, a `Set` and an array of splits - so every rule can be stated as an
 * assertion rather than played out in a browser.
 */

import { describe, expect, it } from 'vitest';

import {
  BEST_TIME_STORAGE_KEY,
  RunState,
  formatRunTime,
  readBestTime,
  withinTrigger,
  writeBestTime,
  type RunOptions,
  type TimeStore,
} from '../../src/game/run.js';

const options = (overrides: Partial<RunOptions> = {}): RunOptions => ({
  checkpointCount: 3,
  collectibleCount: 2,
  ...overrides,
});

describe('the clock', () => {
  it('does not start until the player moves', () => {
    const run = new RunState(options());

    run.tick(1, false);
    run.tick(1, false);
    expect(run.snapshot().elapsedSeconds).toBe(0);
    expect(run.snapshot().started).toBe(false);

    run.tick(0.5, true);
    expect(run.snapshot().started).toBe(true);
    expect(run.snapshot().elapsedSeconds).toBeCloseTo(0.5, 9);

    run.tick(0.5, true);
    expect(run.snapshot().elapsedSeconds).toBeCloseTo(1, 9);
  });

  it('keeps running even if the player stops again', () => {
    const run = new RunState(options());
    run.tick(1, true);
    run.tick(1, false);
    expect(run.snapshot().elapsedSeconds).toBeCloseTo(2, 9);
  });

  it('stops once the run is finished', () => {
    const run = new RunState(options());
    run.tick(1, true);
    run.finish();
    run.tick(5, true);
    expect(run.snapshot().elapsedSeconds).toBeCloseTo(1, 9);
  });

  it('starts again from zero', () => {
    const run = new RunState(options());
    run.tick(4, true);
    run.collect('a');
    run.begin();

    const snapshot = run.snapshot();
    expect(snapshot.elapsedSeconds).toBe(0);
    expect(snapshot.started).toBe(false);
    expect(snapshot.finished).toBe(false);
    expect(snapshot.collected).toBe(0);
    expect(snapshot.splits).toEqual([]);
  });
});

describe('checkpoints and the finish', () => {
  it('records a split the first time each checkpoint is reached', () => {
    const run = new RunState(options());

    run.tick(2, true);
    expect(run.reachCheckpoint(0)).toBe(true);
    run.tick(3, true);
    expect(run.reachCheckpoint(1)).toBe(true);
    run.tick(4, true);
    expect(run.reachCheckpoint(2)).toBe(true);

    expect(run.snapshot().splits).toEqual([
      { checkpoint: 0, seconds: 2 },
      { checkpoint: 1, seconds: 5 },
      { checkpoint: 2, seconds: 9 },
    ]);
    expect(run.reachedIndex).toBe(2);
  });

  it('ignores a checkpoint it already has', () => {
    const run = new RunState(options());
    run.tick(1, true);
    run.reachCheckpoint(0);
    run.tick(1, true);

    expect(run.reachCheckpoint(0)).toBe(false);
    expect(run.snapshot().splits).toEqual([{ checkpoint: 0, seconds: 1 }]);
  });

  it('ignores a nonsense index', () => {
    const run = new RunState(options());
    expect(run.reachCheckpoint(-1)).toBe(false);
    expect(run.reachCheckpoint(1.5)).toBe(false);
  });

  it('keeps the splits dense and labelled when a checkpoint is skipped', () => {
    // Skipping is allowed - reaching a later roof on foot is still progress - so
    // the splits must not be an array indexed by checkpoint, or the results
    // screen would print a split against a checkpoint the run never touched.
    const run = new RunState(options());
    run.tick(4, true);
    run.reachCheckpoint(0);
    run.tick(6, true);
    run.reachCheckpoint(2);

    expect(run.snapshot().splits).toEqual([
      { checkpoint: 0, seconds: 4 },
      { checkpoint: 2, seconds: 10 },
    ]);
  });

  it('arms the finish only once every checkpoint is behind you', () => {
    const run = new RunState(options());
    expect(run.armed).toBe(false);

    run.reachCheckpoint(0);
    run.reachCheckpoint(1);
    expect(run.armed).toBe(false);

    run.reachCheckpoint(2);
    expect(run.armed).toBe(true);
  });

  it('arms immediately when a level has no checkpoints', () => {
    expect(new RunState(options({ checkpointCount: 0 })).armed).toBe(true);
  });
});

describe('pickups', () => {
  it('takes each one once', () => {
    const run = new RunState(options());
    expect(run.collect('shard-a')).toBe(true);
    expect(run.collect('shard-a')).toBe(false);
    expect(run.hasCollected('shard-a')).toBe(true);
    expect(run.snapshot().collected).toBe(1);
  });

  it('knows when the level is cleared', () => {
    const run = new RunState(options());
    expect(run.allCollected).toBe(false);
    run.collect('shard-a');
    expect(run.allCollected).toBe(false);
    run.collect('shard-b');
    expect(run.allCollected).toBe(true);
  });

  it('does not claim a level with no pickups is cleared', () => {
    expect(new RunState(options({ collectibleCount: 0 })).allCollected).toBe(false);
  });
});

describe('finishing', () => {
  it('does not record a run that never started', () => {
    // A level whose finish is reachable without moving would otherwise write a
    // best of 0.000 - and the record is the one thing that outlives the session,
    // so every later run would compare against it and never improve.
    const run = new RunState(options({ bestSeconds: null }));
    const result = run.finish();

    expect(result?.seconds).toBe(0);
    expect(result?.improved).toBe(false);
    expect(run.snapshot().bestSeconds).toBeNull();

    // ...and a real run afterwards is still a record.
    run.begin();
    run.tick(9, true);
    expect(run.finish()?.improved).toBe(true);
  });

  it('reports the run and sets the record when there was none', () => {
    const run = new RunState(options({ bestSeconds: null }));
    run.tick(12, true);
    run.collect('shard-a');
    run.reachCheckpoint(0);

    const result = run.finish();
    expect(result).not.toBeNull();
    expect(result?.seconds).toBeCloseTo(12, 9);
    expect(result?.collected).toBe(1);
    expect(result?.collectibleCount).toBe(2);
    expect(result?.improved).toBe(true);
    expect(result?.bestSeconds).toBeCloseTo(12, 9);
  });

  it('keeps a better record and says the run did not beat it', () => {
    const run = new RunState(options({ bestSeconds: 10 }));
    run.tick(18, true);

    const result = run.finish();
    expect(result?.improved).toBe(false);
    expect(result?.bestSeconds).toBe(10);
    expect(run.snapshot().bestSeconds).toBe(10);
  });

  it('lowers the record when the run is quicker', () => {
    const run = new RunState(options({ bestSeconds: 20 }));
    run.tick(15, true);

    const result = run.finish();
    expect(result?.improved).toBe(true);
    expect(result?.bestSeconds).toBeCloseTo(15, 9);
    expect(run.snapshot().bestSeconds).toBeCloseTo(15, 9);
  });

  it('cannot be finished twice, so a later touch cannot spoil a time', () => {
    const run = new RunState(options());
    run.tick(5, true);
    expect(run.finish()).not.toBeNull();

    run.tick(50, true);
    expect(run.finish()).toBeNull();
    expect(run.snapshot().elapsedSeconds).toBeCloseTo(5, 9);
  });
});

describe('withinTrigger', () => {
  const target = { x: 10, y: 2, z: 0 };

  it('is a cylinder: near horizontally and near vertically counts', () => {
    expect(withinTrigger({ x: 10.5, y: 2.5, z: 0.5 }, target, 2, 1)).toBe(true);
  });

  it('ignores anything too far horizontally', () => {
    expect(withinTrigger({ x: 13, y: 2, z: 0 }, target, 2, 2)).toBe(false);
  });

  it('ignores anything too far vertically', () => {
    expect(withinTrigger({ x: 10, y: 6, z: 0 }, target, 2, 2)).toBe(false);
  });

  it('is inclusive at the edges', () => {
    expect(withinTrigger({ x: 12, y: 2, z: 0 }, target, 2, 2)).toBe(true);
    expect(withinTrigger({ x: 10, y: 4, z: 0 }, target, 2, 2)).toBe(true);
  });
});

describe('formatRunTime', () => {
  it('reads as minutes, seconds and hundredths', () => {
    expect(formatRunTime(0)).toBe('0:00.00');
    expect(formatRunTime(9.5)).toBe('0:09.50');
    expect(formatRunTime(62.5)).toBe('1:02.50');
    expect(formatRunTime(600)).toBe('10:00.00');
  });

  it('rounds to the nearest hundredth', () => {
    expect(formatRunTime(1.234)).toBe('0:01.23');
    expect(formatRunTime(1.236)).toBe('0:01.24');
  });

  it('rolls a rounded 59.999 into the next minute rather than showing 60', () => {
    expect(formatRunTime(59.999)).toBe('1:00.00');
  });

  it('has a placeholder for no time at all', () => {
    expect(formatRunTime(Number.NaN)).toBe('-:--.--');
    expect(formatRunTime(-1)).toBe('-:--.--');
  });
});

/** A tiny in-memory `localStorage`. */
function fakeStore(initial: Record<string, string> = {}): TimeStore & { readonly data: Record<string, string> } {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

describe('the record on disk', () => {
  it('round-trips a best time', () => {
    const store = fakeStore();
    writeBestTime(store, 42.5);
    expect(store.data[BEST_TIME_STORAGE_KEY]).toBe('42.5');
    expect(readBestTime(store)).toBeCloseTo(42.5, 9);
  });

  it('has no record to begin with', () => {
    expect(readBestTime(fakeStore())).toBeNull();
  });

  it('ignores nonsense a previous version might have left', () => {
    expect(readBestTime(fakeStore({ [BEST_TIME_STORAGE_KEY]: 'fast' }))).toBeNull();
    expect(readBestTime(fakeStore({ [BEST_TIME_STORAGE_KEY]: '-3' }))).toBeNull();
    expect(readBestTime(fakeStore({ [BEST_TIME_STORAGE_KEY]: '0' }))).toBeNull();
  });

  it('survives storage that is absent, or refuses writes', () => {
    expect(readBestTime(null)).toBeNull();
    expect(() => writeBestTime(null, 10)).not.toThrow();

    const hostile: TimeStore = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('quota');
      },
    };
    expect(readBestTime(hostile)).toBeNull();
    expect(() => writeBestTime(hostile, 10)).not.toThrow();
  });

  it('refuses to record a time that is not a time', () => {
    const store = fakeStore();
    writeBestTime(store, Number.NaN);
    writeBestTime(store, -1);
    expect(readBestTime(store)).toBeNull();
  });
});
