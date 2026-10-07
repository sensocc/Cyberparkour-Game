/**
 * Crash report shape and construction.
 *
 * The report is a plain JSON document so it can be written to disk, copied to
 * the clipboard or - in a later version - POSTed to a remote collector without
 * touching the capture code. Everything here is pure: no DOM, no globals.
 */

import { safeStringify } from '../core/log.js';
import type { PlayerSnapshot } from '../game/player.js';

export const CRASH_SCHEMA = 'cyberparkour.crash.v1';

/** Where the failure was observed. */
export type CrashSource =
  | 'startup'
  | 'game-loop'
  | 'window-error'
  | 'unhandled-rejection'
  | 'webgl-context-lost'
  | 'manual';

export type CrashSeverity = 'error' | 'fatal';

export interface SerializedError {
  readonly name: string;
  readonly message: string;
  readonly stack: string | null;
  /** Stringified `cause` chain, when present. */
  readonly cause: string | null;
}

export interface CrashEnvironment {
  readonly userAgent: string;
  readonly url: string;
  readonly language: string;
  readonly viewport: {
    readonly width: number;
    readonly height: number;
    readonly devicePixelRatio: number;
  } | null;
  readonly pointerLocked: boolean | null;
  /** WebGL renderer string, when it could be read. */
  readonly renderer: string | null;
}

export interface CrashGameState {
  readonly levelId: string | null;
  readonly frameCount: number;
  readonly elapsedSeconds: number;
  readonly fps: number;
  readonly player: PlayerSnapshot | null;
}

export interface CrashReport {
  readonly schema: typeof CRASH_SCHEMA;
  readonly id: string;
  readonly timestamp: string;
  readonly version: string;
  readonly source: CrashSource;
  readonly severity: CrashSeverity;
  readonly fingerprint: string;
  /** How many times this fingerprint has been captured in this session. */
  readonly occurrences: number;
  readonly error: SerializedError;
  readonly environment: CrashEnvironment;
  readonly game: CrashGameState;
  /** Recent log lines, oldest first, formatted for humans. */
  readonly logs: readonly string[];
  /** Free-form diagnostics attached by the caller. */
  readonly extra?: Record<string, unknown>;
}

/** Normalises anything thrown into a serialisable shape. */
export function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    return {
      name: error.name || 'Error',
      message: error.message || '(no message)',
      stack: typeof error.stack === 'string' ? error.stack : null,
      cause: cause === undefined ? null : describeCause(cause),
    };
  }

  if (typeof error === 'string') {
    return { name: 'Error', message: error, stack: null, cause: null };
  }

  // Objects go through `safeStringify`, which survives cycles and awkward
  // values; primitives read better through `String()`.
  const isObject = typeof error === 'object' && error !== null;
  return {
    name: 'Error',
    message: isObject ? safeStringify(error) : String(error),
    stack: null,
    cause: null,
  };
}

function describeCause(cause: unknown): string {
  if (cause instanceof Error) return `${cause.name}: ${cause.message}`;
  if (typeof cause === 'string') return cause;
  return typeof cause === 'object' && cause !== null ? safeStringify(cause) : String(cause);
}

/**
 * Stable identity for a failure.
 *
 * Built from the source and the first line of the message, deliberately *not*
 * from the stack: line numbers move with every edit, which would make the same
 * bug look like a new one after each commit.
 */
export function crashFingerprint(error: SerializedError, source: CrashSource): string {
  const firstLine = error.message.split('\n')[0] ?? error.message;
  return `${source}|${error.name}|${firstLine}`;
}

/** Cheap, deterministic 32-bit hash, rendered as hex. */
export function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export interface BuildCrashReportInput {
  readonly error: unknown;
  readonly source: CrashSource;
  readonly severity?: CrashSeverity;
  readonly version: string;
  readonly environment: CrashEnvironment;
  readonly game: CrashGameState;
  readonly logs: readonly string[];
  readonly occurrences?: number;
  readonly extra?: Record<string, unknown>;
  /** Injectable for deterministic tests. */
  readonly now?: () => Date;
  readonly idFactory?: () => string;
}

export function buildCrashReport(input: BuildCrashReportInput): CrashReport {
  const serialized = serializeError(input.error);
  const now = input.now ?? (() => new Date());
  const idFactory = input.idFactory ?? defaultIdFactory;
  const fingerprint = crashFingerprint(serialized, input.source);

  return {
    schema: CRASH_SCHEMA,
    id: idFactory(),
    timestamp: now().toISOString(),
    version: input.version,
    source: input.source,
    severity: input.severity ?? 'error',
    fingerprint,
    occurrences: input.occurrences ?? 1,
    error: serialized,
    environment: input.environment,
    game: input.game,
    logs: input.logs.slice(),
    ...(input.extra ? { extra: input.extra } : {}),
  };
}

let idCounter = 0;

function defaultIdFactory(): string {
  idCounter += 1;
  const random = Math.random().toString(36).slice(2, 8);
  return `crash-${Date.now().toString(36)}-${idCounter.toString(36)}-${random}`;
}

/** Placeholder environment for contexts without a DOM (tests, Node). */
export function emptyEnvironment(): CrashEnvironment {
  return {
    userAgent: 'unknown',
    url: 'unknown',
    language: 'unknown',
    viewport: null,
    pointerLocked: null,
    renderer: null,
  };
}

export function emptyGameState(): CrashGameState {
  return { levelId: null, frameCount: 0, elapsedSeconds: 0, fps: 0, player: null };
}

/** One-line summary for the crash overlay's heading. */
export function summarizeReport(report: CrashReport): string {
  return `${report.error.name}: ${report.error.message}`;
}
