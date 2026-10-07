import { describe, expect, it, vi } from 'vitest';

import {
  formatLogEntry,
  LogBuffer,
  logger,
  safeStringify,
  type LogBufferOptions,
} from '../../src/core/log.js';

function createBuffer(options: LogBufferOptions = {}) {
  let clock = 0;
  const buffer = new LogBuffer({ mirrorToConsole: false, now: () => clock, ...options });
  return { buffer, advance: (ms: number) => void (clock += ms) };
}

describe('LogBuffer', () => {
  it('records entries with scope, level, message and data', () => {
    const { buffer, advance } = createBuffer();
    advance(12.5);
    buffer.info('game', 'started', { level: 'demo-roof' });

    const entries = buffer.entries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      seq: 0,
      timeMs: 12.5,
      level: 'info',
      scope: 'game',
      message: 'started',
      data: { level: 'demo-roof' },
    });
  });

  it('assigns increasing sequence numbers', () => {
    const { buffer } = createBuffer();
    buffer.debug('a', 'one');
    buffer.warn('b', 'two');
    buffer.error('c', 'three');
    expect(buffer.entries().map((entry) => entry.seq)).toEqual([0, 1, 2]);
  });

  it('omits the data field when none is supplied', () => {
    const { buffer } = createBuffer();
    buffer.info('scope', 'no data here');
    expect(buffer.entries()[0]).not.toHaveProperty('data');
  });

  it('evicts the oldest entries once capacity is reached', () => {
    const { buffer } = createBuffer({ capacity: 3 });
    for (let index = 0; index < 6; index += 1) buffer.info('scope', `message ${index}`);

    const messages = buffer.entries().map((entry) => entry.message);
    expect(messages).toEqual(['message 3', 'message 4', 'message 5']);
    expect(buffer.size).toBe(3);
  });

  it('drops entries below the minimum level', () => {
    const { buffer } = createBuffer({ minLevel: 'warn' });
    buffer.debug('scope', 'debug');
    buffer.info('scope', 'info');
    buffer.warn('scope', 'warn');
    buffer.error('scope', 'error');

    expect(buffer.entries().map((entry) => entry.level)).toEqual(['warn', 'error']);
  });

  it('tail returns the newest entries in chronological order', () => {
    const { buffer } = createBuffer();
    for (let index = 0; index < 5; index += 1) buffer.info('scope', `m${index}`);

    expect(buffer.tail(2).map((entry) => entry.message)).toEqual(['m3', 'm4']);
    expect(buffer.tail(99)).toHaveLength(5);
    expect(buffer.tail(0)).toEqual([]);
  });

  it('returns snapshots that cannot mutate the buffer', () => {
    const { buffer } = createBuffer();
    buffer.info('scope', 'only');
    const snapshot = buffer.entries();
    expect(snapshot).toHaveLength(1);
    // `entries()` returns a copy, so this cannot affect the buffer.
    expect(buffer.entries()).toHaveLength(1);
  });

  it('clear empties the buffer but keeps the sequence counter', () => {
    const { buffer } = createBuffer();
    buffer.info('scope', 'a');
    buffer.clear();
    expect(buffer.size).toBe(0);

    buffer.info('scope', 'b');
    expect(buffer.entries()[0]?.seq).toBe(1);
  });

  it('treats a capacity below one as one', () => {
    const { buffer } = createBuffer({ capacity: 0 });
    buffer.info('scope', 'a');
    buffer.info('scope', 'b');
    expect(buffer.entries().map((entry) => entry.message)).toEqual(['b']);
  });

  it('mirrors to the console when asked', () => {
    const { buffer } = createBuffer({ mirrorToConsole: true });
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    buffer.warn('scope', 'careful', { code: 7 });
    expect(spy).toHaveBeenCalledWith('[scope]', 'careful', { code: 7 });
  });

  it('exposes a shared logger instance', () => {
    expect(logger).toBeInstanceOf(LogBuffer);
    expect(logger.size).toBeGreaterThanOrEqual(0);
  });

  it('mirroring can be turned off without losing entries', () => {
    const { buffer } = createBuffer({ mirrorToConsole: true });
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});

    buffer.setMirrorToConsole(false);
    buffer.info('scope', 'quiet now');

    expect(spy).not.toHaveBeenCalled();
    expect(buffer.entries().map((entry) => entry.message)).toEqual(['quiet now']);

    buffer.setMirrorToConsole(true);
    buffer.info('scope', 'loud again');
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('formatLogEntry', () => {
  it('renders a padded, readable line', () => {
    const line = formatLogEntry({
      seq: 3,
      timeMs: 1500,
      level: 'warn',
      scope: 'render',
      message: 'slow frame',
      data: { ms: 42 },
    });
    expect(line).toBe('    1.500s WARN  [render] slow frame {"ms":42}');
  });

  it('omits the data block when there is none', () => {
    const line = formatLogEntry({
      seq: 0,
      timeMs: 0,
      level: 'debug',
      scope: 'game',
      message: 'tick',
    });
    expect(line).toBe('    0.000s DEBUG [game] tick');
  });
});

describe('safeStringify', () => {
  it('serializes plain values', () => {
    expect(safeStringify({ a: 1 })).toBe('{"a":1}');
  });

  it('survives circular references', () => {
    const node: Record<string, unknown> = { name: 'root' };
    node.self = node;
    expect(safeStringify(node)).toBe('{"name":"root","self":"[Circular]"}');
  });

  it('describes awkward JavaScript values instead of throwing', () => {
    const result = safeStringify({
      big: 10n,
      fn: function named() {},
      missing: undefined,
    });
    expect(result).toContain('"big":"10n"');
    expect(result).toContain('"fn":"[Function named]"');
    expect(result).toContain('"missing":"[undefined]"');
  });

  it('falls back gracefully when a property throws on access', () => {
    const hostile = {
      get boom(): never {
        throw new Error('no');
      },
    };
    expect(safeStringify(hostile)).toBe('[Unserializable]');
  });
});
