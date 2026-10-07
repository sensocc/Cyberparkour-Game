/**
 * Structured logging with a bounded history.
 *
 * The ring buffer exists for crash reports: when the game dies we attach the
 * last N log lines so the report explains *how* it got there, not just where.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  /** Monotonic sequence number, useful for ordering across async work. */
  readonly seq: number;
  /** Milliseconds since the owning buffer was created. */
  readonly timeMs: number;
  readonly level: LogLevel;
  readonly scope: string;
  readonly message: string;
  readonly data?: Record<string, unknown>;
}

export const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

const CONSOLE_METHOD: Record<LogLevel, 'debug' | 'info' | 'warn' | 'error'> = {
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  error: 'error',
};

export interface LogBufferOptions {
  /** Maximum retained entries. Oldest entries are evicted first. */
  capacity?: number;
  /** Minimum level actually recorded. */
  minLevel?: LogLevel;
  /** Mirror entries to the console. */
  mirrorToConsole?: boolean;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

export class LogBuffer {
  private readonly entries_: LogEntry[] = [];
  private readonly capacity: number;
  private readonly minLevelIndex: number;
  private mirrorToConsole: boolean;
  private readonly now: () => number;
  private readonly startedAt: number;
  private sequence = 0;

  constructor(options: LogBufferOptions = {}) {
    this.capacity = Math.max(1, Math.floor(options.capacity ?? 200));
    this.minLevelIndex = LOG_LEVELS.indexOf(options.minLevel ?? 'debug');
    this.mirrorToConsole = options.mirrorToConsole ?? true;
    this.now = options.now ?? (() => performance.now());
    this.startedAt = this.now();
  }

  get size(): number {
    return this.entries_.length;
  }

  log(level: LogLevel, scope: string, message: string, data?: Record<string, unknown>): void {
    if (LOG_LEVELS.indexOf(level) < this.minLevelIndex) return;

    const entry: LogEntry = {
      seq: this.sequence,
      timeMs: Math.round((this.now() - this.startedAt) * 1000) / 1000,
      level,
      scope,
      message,
      ...(data ? { data } : {}),
    };
    this.sequence += 1;

    this.entries_.push(entry);
    if (this.entries_.length > this.capacity) {
      this.entries_.splice(0, this.entries_.length - this.capacity);
    }

    if (this.mirrorToConsole) {
      const method = CONSOLE_METHOD[level];
      const prefix = `[${scope}]`;
      if (data) console[method](prefix, message, data);
      else console[method](prefix, message);
    }
  }

  debug(scope: string, message: string, data?: Record<string, unknown>): void {
    this.log('debug', scope, message, data);
  }

  info(scope: string, message: string, data?: Record<string, unknown>): void {
    this.log('info', scope, message, data);
  }

  warn(scope: string, message: string, data?: Record<string, unknown>): void {
    this.log('warn', scope, message, data);
  }

  error(scope: string, message: string, data?: Record<string, unknown>): void {
    this.log('error', scope, message, data);
  }

  /** Snapshot of the retained entries, oldest first. */
  entries(): readonly LogEntry[] {
    return this.entries_.slice();
  }

  /** The most recent `count` entries, oldest first. */
  tail(count: number): readonly LogEntry[] {
    if (count >= this.entries_.length) return this.entries();
    return this.entries_.slice(this.entries_.length - count);
  }

  clear(): void {
    this.entries_.length = 0;
  }

  /**
   * Turns console mirroring on or off.
   *
   * The buffer keeps recording either way - only the `console` side effect is
   * suppressed. Used to keep automated test output readable, and available to a
   * future "quiet" launch flag.
   */
  setMirrorToConsole(enabled: boolean): void {
    this.mirrorToConsole = enabled;
  }
}

/** Formats an entry as a single readable line (used by crash reports). */
export function formatLogEntry(entry: LogEntry): string {
  const time = (entry.timeMs / 1000).toFixed(3).padStart(9, ' ');
  const suffix = entry.data ? ` ${safeStringify(entry.data)}` : '';
  return `${time}s ${entry.level.toUpperCase().padEnd(5)} [${entry.scope}] ${entry.message}${suffix}`;
}

/** `JSON.stringify` that survives cycles and exotic values. */
export function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(value, (_key, val: unknown) => {
      if (typeof val === 'object' && val !== null) {
        if (seen.has(val)) return '[Circular]';
        seen.add(val);
      }
      if (typeof val === 'bigint') return `${val.toString()}n`;
      if (typeof val === 'function') return `[Function ${val.name || 'anonymous'}]`;
      if (typeof val === 'undefined') return '[undefined]';
      return val;
    }) ?? String(value);
  } catch {
    return '[Unserializable]';
  }
}

/** Shared logger for the running game. */
export const logger = new LogBuffer({ capacity: 300, mirrorToConsole: true });
