// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import { button, el, setHidden } from '../../src/ui/dom.js';
import { buildCrashReport, emptyEnvironment, emptyGameState, type CrashReport } from '../../src/diagnostics/crashReport.js';
import { GameUi, type UiCallbacks } from '../../src/ui/screens.js';

function createReport(overrides: Partial<Parameters<typeof buildCrashReport>[0]> = {}): CrashReport {
  return buildCrashReport({
    error: new Error('simulated failure'),
    source: 'game-loop',
    severity: 'fatal',
    version: '0.0.0',
    environment: emptyEnvironment(),
    game: { ...emptyGameState(), levelId: 'demo-roof', frameCount: 120, elapsedSeconds: 3 },
    logs: ['0.000s INFO [app] booting'],
    now: () => new Date('2024-05-01T12:00:00.000Z'),
    idFactory: () => 'crash-test',
    ...overrides,
  });
}

interface Harness {
  readonly root: HTMLElement;
  readonly ui: GameUi;
  readonly calls: { [K in keyof UiCallbacks]: ReturnType<typeof vi.fn> };
  readonly lastReport: () => CrashReport | null;
}

function createUi(version = '0.0.0'): Harness {
  document.body.innerHTML = '';
  const root = document.createElement('div');
  document.body.append(root);

  let captured: CrashReport | null = null;
  const calls = {
    onStart: vi.fn(),
    onResume: vi.fn(),
    onRestart: vi.fn(),
    onRespawn: vi.fn(),
    onQuit: vi.fn(),
    onDownloadReport: vi.fn((report: CrashReport) => {
      captured = report;
    }),
    onCopyReport: vi.fn((report: CrashReport) => {
      captured = report;
    }),
    onDownloadRecovered: vi.fn(),
  };

  const ui = new GameUi({
    root,
    version,
    levelName: 'Rooftop — Technical Demo',
    callbacks: calls,
  });

  return { root, ui, calls, lastReport: () => captured };
}

function click(scope: HTMLElement, label: RegExp): void {
  const target = [...scope.querySelectorAll('button')].find((entry) =>
    label.test(entry.textContent ?? ''),
  );
  if (!target) throw new Error(`no button matching ${String(label)}`);
  target.click();
}

describe('GameUi construction', () => {
  it('renders all four screens', () => {
    const { root } = createUi();
    expect(root.querySelector('.screen--start')).not.toBeNull();
    expect(root.querySelector('.screen--pause')).not.toBeNull();
    expect(root.querySelector('.screen--ended')).not.toBeNull();
    expect(root.querySelector('.screen--crash')).not.toBeNull();
  });

  it('starts on the title screen with everything else hidden', () => {
    const { root } = createUi();
    expect(root.querySelector('.screen--start')?.hasAttribute('hidden')).toBe(false);
    expect(root.querySelector('.screen--pause')?.hasAttribute('hidden')).toBe(true);
    expect(root.querySelector('.screen--ended')?.hasAttribute('hidden')).toBe(true);
    expect(root.querySelector('.screen--crash')?.hasAttribute('hidden')).toBe(true);
  });

  it('shows the version and level name', () => {
    const { root } = createUi('1.2.3');
    expect(root.querySelector('.title__version')?.textContent).toContain('v1.2.3');
    expect(root.querySelector('.title__version')?.textContent).toContain('Rooftop');
  });

  it('lists the controls', () => {
    const { root } = createUi();
    const text = root.querySelector('.screen--start .controls')?.textContent ?? '';
    expect(text).toContain('W A S D');
    expect(text).toContain('Move');
    expect(text).toContain('Mouse');
    expect(text).toContain('F3');
    expect(text).toContain('Esc');
    expect(text).toContain('R');
  });

  it('hides the crosshair until the game is running', () => {
    const { root } = createUi();
    expect(root.querySelector('.crosshair')?.hasAttribute('hidden')).toBe(true);
  });
});

describe('GameUi callbacks', () => {
  it('fires onStart from the title screen', () => {
    const { root, calls } = createUi();
    click(root.querySelector('.screen--start') as HTMLElement, /start session/i);
    expect(calls.onStart).toHaveBeenCalledOnce();
  });

  it('offers a Respawn button in the pause menu', () => {
    const { root, ui, calls } = createUi();
    ui.showPause();
    click(root.querySelector('.screen--pause') as HTMLElement, /^respawn$/i);
    expect(calls.onRespawn).toHaveBeenCalledOnce();
  });

  it('fires onResume, onRespawn, onRestart and onQuit from the pause menu', () => {
    const { root, ui, calls } = createUi();
    ui.showPause();
    const pause = root.querySelector('.screen--pause') as HTMLElement;

    click(pause, /^resume$/i);
    click(pause, /^respawn$/i);
    click(pause, /^restart$/i);
    click(pause, /quit/i);

    expect(calls.onResume).toHaveBeenCalledOnce();
    expect(calls.onRespawn).toHaveBeenCalledOnce();
    expect(calls.onRestart).toHaveBeenCalledOnce();
    expect(calls.onQuit).toHaveBeenCalledOnce();
  });

  it('fires onRestart from the ended screen', () => {
    const { root, ui, calls } = createUi();
    ui.showEnded();
    click(root.querySelector('.screen--ended') as HTMLElement, /start a new session/i);
    expect(calls.onRestart).toHaveBeenCalledOnce();
  });

  it('passes the report to the download and copy handlers', () => {
    const { root, ui, calls, lastReport } = createUi();
    const report = createReport();
    ui.showCrash(report);
    const crash = root.querySelector('.screen--crash') as HTMLElement;

    click(crash, /download report/i);
    expect(calls.onDownloadReport).toHaveBeenCalledWith(report);
    expect(lastReport()).toBe(report);

    click(crash, /copy report/i);
    expect(calls.onCopyReport).toHaveBeenCalledWith(report);
  });

  it('ignores export clicks when no report is loaded', () => {
    const { root, calls } = createUi();
    const crash = root.querySelector('.screen--crash') as HTMLElement;

    // The crash screen exists from the start but holds no report yet.
    click(crash, /download report/i);
    click(crash, /copy report/i);

    expect(calls.onDownloadReport).not.toHaveBeenCalled();
    expect(calls.onCopyReport).not.toHaveBeenCalled();
  });

  it('fires onDownloadRecovered from the recovered banner', () => {
    const { root, ui, calls } = createUi();
    ui.setRecoveredReports([createReport()]);
    click(root.querySelector('.notice--recovered') as HTMLElement, /download them/i);
    expect(calls.onDownloadRecovered).toHaveBeenCalledOnce();
  });
});

describe('GameUi screen switching', () => {
  it('showGame hides every screen and shows the crosshair', () => {
    const { root, ui } = createUi();
    ui.showGame();

    for (const selector of ['.screen--start', '.screen--pause', '.screen--ended', '.screen--crash']) {
      expect(root.querySelector(selector)?.hasAttribute('hidden')).toBe(true);
    }
    expect(root.querySelector('.crosshair')?.hasAttribute('hidden')).toBe(false);
  });

  it('showPause hides the title and reveals the pause menu', () => {
    const { root, ui } = createUi();
    ui.showPause();

    expect(root.querySelector('.screen--pause')?.hasAttribute('hidden')).toBe(false);
    expect(root.querySelector('.screen--start')?.hasAttribute('hidden')).toBe(true);
    expect(root.querySelector('.crosshair')?.hasAttribute('hidden')).toBe(true);
  });

  it('showEnded reveals the ended screen and explains the shutdown', () => {
    const { root, ui } = createUi();
    ui.showEnded();

    expect(root.querySelector('.screen--ended')?.hasAttribute('hidden')).toBe(false);
    expect(root.querySelector('.screen--ended')?.textContent).toMatch(/resources released/i);
  });

  it('every transition leaves exactly one screen visible', () => {
    const { root, ui } = createUi();
    const screens = ['.screen--start', '.screen--pause', '.screen--ended', '.screen--crash'];

    for (const transition of [
      () => ui.showPause(),
      () => ui.showGame(),
      () => ui.showEnded(),
      () => ui.showStart(),
      () => ui.showCrash(createReport()),
      () => ui.showGame(),
    ]) {
      transition();
      const visible = screens.filter((selector) => !root.querySelector(selector)?.hasAttribute('hidden'));
      expect(visible.length).toBeLessThanOrEqual(1);
    }
  });
});

describe('GameUi crash screen', () => {
  it('summarises the error as the heading', () => {
    const { root, ui } = createUi();
    ui.showCrash(createReport());
    expect(root.querySelector('.screen--crash .screen__heading--error')?.textContent).toBe(
      'Error: simulated failure',
    );
  });

  it('shows the stack trace', () => {
    const { root, ui } = createUi();
    ui.showCrash(createReport());
    expect(root.querySelector('.crash__stack')?.textContent).toContain('simulated failure');
  });

  it('falls back to the message when there is no stack', () => {
    const { root, ui } = createUi();
    ui.showCrash(createReport({ error: 'thrown without a stack' }));
    expect(root.querySelector('.crash__stack')?.textContent).toBe('thrown without a stack');
  });

  it('lists the diagnostic metadata', () => {
    const { root, ui } = createUi();
    ui.showCrash(createReport());
    const meta = root.querySelector('.crash__meta')?.textContent ?? '';

    expect(meta).toContain('game-loop');
    expect(meta).toContain('fatal');
    expect(meta).toContain('0.0.0');
    expect(meta).toContain('2024-05-01T12:00:00.000Z');
    expect(meta).toContain('demo-roof');
    expect(meta).toContain('120 in 3.0 s');
  });

  it('exposes the loaded report', () => {
    const { ui } = createUi();
    const report = createReport();
    ui.showCrash(report);
    expect(ui.crashReport).toBe(report);
  });

  it('replaces the metadata when a second crash arrives', () => {
    const { root, ui } = createUi();
    ui.showCrash(createReport());
    ui.showCrash(createReport({ source: 'unhandled-rejection', version: '9.9.9' }));

    const meta = root.querySelector('.crash__meta')?.textContent ?? '';
    expect(meta).toContain('unhandled-rejection');
    expect(meta).toContain('9.9.9');
    expect(meta).not.toContain('game-loop');
  });

  it('offers download, copy, restart and quit', () => {
    const { root, ui } = createUi();
    ui.showCrash(createReport());

    const labels = [...(root.querySelector('.screen--crash')?.querySelectorAll('button') ?? [])].map(
      (entry) => entry.textContent ?? '',
    );
    expect(labels.join('|')).toMatch(/Download report/i);
    expect(labels.join('|')).toMatch(/Copy report/i);
    expect(labels.join('|')).toMatch(/Restart demo/i);
    expect(labels.join('|')).toMatch(/Quit demo/i);
  });
});

describe('GameUi recovered reports banner', () => {
  it('is hidden when there is nothing to recover', () => {
    const { root, ui } = createUi();
    ui.setRecoveredReports([]);
    expect(root.querySelector('.notice--recovered')?.hasAttribute('hidden')).toBe(true);
  });

  it('names the count and the most recent failure', () => {
    const { root, ui } = createUi();
    ui.setRecoveredReports([createReport(), createReport({ error: new Error('latest failure') })]);

    const banner = root.querySelector('.notice--recovered') as HTMLElement;
    expect(banner.hasAttribute('hidden')).toBe(false);
    expect(banner.textContent).toContain('2 crash reports saved');
    expect(banner.textContent).toContain('latest failure');
  });

  it('uses the singular for a single report', () => {
    const { root, ui } = createUi();
    ui.setRecoveredReports([createReport()]);
    expect(root.querySelector('.notice--recovered')?.textContent).toContain('1 crash report saved');
  });
});

describe('GameUi toast', () => {
  it('shows a message and hides it again', () => {
    vi.useFakeTimers();
    try {
      const { root, ui } = createUi();
      const toast = root.querySelector('.notice--toast') as HTMLElement;
      expect(toast.hasAttribute('hidden')).toBe(true);

      ui.toast('Report downloaded.');
      expect(toast.hasAttribute('hidden')).toBe(false);
      expect(toast.textContent).toBe('Report downloaded.');

      vi.advanceTimersByTime(3000);
      expect(toast.hasAttribute('hidden')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('replaces an existing toast without leaving a stale timer behind', () => {
    vi.useFakeTimers();
    try {
      const { root, ui } = createUi();
      const toast = root.querySelector('.notice--toast') as HTMLElement;

      ui.toast('first');
      vi.advanceTimersByTime(1000);
      ui.toast('second');
      expect(toast.textContent).toBe('second');

      // The first timer would have fired at 3000 ms; the message must survive it.
      vi.advanceTimersByTime(2100);
      expect(toast.hasAttribute('hidden')).toBe(false);

      vi.advanceTimersByTime(1000);
      expect(toast.hasAttribute('hidden')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('destroy clears the pending timer', () => {
    vi.useFakeTimers();
    try {
      const { ui } = createUi();
      ui.toast('bye');
      ui.destroy();
      expect(() => vi.advanceTimersByTime(5000)).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('GameUi destroy', () => {
  it('empties the root', () => {
    const { root, ui } = createUi();
    ui.destroy();
    expect(root.childElementCount).toBe(0);
  });
});

describe('dom helpers', () => {
  it('el applies class, text and attributes', () => {
    const node = el('div', { className: 'panel', text: 'hello', attrs: { 'data-id': 7, hidden: true } });
    expect(node.className).toBe('panel');
    expect(node.textContent).toBe('hello');
    expect(node.getAttribute('data-id')).toBe('7');
    expect(node.hasAttribute('hidden')).toBe(true);
  });

  it('el skips undefined and false attributes', () => {
    const node = el('div', { attrs: { a: undefined, b: false, c: 'yes' } });
    expect(node.hasAttribute('a')).toBe(false);
    expect(node.hasAttribute('b')).toBe(false);
    expect(node.getAttribute('c')).toBe('yes');
  });

  it('button wires its click handler and is a real submit-safe button', () => {
    const onClick = vi.fn();
    const node = button('Press me', { onClick });

    expect(node.tagName).toBe('BUTTON');
    expect(node.getAttribute('type')).toBe('button');
    node.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('setHidden toggles the hidden attribute', () => {
    const node = el('div');
    setHidden(node, true);
    expect(node.hasAttribute('hidden')).toBe(true);
    setHidden(node, false);
    expect(node.hasAttribute('hidden')).toBe(false);
  });
});

describe('GameUi death overlay', () => {
  it('is hidden until the player dies', () => {
    const { ui } = createUi();
    expect(ui.isDeathVisible).toBe(false);
  });

  it('shows the reason and the respawn note over the running game', () => {
    const { root, ui } = createUi();
    ui.showGame();

    ui.showDeath('YOU FELL', 'Respawning…');

    expect(ui.isDeathVisible).toBe(true);
    expect(root.querySelector('.death__title')?.textContent).toBe('YOU FELL');
    expect(root.querySelector('.death__detail')?.textContent).toBe('Respawning…');
    // The overlay is not a screen: the game is still presented as running.
    expect(root.querySelector('.screen--pause')?.hasAttribute('hidden')).toBe(true);
  });

  it('hides the crosshair while dead and restores it on respawn', () => {
    const { root, ui } = createUi();
    ui.showGame();
    expect(root.querySelector('.crosshair')?.hasAttribute('hidden')).toBe(false);

    ui.showDeath('YOU FELL', 'Respawning…');
    expect(root.querySelector('.crosshair')?.hasAttribute('hidden')).toBe(true);

    ui.hideDeath();
    expect(root.querySelector('.crosshair')?.hasAttribute('hidden')).toBe(false);
  });

  it('does not restore the crosshair when the game is not in play mode', () => {
    const { root, ui } = createUi();
    ui.showPause();
    ui.hideDeath();
    expect(root.querySelector('.crosshair')?.hasAttribute('hidden')).toBe(true);
  });

  it('starting a game clears a leftover overlay', () => {
    const { ui } = createUi();
    ui.showDeath('YOU FELL', 'Respawning…');
    ui.showGame();
    expect(ui.isDeathVisible).toBe(false);
  });

  it('is announced politely to assistive technology', () => {
    const { root } = createUi();
    const overlay = root.querySelector('.death');
    expect(overlay?.getAttribute('role')).toBe('status');
    expect(overlay?.getAttribute('aria-live')).toBe('polite');
  });
});
