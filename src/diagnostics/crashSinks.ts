/**
 * Crash report sinks - where a finished report goes.
 *
 * V0.0 ships local sinks only (console + `localStorage`). Because the reporter
 * talks to this interface, adding a remote collector later is a new class, not
 * a rewrite - and the interface is the exact seam the V0.0 brief asked for.
 */

import { logger, safeStringify } from '../core/log.js';
import { CRASH_SCHEMA, type CrashReport } from './crashReport.js';

export interface CrashSink {
  readonly name: string;
  write(report: CrashReport): void | Promise<void>;
}

/** Minimal `localStorage` surface, so tests can supply a fake. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const CRASH_STORAGE_KEY = 'cyberparkour.crash-reports.v1';

/** Keeps reports in memory for the lifetime of the page. */
export class MemoryCrashSink implements CrashSink {
  readonly name = 'memory';
  private readonly stored: CrashReport[] = [];

  constructor(private readonly limit = 50) {}

  write(report: CrashReport): void {
    this.stored.push(report);
    if (this.stored.length > this.limit) {
      this.stored.splice(0, this.stored.length - this.limit);
    }
  }

  get reports(): readonly CrashReport[] {
    return this.stored;
  }

  clear(): void {
    this.stored.length = 0;
  }
}

/** Echoes the report to the developer console. */
export class ConsoleCrashSink implements CrashSink {
  readonly name = 'console';

  write(report: CrashReport): void {
    logger.error('crash', `${report.source}: ${report.error.message}`, {
      v: report.version,
      id: report.id,
      where: report.error.stack?.split('\n')[1]?.trim(),
    });
  }
}

/**
 * Persists reports to `localStorage` so they survive the crash *and* the
 * reload that follows it - that is what makes the reporting automatic rather
 * than something the player has to remember to do.
 *
 * Repeat failures with the same fingerprint replace their existing entry
 * instead of piling up, so one bad frame cannot evict everything else.
 */
export class StorageCrashSink implements CrashSink {
  readonly name = 'storage';

  constructor(
    private readonly store: KeyValueStore,
    private readonly key = CRASH_STORAGE_KEY,
    private readonly limit = 10,
  ) {}

  write(report: CrashReport): void {
    const existing = this.read();
    const index = existing.findIndex((entry) => entry.fingerprint === report.fingerprint);

    if (index >= 0) {
      const previous = existing[index];
      const merged: CrashReport = {
        ...report,
        occurrences: Math.max(report.occurrences, (previous?.occurrences ?? 1) + 1),
      };
      existing[index] = merged;
    } else {
      existing.push(report);
    }

    const trimmed = existing.length > this.limit ? existing.slice(existing.length - this.limit) : existing;
    this.store.setItem(this.key, safeStringify(trimmed));
  }

  /** Reports written by this and previous sessions. */
  read(): CrashReport[] {
    const raw = this.store.getItem(this.key);
    if (!raw) return [];

    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isCrashReport);
    } catch (error) {
      logger.warn('crash', 'stored crash reports are unreadable and were discarded', {
        error: String(error),
      });
      return [];
    }
  }

  clear(): void {
    this.store.removeItem(this.key);
  }
}

function isCrashReport(value: unknown): value is CrashReport {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<CrashReport>;
  return candidate.schema === CRASH_SCHEMA && typeof candidate.id === 'string';
}

/**
 * In-memory store used when `localStorage` is unavailable (private browsing,
 * disabled storage, Node tests). Keeps the sink API uniform.
 */
export function createMemoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

/**
 * Returns the storage implementation to use, falling back to memory when the
 * real thing is missing or throws (some browsers throw on access in private
 * mode rather than returning null).
 */
export function resolveStore(candidate?: KeyValueStore | null): KeyValueStore {
  if (candidate) return candidate;
  try {
    const storage = globalThis.localStorage;
    // Touch it: access itself can throw under strict privacy settings.
    const probe = '__cyberparkour_probe__';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    logger.warn('crash', 'localStorage unavailable - crash reports are kept in memory only');
    return createMemoryStore();
  }
}
