import { describe, expect, it } from 'vitest';

import {
  buildCrashReport,
  crashFingerprint,
  CRASH_SCHEMA,
  emptyEnvironment,
  emptyGameState,
  hashString,
  serializeError,
  summarizeReport,
  type CrashEnvironment,
  type CrashGameState,
} from '../../src/diagnostics/crashReport.js';

const ENVIRONMENT: CrashEnvironment = {
  userAgent: 'test-agent',
  url: 'http://localhost/',
  language: 'en-GB',
  viewport: { width: 1280, height: 720, devicePixelRatio: 2 },
  pointerLocked: true,
  renderer: 'Test GPU',
};

const GAME: CrashGameState = {
  levelId: 'demo-roof',
  frameCount: 42,
  elapsedSeconds: 1.5,
  fps: 60,
  player: {
    position: { x: 1, y: 0, z: 2 },
    velocity: { x: 0, y: 0, z: 0 },
    speed: 0,
    horizontalSpeed: 0,
    yaw: 0,
    pitch: 0,
    grounded: true,
    groundId: 'roof-deck',
    groundSurface: 'metal',
    stance: 'standing',
    alive: true,
    deaths: 0,
    deathCause: null,
    health: 74,
    locomotion: 'grounded',
    checkpoint: 1,
  },
};

describe('serializeError', () => {
  it('captures name, message and stack from an Error', () => {
    const serialized = serializeError(new TypeError('bad input'));
    expect(serialized.name).toBe('TypeError');
    expect(serialized.message).toBe('bad input');
    expect(serialized.stack).toContain('TypeError: bad input');
    expect(serialized.cause).toBeNull();
  });

  it('survives an error with an empty message', () => {
    const serialized = serializeError(new Error(''));
    expect(serialized.message).toBe('(no message)');
  });

  it('describes an Error cause', () => {
    const cause = new Error('root cause');
    const serialized = serializeError(new Error('wrapper', { cause }));
    expect(serialized.cause).toBe('Error: root cause');
  });

  it('describes a non-Error cause', () => {
    expect(serializeError(new Error('x', { cause: 'just a string' })).cause).toBe('just a string');
    expect(serializeError(new Error('x', { cause: { code: 9 } })).cause).toBe('{"code":9}');
  });

  it('handles a thrown string', () => {
    expect(serializeError('something broke')).toEqual({
      name: 'Error',
      message: 'something broke',
      stack: null,
      cause: null,
    });
  });

  it('handles a thrown plain object', () => {
    const serialized = serializeError({ status: 500, detail: 'server' });
    expect(serialized.name).toBe('Error');
    expect(serialized.message).toBe('{"status":500,"detail":"server"}');
    expect(serialized.stack).toBeNull();
  });

  it('handles a thrown circular object', () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(serializeError(circular).message).toBe('{"a":1,"self":"[Circular]"}');
  });

  it('falls back to String() for values JSON cannot express', () => {
    // JSON.stringify throws on BigInt, so the catch path takes over.
    expect(serializeError(10n).message).toBe('10');
    // JSON.stringify(undefined) yields undefined, which falls through to String().
    expect(serializeError(undefined).message).toBe('undefined');
    expect(serializeError(null).message).toBe('null');
  });
});

describe('crashFingerprint', () => {
  it('is stable across calls for the same failure', () => {
    const error = new Error('same problem');
    expect(crashFingerprint(serializeError(error), 'game-loop')).toBe(
      crashFingerprint(serializeError(error), 'game-loop'),
    );
  });

  it('ignores line numbers so an edit does not look like a new bug', () => {
    const a = serializeError(Object.assign(new Error('boom'), { stack: 'at a.ts:1:1' }));
    const b = serializeError(Object.assign(new Error('boom'), { stack: 'at a.ts:999:9' }));
    expect(crashFingerprint(a, 'game-loop')).toBe(crashFingerprint(b, 'game-loop'));
  });

  it('distinguishes the source of the failure', () => {
    const serialized = serializeError(new Error('boom'));
    expect(crashFingerprint(serialized, 'game-loop')).not.toBe(
      crashFingerprint(serialized, 'window-error'),
    );
  });

  it('distinguishes names and messages', () => {
    expect(crashFingerprint(serializeError(new Error('a')), 'manual')).not.toBe(
      crashFingerprint(serializeError(new Error('b')), 'manual'),
    );
    expect(crashFingerprint(serializeError(new RangeError('a')), 'manual')).not.toBe(
      crashFingerprint(serializeError(new Error('a')), 'manual'),
    );
  });

  it('uses only the first line of a multi-line message', () => {
    const a = serializeError(new Error('first\nsecond'));
    const b = serializeError(new Error('first\nthird'));
    expect(crashFingerprint(a, 'manual')).toBe(crashFingerprint(b, 'manual'));
  });
});

describe('hashString', () => {
  it('is deterministic', () => {
    expect(hashString('cyberparkour')).toBe(hashString('cyberparkour'));
  });

  it('produces eight lowercase hex digits', () => {
    expect(hashString('anything')).toMatch(/^[0-9a-f]{8}$/);
  });

  it('separates different inputs', () => {
    expect(hashString('a')).not.toBe(hashString('b'));
    expect(hashString('')).toBe('811c9dc5');
  });
});

describe('buildCrashReport', () => {
  const base = {
    error: new Error('render failed'),
    source: 'game-loop' as const,
    version: '0.0.0',
    environment: ENVIRONMENT,
    game: GAME,
    logs: ['0.000s INFO [app] booting', '0.100s INFO [game] started'],
  };

  it('produces a fully populated report', () => {
    const report = buildCrashReport({
      ...base,
      now: () => new Date('2024-05-01T12:30:00.000Z'),
      idFactory: () => 'crash-test-1',
    });

    expect(report.schema).toBe(CRASH_SCHEMA);
    expect(report.id).toBe('crash-test-1');
    expect(report.timestamp).toBe('2024-05-01T12:30:00.000Z');
    expect(report.version).toBe('0.0.0');
    expect(report.source).toBe('game-loop');
    expect(report.severity).toBe('error');
    expect(report.occurrences).toBe(1);
    expect(report.error.message).toBe('render failed');
    expect(report.environment).toBe(ENVIRONMENT);
    expect(report.game).toBe(GAME);
    expect(report.logs).toEqual(base.logs);
    expect(report.fingerprint).toBe('game-loop|Error|render failed');
  });

  it('defaults to error severity and allows fatal', () => {
    expect(buildCrashReport(base).severity).toBe('error');
    expect(buildCrashReport({ ...base, severity: 'fatal' }).severity).toBe('fatal');
  });

  it('copies the log array so later mutation cannot change the report', () => {
    const logs = ['one'];
    const report = buildCrashReport({ ...base, logs });
    logs.push('two');
    expect(report.logs).toEqual(['one']);
  });

  it('carries optional extra diagnostics', () => {
    expect(buildCrashReport(base).extra).toBeUndefined();
    expect(buildCrashReport({ ...base, extra: { frame: 12 } }).extra).toEqual({ frame: 12 });
  });

  it('honours an occurrence count', () => {
    expect(buildCrashReport({ ...base, occurrences: 4 }).occurrences).toBe(4);
  });

  it('generates unique ids by default', () => {
    const first = buildCrashReport(base).id;
    const second = buildCrashReport(base).id;
    expect(first).not.toBe(second);
    expect(first).toMatch(/^crash-/);
  });

  it('defaults the timestamp to now, in ISO form', () => {
    const report = buildCrashReport(base);
    expect(() => new Date(report.timestamp).toISOString()).not.toThrow();
    expect(report.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('round-trips through JSON unchanged', () => {
    const report = buildCrashReport({ ...base, now: () => new Date(0), idFactory: () => 'fixed' });
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });
});

describe('placeholders', () => {
  it('emptyEnvironment is inert but well-shaped', () => {
    const environment = emptyEnvironment();
    expect(environment.userAgent).toBe('unknown');
    expect(environment.viewport).toBeNull();
    expect(environment.pointerLocked).toBeNull();
  });

  it('emptyGameState reports nothing known', () => {
    expect(emptyGameState()).toEqual({
      levelId: null,
      frameCount: 0,
      elapsedSeconds: 0,
      fps: 0,
      player: null,
    });
  });

  it('summarizeReport gives a one-line heading', () => {
    const report = buildCrashReport({
      error: new RangeError('out of bounds'),
      source: 'window-error',
      version: '0.0.0',
      environment: ENVIRONMENT,
      game: GAME,
      logs: [],
    });
    expect(summarizeReport(report)).toBe('RangeError: out of bounds');
  });
});
