/**
 * Getting a crash report off the machine.
 *
 * Download is the primary path (it works everywhere, including a `file://`
 * build), with clipboard copy as a convenience. Both return a boolean rather
 * than throwing, because failing to export a report must not obscure the crash
 * the report is describing.
 */

import { logger, safeStringify } from '../core/log.js';
import type { CrashReport } from '../diagnostics/crashReport.js';

/** `cyberparkour-crash-2024-05-01T12-30-00Z-ab12cd.json` */
export function reportFilename(report: CrashReport): string {
  const stamp = report.timestamp.replace(/[:.]/g, '-');
  return `cyberparkour-crash-${stamp}-${report.id}.json`;
}

export function reportJson(report: CrashReport): string {
  try {
    return JSON.stringify(report, null, 2);
  } catch {
    // Should be impossible (the report is plain data), but a crash export must
    // still produce something readable.
    return safeStringify(report);
  }
}

/** Serialises a batch of reports, for the "recovered from last session" case. */
export function reportsJson(reports: readonly CrashReport[]): string {
  return JSON.stringify({ schema: 'cyberparkour.crash-bundle.v1', reports }, null, 2);
}

/** Triggers a file download. Returns false when the browser refused. */
export function downloadText(filename: string, contents: string, mime = 'application/json'): boolean {
  try {
    const blob = new Blob([contents], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    // Revoking immediately can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return true;
  } catch (error) {
    logger.warn('ui', 'could not download report', { error: String(error) });
    return false;
  }
}

export function downloadReport(report: CrashReport): boolean {
  return downloadText(reportFilename(report), reportJson(report));
}

export function downloadReports(reports: readonly CrashReport[], filename: string): boolean {
  return downloadText(filename, reportsJson(reports));
}

/** Copies text to the clipboard, falling back to a hidden textarea. */
export async function copyText(contents: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(contents);
      return true;
    }
  } catch (error) {
    logger.debug('ui', 'clipboard API refused, trying legacy path', { error: String(error) });
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = contents;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    return copied;
  } catch (error) {
    logger.warn('ui', 'could not copy report to the clipboard', { error: String(error) });
    return false;
  }
}

export function copyReport(report: CrashReport): Promise<boolean> {
  return copyText(reportJson(report));
}
