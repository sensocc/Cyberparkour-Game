// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildCrashReport, emptyEnvironment, emptyGameState } from '../../src/diagnostics/crashReport.js';
import {
  copyReport,
  copyText,
  downloadReport,
  downloadReports,
  downloadText,
  reportFilename,
  reportJson,
  reportsJson,
} from '../../src/ui/reportIO.js';
import { logsFrom, logsFromAsync } from '../helpers/logs.js';

function report(message = 'boom') {
  return buildCrashReport({
    error: new Error(message),
    source: 'game-loop',
    version: '0.0.0',
    environment: emptyEnvironment(),
    game: emptyGameState(),
    logs: [],
    now: () => new Date('2024-05-01T12:30:00.250Z'),
    idFactory: () => 'crash-abc123',
  });
}

describe('reportFilename', () => {
  it('is descriptive, filesystem-safe and unique', () => {
    const name = reportFilename(report());
    expect(name).toBe('cyberparkour-crash-2024-05-01T12-30-00-250Z-crash-abc123.json');
    // No characters that Windows or a shell would object to.
    expect(name).not.toMatch(/[:<>"|?*\\/]/);
  });

  it('is unique per report id, so two crashes never overwrite each other', () => {
    const other = buildCrashReport({
      error: new Error('boom'),
      source: 'game-loop',
      version: '0.0.0',
      environment: emptyEnvironment(),
      game: emptyGameState(),
      logs: [],
      now: () => new Date('2024-05-01T12:30:00.250Z'),
      idFactory: () => 'crash-zzz999',
    });

    expect(reportFilename(other)).not.toBe(reportFilename(report()));
    expect(reportFilename(other)).toContain('crash-zzz999');
  });
});

describe('reportJson', () => {
  it('is pretty and parseable', () => {
    const json = reportJson(report());
    expect(json).toContain('\n  ');
    expect(JSON.parse(json).error.message).toBe('boom');
  });

  it('falls back to a lossy rendering rather than throwing', () => {
    const hostile = {
      schema: 'cyberparkour.crash.v1',
      id: 'x',
      get error(): never {
        throw new Error('unreadable');
      },
    } as unknown as ReturnType<typeof report>;
    expect(() => reportJson(hostile)).not.toThrow();
    expect(reportJson(hostile).length).toBeGreaterThan(0);
  });
});

describe('reportsJson', () => {
  it('wraps a batch in a schema-tagged bundle', () => {
    const bundle = JSON.parse(reportsJson([report('one'), report('two')]));
    expect(bundle.schema).toBe('cyberparkour.crash-bundle.v1');
    expect(bundle.reports).toHaveLength(2);
    expect(bundle.reports[1].error.message).toBe('two');
  });

  it('handles an empty batch', () => {
    expect(JSON.parse(reportsJson([])).reports).toEqual([]);
  });
});

describe('downloadText', () => {
  const createObjectURL = vi.fn((_blob: Blob) => 'blob:fake');
  const revokeObjectURL = vi.fn((_url: string) => {});
  let clicked: { download: string; href: string }[] = [];

  beforeEach(() => {
    clicked = [];
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    // Record what the anchor was configured with, then short-circuit the click.
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function mock(
      this: HTMLAnchorElement,
    ) {
      clicked.push({ download: this.download, href: this.href });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a blob, triggers a download and cleans up afterwards', () => {
    vi.useFakeTimers();
    try {
      expect(downloadText('report.json', '{"a":1}')).toBe(true);

      expect(createObjectURL).toHaveBeenCalledOnce();
      const blob = createObjectURL.mock.calls[0]?.[0];
      expect(blob?.type).toBe('application/json');
      expect(clicked).toHaveLength(1);
      expect(clicked[0]?.download).toBe('report.json');

      // The anchor must not be left behind in the document.
      expect(document.querySelectorAll('a')).toHaveLength(0);

      // The object URL is only revoked after the browser has had time to read it.
      expect(revokeObjectURL).not.toHaveBeenCalled();
      vi.advanceTimersByTime(10_000);
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake');
    } finally {
      vi.useRealTimers();
    }
  });

  it('honours a custom MIME type', () => {
    downloadText('notes.txt', 'hello', 'text/plain');
    const blob = createObjectURL.mock.calls[0]?.[0];
    expect(blob?.type).toBe('text/plain');
  });

  it('reports failure instead of throwing', () => {
    URL.createObjectURL = () => {
      throw new Error('blob URL refused');
    };

    const { result, logs } = logsFrom(() => downloadText('report.json', '{}'));

    expect(result).toBe(false);
    expect(logs[0]?.message).toContain('could not download report');
  });
});

describe('download helpers', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:fake');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('downloadReport names the file after the report', () => {
    const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click');
    expect(downloadReport(report())).toBe(true);
    expect(spy).toHaveBeenCalledOnce();
  });

  it('downloadReports uses the caller-supplied bundle name', () => {
    expect(downloadReports([report()], 'bundle.json')).toBe(true);
  });
});

describe('copyText', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the clipboard API when it is available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    await expect(copyText('hello')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('falls back to a hidden textarea when the clipboard API is missing', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });

    await expect(copyText('fallback text')).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
    // The scratch textarea must not be left in the document.
    expect(document.querySelectorAll('textarea')).toHaveLength(0);
  });

  it('falls back when the clipboard API rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('not focused'));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });

    await expect(copyText('hello')).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalled();
  });

  it('reports failure when every path fails', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: () => {
        throw new Error('copy refused');
      },
    });

    const { result, logs } = await logsFromAsync(async () => copyText('hello'));

    expect(result).toBe(false);
    expect(logs[0]?.message).toContain('could not copy report');
  });

  it('copyReport copies the report JSON', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

    await expect(copyReport(report('copied failure'))).resolves.toBe(true);
    const copied = writeText.mock.calls[0]?.[0] as string;
    expect(JSON.parse(copied).error.message).toBe('copied failure');
  });
});
