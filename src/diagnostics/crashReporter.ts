/**
 * Automatic error and crash reporting.
 *
 * Captures failures from three places:
 *  1. the game loop (errors thrown inside a frame),
 *  2. `window.onerror` (anything uncaught on the main thread),
 *  3. `unhandledrejection` (unawaited async failures).
 *
 * Each capture builds a report, fans it out to the configured sinks and
 * notifies the UI so the player sees what happened instead of a frozen canvas.
 * The reporter itself is defensive to the point of paranoia: a failure while
 * reporting a failure must never cascade.
 */

import { formatLogEntry, logger, type LogBuffer } from '../core/log.js';
import {
  buildCrashReport,
  crashFingerprint,
  emptyEnvironment,
  emptyGameState,
  serializeError,
  type CrashEnvironment,
  type CrashGameState,
  type CrashReport,
  type CrashSeverity,
  type CrashSource,
} from './crashReport.js';
import { ConsoleCrashSink, MemoryCrashSink, type CrashSink } from './crashSinks.js';

/** The subset of `window` the reporter needs in order to install hooks. */
export interface CrashEventTarget {
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
}

export interface CrashReporterOptions {
  /** Build version stamped into every report. */
  readonly version: string;
  readonly sinks?: readonly CrashSink[];
  /** Ring buffer whose tail is quoted in the report. */
  readonly logBuffer?: LogBuffer;
  /** How many log lines a report carries. */
  readonly logTail?: number;
  /** Snapshot of the live game, evaluated at capture time. */
  readonly getGameState?: () => CrashGameState;
  /** Snapshot of the browser/graphics environment. */
  readonly getEnvironment?: () => CrashEnvironment;
  /** Called after a report has been written to every sink. */
  readonly onCapture?: (report: CrashReport) => void;
  /** Injectable clock and id generator for deterministic tests. */
  readonly now?: () => Date;
  readonly idFactory?: () => string;
  /** Maximum reports retained in memory. */
  readonly maxReports?: number;
}

export interface CaptureOptions {
  readonly source?: CrashSource;
  readonly severity?: CrashSeverity;
  readonly extra?: Record<string, unknown>;
}

export class CrashReporter {
  private readonly sinks: readonly CrashSink[];
  private readonly version: string;
  private readonly logBuffer: LogBuffer | undefined;
  private readonly logTail: number;
  private readonly getGameState: () => CrashGameState;
  private readonly getEnvironment: () => CrashEnvironment;
  private readonly onCaptureCallback: ((report: CrashReport) => void) | undefined;
  private readonly now: () => Date;
  private readonly idFactory: (() => string) | undefined;
  private readonly maxReports: number;
  private readonly captured: CrashReport[] = [];
  private readonly occurrences = new Map<string, number>();
  /** Listeners currently registered, so `uninstall` can remove exactly them. */
  private installed: { target: CrashEventTarget; error: (event: unknown) => void; rejection: (event: unknown) => void } | null =
    null;

  constructor(options: CrashReporterOptions) {
    this.version = options.version;
    this.sinks = options.sinks ?? [new ConsoleCrashSink(), new MemoryCrashSink()];
    this.logBuffer = options.logBuffer;
    this.logTail = options.logTail ?? 60;
    this.getGameState = options.getGameState ?? emptyGameState;
    this.getEnvironment = options.getEnvironment ?? emptyEnvironment;
    this.onCaptureCallback = options.onCapture;
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory;
    this.maxReports = options.maxReports ?? 25;
  }

  /** Reports captured this session, oldest first. */
  get reports(): readonly CrashReport[] {
    return this.captured;
  }

  get lastReport(): CrashReport | null {
    return this.captured[this.captured.length - 1] ?? null;
  }

  get isInstalled(): boolean {
    return this.installed !== null;
  }

  /**
   * Records a failure and fans it out to the sinks.
   *
   * Never throws; an internal failure degrades to a console warning.
   */
  capture(error: unknown, options: CaptureOptions = {}): CrashReport {
    const report = this.buildReport(
      error,
      options.source ?? 'manual',
      options.severity ?? 'fatal',
      options.extra,
    );

    this.captured.push(report);
    if (this.captured.length > this.maxReports) {
      this.captured.splice(0, this.captured.length - this.maxReports);
    }

    for (const sink of this.sinks) {
      try {
        const result = sink.write(report);
        if (result instanceof Promise) {
          result.catch((sinkError: unknown) => {
            logger.warn('crash', `sink "${sink.name}" rejected the report`, {
              error: String(sinkError),
            });
          });
        }
      } catch (sinkError) {
        // A broken sink must not cost us the other sinks.
        logger.warn('crash', `sink "${sink.name}" failed`, { error: String(sinkError) });
      }
    }

    try {
      this.onCaptureCallback?.(report);
    } catch (callbackError) {
      logger.warn('crash', 'onCapture callback threw', { error: String(callbackError) });
    }

    return report;
  }

  /** Subscribes to global error events. */
  install(target: CrashEventTarget = globalThis as unknown as CrashEventTarget): void {
    this.uninstall();

    const error = (event: unknown): void => {
      const described = describeErrorEvent(event);
      this.capture(described.error ?? new Error(described.message || 'Unknown error'), {
        source: 'window-error',
      });
    };
    const rejection = (event: unknown): void => {
      const reason = (event as { reason?: unknown } | null)?.reason;
      this.capture(reason ?? new Error('Unhandled promise rejection'), {
        source: 'unhandled-rejection',
      });
    };

    target.addEventListener('error', error);
    target.addEventListener('unhandledrejection', rejection);
    this.installed = { target, error, rejection };
  }

  uninstall(): void {
    const current = this.installed;
    if (!current) return;

    current.target.removeEventListener('error', current.error);
    current.target.removeEventListener('unhandledrejection', current.rejection);
    this.installed = null;
  }

  clear(): void {
    this.captured.length = 0;
    this.occurrences.clear();
  }

  /** Serialises a report as pretty JSON, ready for download or clipboard. */
  toJson(report: CrashReport): string {
    return JSON.stringify(report, null, 2);
  }

  /** Human-readable one-liner, e.g. `game-loop: Simulated failure at frame 12`. */
  describe(report: CrashReport): string {
    return `${report.source}: ${report.error.message}`;
  }

  private buildReport(
    error: unknown,
    source: CrashSource,
    severity: CrashSeverity,
    extra?: Record<string, unknown>,
  ): CrashReport {
    const serialized = serializeError(error);
    const fingerprint = crashFingerprint(serialized, source);
    const count = (this.occurrences.get(fingerprint) ?? 0) + 1;
    this.occurrences.set(fingerprint, count);

    return buildCrashReport({
      error,
      source,
      severity,
      version: this.version,
      environment: this.safeEnvironment(),
      game: this.safeGameState(),
      logs: this.recentLogs(),
      occurrences: count,
      ...(extra ? { extra } : {}),
      now: this.now,
      ...(this.idFactory ? { idFactory: this.idFactory } : {}),
    });
  }

  private safeGameState(): CrashGameState {
    try {
      return this.getGameState();
    } catch {
      return emptyGameState();
    }
  }

  private safeEnvironment(): CrashEnvironment {
    try {
      return this.getEnvironment();
    } catch {
      return emptyEnvironment();
    }
  }

  private recentLogs(): string[] {
    if (!this.logBuffer) return [];
    try {
      return this.logBuffer.tail(this.logTail).map(formatLogEntry);
    } catch {
      return [];
    }
  }
}

/**
 * Pulls an `Error` (and a message) out of a `window` `error` event.
 *
 * `ErrorEvent` is not defined outside browsers, hence the `typeof` guard.
 */
export function describeErrorEvent(event: unknown): { error: unknown; message: string } {
  if (typeof ErrorEvent !== 'undefined' && event instanceof ErrorEvent) {
    return { error: event.error, message: event.message };
  }
  if (event instanceof Error) {
    return { error: event, message: event.message };
  }

  const candidate = event as { error?: unknown; message?: unknown } | null;
  const message = typeof candidate?.message === 'string' ? candidate.message : '';
  return { error: candidate?.error ?? null, message };
}
