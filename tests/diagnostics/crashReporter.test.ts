// @vitest-environment jsdom
//
// The reporter installs `window` error handlers, so it belongs in a DOM
// environment. `install()` with no argument is only meaningful where
// `globalThis` actually is a window.

import { describe, expect, it, vi } from 'vitest';

import { LogBuffer } from '../../src/core/log.js';
import {
  CRASH_SCHEMA,
  emptyEnvironment,
  emptyGameState,
  type CrashGameState,
  type CrashReport,
} from '../../src/diagnostics/crashReport.js';
import { CrashReporter, describeErrorEvent, type CrashEventTarget } from '../../src/diagnostics/crashReporter.js';
import { MemoryCrashSink, type CrashSink } from '../../src/diagnostics/crashSinks.js';
import { logsFrom, logsFromAsync, messages } from '../helpers/logs.js';

const VERSION = '0.0.0';

function createReporter(overrides: Partial<ConstructorParameters<typeof CrashReporter>[0]> = {}) {
  return new CrashReporter({
    version: VERSION,
    sinks: [],
    getGameState: emptyGameState,
    getEnvironment: emptyEnvironment,
    now: () => new Date('2024-05-01T12:00:00.000Z'),
    idFactory: (() => {
      let counter = 0;
      return () => `id-${(counter += 1)}`;
    })(),
    ...overrides,
  });
}

/** Captures the listeners a reporter installs, so tests can fire events. */
class FakeEventTarget implements CrashEventTarget {
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, event: unknown): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }

  count(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }

  get total(): number {
    let total = 0;
    for (const set of this.listeners.values()) total += set.size;
    return total;
  }
}

describe('CrashReporter.capture', () => {
  it('records a report and writes it to every sink', () => {
    const first = new MemoryCrashSink();
    const second = new MemoryCrashSink();
    const reporter = createReporter({ sinks: [first, second] });

    const report = reporter.capture(new Error('boom'), { source: 'game-loop' });

    expect(report.schema).toBe(CRASH_SCHEMA);
    expect(report.version).toBe(VERSION);
    expect(report.source).toBe('game-loop');
    expect(report.severity).toBe('fatal');
    expect(report.timestamp).toBe('2024-05-01T12:00:00.000Z');
    expect(report.id).toBe('id-1');
    expect(first.reports).toHaveLength(1);
    expect(second.reports).toHaveLength(1);
    expect(reporter.reports).toHaveLength(1);
    expect(reporter.lastReport).toBe(report);
  });

  it('defaults to a manual, fatal capture', () => {
    const report = createReporter().capture(new Error('x'));
    expect(report.source).toBe('manual');
    expect(report.severity).toBe('fatal');
  });

  it('allows a non-fatal severity', () => {
    expect(createReporter().capture(new Error('x'), { severity: 'error' }).severity).toBe('error');
  });

  it('counts repeat failures by fingerprint', () => {
    const reporter = createReporter();
    const first = reporter.capture(new Error('flaky'));
    const second = reporter.capture(new Error('flaky'));
    const third = reporter.capture(new Error('flaky'));

    expect(first.occurrences).toBe(1);
    expect(second.occurrences).toBe(2);
    expect(third.occurrences).toBe(3);
    expect(first.fingerprint).toBe(third.fingerprint);
    expect(reporter.reports).toHaveLength(3);
  });

  it('counts different sources separately', () => {
    const reporter = createReporter();
    expect(reporter.capture(new Error('same'), { source: 'game-loop' }).occurrences).toBe(1);
    expect(reporter.capture(new Error('same'), { source: 'window-error' }).occurrences).toBe(1);
  });

  it('snapshots the live game state and environment at capture time', () => {
    const state: CrashGameState = {
      levelId: 'demo-roof',
      frameCount: 7,
      elapsedSeconds: 0.5,
      fps: 60,
      player: null,
    };
    const reporter = createReporter({
      getGameState: () => state,
      getEnvironment: () => ({ ...emptyEnvironment(), userAgent: 'live-agent' }),
    });

    const report = reporter.capture(new Error('x'));
    expect(report.game).toBe(state);
    expect(report.environment.userAgent).toBe('live-agent');
  });

  it('falls back to empty state when a snapshot provider throws', () => {
    const reporter = createReporter({
      getGameState: () => {
        throw new Error('state unavailable');
      },
      getEnvironment: () => {
        throw new Error('environment unavailable');
      },
    });

    const report = reporter.capture(new Error('primary failure'));
    expect(report.game).toEqual(emptyGameState());
    expect(report.environment).toEqual(emptyEnvironment());
    // The primary error is still the one reported.
    expect(report.error.message).toBe('primary failure');
  });

  it('quotes the tail of the log buffer', () => {
    const logBuffer = new LogBuffer({ capacity: 50, mirrorToConsole: false });
    for (let index = 0; index < 10; index += 1) logBuffer.info('app', `line ${index}`);

    const reporter = createReporter({ logBuffer, logTail: 3 });
    const report = reporter.capture(new Error('x'));

    expect(report.logs).toHaveLength(3);
    expect(report.logs[0]).toContain('line 7');
    expect(report.logs[2]).toContain('line 9');
  });

  it('carries no logs when no buffer is supplied', () => {
    expect(createReporter().capture(new Error('x')).logs).toEqual([]);
  });

  it('survives a sink that throws on write', () => {
    const hostile: CrashSink = {
      name: 'hostile',
      write: () => {
        throw new Error('sink is broken');
      },
    };
    const good = new MemoryCrashSink();
    const reporter = createReporter({ sinks: [hostile, good] });

    const { result: report, logs } = logsFrom(() => reporter.capture(new Error('x')));

    expect(report.error.message).toBe('x');
    expect(good.reports).toHaveLength(1);
    expect(messages(logs).join(' ')).toContain('sink "hostile" failed');
  });

  it('survives a sink whose write rejects asynchronously', async () => {
    const rejecting: CrashSink = {
      name: 'rejecting',
      write: () => Promise.reject(new Error('async sink failure')),
    };
    const reporter = createReporter({ sinks: [rejecting] });

    const { logs } = await logsFromAsync(async () => {
      reporter.capture(new Error('x'));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(messages(logs).join(' ')).toContain('sink "rejecting" rejected the report');
  });

  it('invokes the onCapture callback', () => {
    const onCapture = vi.fn();
    const reporter = createReporter({ onCapture });

    const report = reporter.capture(new Error('x'));
    expect(onCapture).toHaveBeenCalledWith(report);
  });

  it('survives an onCapture callback that throws', () => {
    const reporter = createReporter({
      onCapture: () => {
        throw new Error('callback is broken');
      },
    });

    const { logs } = logsFrom(() => reporter.capture(new Error('x')));
    expect(messages(logs)).toEqual(['onCapture callback threw']);
  });

  it('bounds how many reports it retains', () => {
    const reporter = createReporter({ maxReports: 3 });
    for (let index = 0; index < 6; index += 1) reporter.capture(new Error(`failure ${index}`));

    expect(reporter.reports).toHaveLength(3);
    expect(reporter.reports.map((entry) => entry.error.message)).toEqual([
      'failure 3',
      'failure 4',
      'failure 5',
    ]);
  });

  it('clear resets the history and the occurrence counters', () => {
    const reporter = createReporter();
    reporter.capture(new Error('flaky'));
    reporter.clear();

    expect(reporter.reports).toEqual([]);
    expect(reporter.lastReport).toBeNull();
    expect(reporter.capture(new Error('flaky')).occurrences).toBe(1);
  });

  it('toJson produces pretty, parseable JSON', () => {
    const reporter = createReporter();
    const report = reporter.capture(new Error('serialize me'));
    const json = reporter.toJson(report);

    expect(json).toContain('\n');
    expect(json.split('\n').length).toBeGreaterThan(5);
    const parsed = JSON.parse(json) as CrashReport;
    expect(parsed.error.message).toBe('serialize me');
  });

  it('describe gives a one-line summary', () => {
    const reporter = createReporter();
    const report = reporter.capture(new Error('needs a summary'), { source: 'game-loop' });
    expect(reporter.describe(report)).toBe('game-loop: needs a summary');
  });
});

describe('CrashReporter.install', () => {
  it('subscribes to error and unhandledrejection', () => {
    const target = new FakeEventTarget();
    const reporter = createReporter();
    reporter.install(target);

    expect(reporter.isInstalled).toBe(true);
    expect(target.count('error')).toBe(1);
    expect(target.count('unhandledrejection')).toBe(1);
  });

  it('captures an uncaught window error', () => {
    const target = new FakeEventTarget();
    const reporter = createReporter();
    reporter.install(target);

    target.emit('error', { error: new Error('uncaught!'), message: 'uncaught!' });

    expect(reporter.reports).toHaveLength(1);
    expect(reporter.lastReport?.source).toBe('window-error');
    expect(reporter.lastReport?.error.message).toBe('uncaught!');
  });

  it('captures a rejection reason', () => {
    const target = new FakeEventTarget();
    const reporter = createReporter();
    reporter.install(target);

    target.emit('unhandledrejection', { reason: new Error('rejected!') });

    expect(reporter.lastReport?.source).toBe('unhandled-rejection');
    expect(reporter.lastReport?.error.message).toBe('rejected!');
  });

  it('copes with an error event that carries no Error object', () => {
    const target = new FakeEventTarget();
    const reporter = createReporter();
    reporter.install(target);

    target.emit('error', { message: 'cross-origin script error' });

    expect(reporter.lastReport?.error.message).toBe('cross-origin script error');
  });

  it('copes with a rejection that carries no reason', () => {
    const target = new FakeEventTarget();
    const reporter = createReporter();
    reporter.install(target);

    target.emit('unhandledrejection', {});

    expect(reporter.lastReport?.error.message).toBe('Unhandled promise rejection');
  });

  it('uninstall removes exactly what it installed', () => {
    const target = new FakeEventTarget();
    const reporter = createReporter();
    reporter.install(target);
    reporter.uninstall();

    expect(reporter.isInstalled).toBe(false);
    expect(target.total).toBe(0);
    expect(() => target.emit('error', { error: new Error('after uninstall') })).not.toThrow();
    expect(reporter.reports).toEqual([]);
  });

  it('installing twice replaces the previous subscription instead of doubling it', () => {
    const target = new FakeEventTarget();
    const reporter = createReporter();

    reporter.install(target);
    reporter.install(target);
    expect(target.count('error')).toBe(1);

    target.emit('error', { error: new Error('once') });
    expect(reporter.reports).toHaveLength(1);
  });

  it('uses globalThis by default', () => {
    const reporter = createReporter();
    try {
      reporter.install();
      expect(reporter.isInstalled).toBe(true);
    } finally {
      reporter.uninstall();
    }
    expect(reporter.isInstalled).toBe(false);
  });
});

describe('describeErrorEvent', () => {
  it('reads an Error instance', () => {
    const error = new Error('direct');
    expect(describeErrorEvent(error)).toEqual({ error, message: 'direct' });
  });

  it('reads a plain event-shaped object', () => {
    const error = new Error('wrapped');
    expect(describeErrorEvent({ error, message: 'wrapped' })).toEqual({ error, message: 'wrapped' });
  });

  it('tolerates a missing error and message', () => {
    expect(describeErrorEvent({})).toEqual({ error: null, message: '' });
    expect(describeErrorEvent(null)).toEqual({ error: null, message: '' });
  });

  it('ignores a non-string message', () => {
    expect(describeErrorEvent({ message: 42 })).toEqual({ error: null, message: '' });
  });
});
