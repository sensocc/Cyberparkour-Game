/**
 * Observing the shared logger from tests.
 *
 * `tests/setup.ts` silences the logger's console mirror so test output stays
 * readable, which means tests must assert on the recorded entries instead of on
 * `console.*` spies. That is the better assertion anyway: it checks what the
 * code decided to log, not how the console was called.
 */

import { logger, type LogEntry } from '../../src/core/log.js';

/** Runs `body` and returns the log entries it produced. */
export function logsFrom<T>(body: () => T): { result: T; logs: readonly LogEntry[] } {
  const start = logger.entries().length;
  const result = body();
  return { result, logs: logger.entries().slice(start) };
}

/** As `logsFrom`, for bodies that log asynchronously. */
export async function logsFromAsync<T>(
  body: () => Promise<T>,
): Promise<{ result: T; logs: readonly LogEntry[] }> {
  const start = logger.entries().length;
  const result = await body();
  return { result, logs: logger.entries().slice(start) };
}

/** The most recent recorded entry, or undefined when nothing has been logged. */
export function latestLog(): LogEntry | undefined {
  return logger.entries().at(-1);
}

/** Messages of the given entries, for concise expectations. */
export function messages(logs: readonly LogEntry[]): string[] {
  return logs.map((entry) => entry.message);
}

/** Levels of the given entries, for concise expectations. */
export function levels(logs: readonly LogEntry[]): string[] {
  return logs.map((entry) => entry.level);
}
