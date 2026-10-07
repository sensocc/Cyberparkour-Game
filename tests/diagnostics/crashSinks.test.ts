import { describe, expect, it } from 'vitest';

import { LogBuffer } from '../../src/core/log.js';
import { CRASH_SCHEMA, buildCrashReport, emptyEnvironment, emptyGameState, type CrashReport } from '../../src/diagnostics/crashReport.js';
import {
  ConsoleCrashSink,
  CRASH_STORAGE_KEY,
  MemoryCrashSink,
  StorageCrashSink,
  createMemoryStore,
  resolveStore,
} from '../../src/diagnostics/crashSinks.js';
import { logsFrom } from '../helpers/logs.js';

function report(message: string, source: 'manual' | 'game-loop' = 'manual'): CrashReport {
  return buildCrashReport({
    error: new Error(message),
    source,
    version: '0.0.0',
    environment: emptyEnvironment(),
    game: emptyGameState(),
    logs: [],
    now: () => new Date(0),
    idFactory: () => `id-${message}`,
  });
}

describe('MemoryCrashSink', () => {
  it('keeps reports for the page lifetime', () => {
    const sink = new MemoryCrashSink();
    sink.write(report('one'));
    sink.write(report('two'));
    expect(sink.reports.map((entry) => entry.error.message)).toEqual(['one', 'two']);
  });

  it('evicts the oldest reports past its limit', () => {
    const sink = new MemoryCrashSink(2);
    sink.write(report('one'));
    sink.write(report('two'));
    sink.write(report('three'));
    expect(sink.reports.map((entry) => entry.error.message)).toEqual(['two', 'three']);
  });

  it('clear empties it', () => {
    const sink = new MemoryCrashSink();
    sink.write(report('one'));
    sink.clear();
    expect(sink.reports).toEqual([]);
  });

  it('is named for logging', () => {
    expect(new MemoryCrashSink().name).toBe('memory');
  });
});

describe('ConsoleCrashSink', () => {
  it('logs through the shared logger', () => {
    const { logs } = logsFrom(() => new ConsoleCrashSink().write(report('console test', 'game-loop')));

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ level: 'error', scope: 'crash', message: 'game-loop: console test' });
  });

  it('is named for logging', () => {
    expect(new ConsoleCrashSink().name).toBe('console');
  });
});

describe('StorageCrashSink', () => {
  it('persists reports so they survive a reload', () => {
    const store = createMemoryStore();
    const sink = new StorageCrashSink(store);
    sink.write(report('persisted'));

    // A brand-new sink over the same store sees the previous session's report.
    const reopened = new StorageCrashSink(store);
    expect(reopened.read().map((entry) => entry.error.message)).toEqual(['persisted']);
    expect(reopened.read()[0]?.schema).toBe(CRASH_SCHEMA);
  });

  it('replaces a repeat of the same failure instead of piling up', () => {
    const store = createMemoryStore();
    const sink = new StorageCrashSink(store);

    sink.write(report('same failure'));
    sink.write(report('same failure'));
    sink.write(report('same failure'));

    const stored = sink.read();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.occurrences).toBe(3);
  });

  it('keeps distinct failures apart', () => {
    const store = createMemoryStore();
    const sink = new StorageCrashSink(store);
    sink.write(report('first'));
    sink.write(report('second'));
    expect(sink.read().map((entry) => entry.error.message)).toEqual(['first', 'second']);
  });

  it('bounds how many reports it retains', () => {
    const store = createMemoryStore();
    const sink = new StorageCrashSink(store, CRASH_STORAGE_KEY, 3);

    for (const message of ['a', 'b', 'c', 'd', 'e']) sink.write(report(message));

    const stored = sink.read();
    expect(stored).toHaveLength(3);
    expect(stored.map((entry) => entry.error.message)).toEqual(['c', 'd', 'e']);
  });

  it('increments the stored occurrence count', () => {
    const store = createMemoryStore();
    const sink = new StorageCrashSink(store);
    sink.write({ ...report('counting'), occurrences: 5 });
    sink.write({ ...report('counting'), occurrences: 1 });

    // The larger of the incoming count and the stored count + 1 wins.
    expect(sink.read()[0]?.occurrences).toBe(6);
  });

  it('discards unreadable stored data', () => {
    const store = createMemoryStore();
    store.setItem(CRASH_STORAGE_KEY, '{not json');

    const { result, logs } = logsFrom(() => new StorageCrashSink(store).read());

    expect(result).toEqual([]);
    expect(logs[0]).toMatchObject({ level: 'warn', scope: 'crash' });
    expect(logs[0]?.message).toContain('unreadable');
  });

  it('ignores stored JSON that is not an array of reports', () => {
    const store = createMemoryStore();
    store.setItem(CRASH_STORAGE_KEY, JSON.stringify({ nope: true }));
    expect(new StorageCrashSink(store).read()).toEqual([]);

    store.setItem(CRASH_STORAGE_KEY, JSON.stringify([{ schema: 'other', id: 'x' }, report('good')]));
    expect(new StorageCrashSink(store).read().map((entry) => entry.error.message)).toEqual(['good']);
  });

  it('reads an empty store as no reports', () => {
    expect(new StorageCrashSink(createMemoryStore()).read()).toEqual([]);
  });

  it('clear removes everything it wrote', () => {
    const store = createMemoryStore();
    const sink = new StorageCrashSink(store);
    sink.write(report('gone'));
    sink.clear();
    expect(store.getItem(CRASH_STORAGE_KEY)).toBeNull();
    expect(sink.read()).toEqual([]);
  });

  it('uses a versioned key so a future format change cannot be misread', () => {
    expect(CRASH_STORAGE_KEY).toMatch(/v1$/);
  });
});

describe('createMemoryStore', () => {
  it('behaves like a minimal localStorage', () => {
    const store = createMemoryStore();
    expect(store.getItem('missing')).toBeNull();
    store.setItem('key', 'value');
    expect(store.getItem('key')).toBe('value');
    store.removeItem('key');
    expect(store.getItem('key')).toBeNull();
  });

  it('stores string values only', () => {
    const store = createMemoryStore();
    store.setItem('key', '1');
    expect(store.getItem('key')).toBe('1');
  });
});

describe('resolveStore', () => {
  it('prefers an explicitly supplied store', () => {
    const store = createMemoryStore();
    expect(resolveStore(store)).toBe(store);
  });

  it('returns a usable store whatever the environment offers', () => {
    // In a browser this is localStorage; in Node (or private mode) it falls
    // back to memory. Either way the caller gets something that works.
    const store = resolveStore();
    store.setItem('cyberparkour.test', 'ok');
    expect(store.getItem('cyberparkour.test')).toBe('ok');
    store.removeItem('cyberparkour.test');
    expect(store.getItem('cyberparkour.test')).toBeNull();
  });

  it('falls back to memory when the environment throws on access', () => {
    // Some browsers throw on touching localStorage rather than returning null,
    // which is exactly what the probe in resolveStore exists to survive.
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('denied in private mode');
      },
    });

    try {
      const { result: store, logs } = logsFrom(() => resolveStore());
      store.setItem('k', 'v');
      expect(store.getItem('k')).toBe('v');
      expect(logs[0]?.message).toContain('localStorage unavailable');
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
      else Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });
});

describe('sink reuse in a logger-backed report', () => {
  it('persists the captured log tail', () => {
    const logs = new LogBuffer({ mirrorToConsole: false });
    logs.info('game', 'started');
    const store = createMemoryStore();
    const sink = new StorageCrashSink(store);

    sink.write(
      buildCrashReport({
        error: new Error('with logs'),
        source: 'game-loop',
        version: '0.0.0',
        environment: emptyEnvironment(),
        game: emptyGameState(),
        logs: logs.entries().map((entry) => entry.message),
      }),
    );

    expect(sink.read()[0]?.logs).toEqual(['started']);
  });
});
