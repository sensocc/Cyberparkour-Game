/**
 * Screens: start, pause, ended, crash - and the recovered-report banner.
 *
 * Every screen is a real DOM node with real `<button>`s, so the demo is
 * keyboard-navigable and testable in jsdom. Nothing here reaches into the game
 * directly; the game supplies callbacks.
 */

import type { CrashReport } from '../diagnostics/crashReport.js';
import { summarizeReport } from '../diagnostics/crashReport.js';
import { button, el, formatNumber, setHidden } from './dom.js';

export interface UiCallbacks {
  /** Begin playing (also the pointer-lock request, so it must be a gesture). */
  readonly onStart: () => void;
  readonly onResume: () => void;
  readonly onRestart: () => void;
  /** Return the player to their spawn point without restarting the session. */
  readonly onRespawn: () => void;
  readonly onQuit: () => void;
  readonly onDownloadReport: (report: CrashReport) => void;
  readonly onCopyReport: (report: CrashReport) => void;
  readonly onDownloadRecovered: () => void;
}

export interface GameUiOptions {
  readonly root: HTMLElement;
  readonly version: string;
  readonly levelName: string;
  readonly callbacks: UiCallbacks;
}

const CONTROLS: readonly [string, string][] = [
  ['W A S D', 'Move'],
  ['Mouse', 'Look'],
  ['Shift', 'Sprint'],
  ['Space', 'Jump'],
  ['Ctrl / C', 'Crouch'],
  ['F3', 'Toggle debug info'],
  ['Esc', 'Pause'],
  ['R', 'Restart'],
];

export class GameUi {
  readonly root: HTMLElement;
  private readonly callbacks: UiCallbacks;
  private readonly startScreen: HTMLElement;
  private readonly pauseScreen: HTMLElement;
  private readonly endedScreen: HTMLElement;
  private readonly crashScreen: HTMLElement;
  private readonly crosshair: HTMLElement;
  private readonly deathOverlay: HTMLElement;
  private readonly deathTitle: HTMLElement;
  private readonly deathDetail: HTMLElement;
  private readonly crashTitle: HTMLElement;
  private readonly crashMeta: HTMLElement;
  private readonly crashStack: HTMLElement;
  private readonly recoveredBanner: HTMLElement;
  private readonly noticeBox: HTMLElement;
  private currentReport: CrashReport | null = null;
  /** True while the presentation is "playing", so the crosshair can come back. */
  private playMode = false;

  constructor(options: GameUiOptions) {
    this.callbacks = options.callbacks;
    this.root = options.root;
    this.root.classList.add('ui');

    // ------------------------------------------------------------------ start
    this.recoveredBanner = el('div', { className: 'notice notice--recovered' });
    setHidden(this.recoveredBanner, true);

    this.startScreen = this.buildScreen('screen--start', [
      el('p', { className: 'title__eyebrow', text: 'CYBERPARKOUR' }),
      el('h1', { className: 'title__heading', text: 'Technical Demo' }),
      el('p', { className: 'title__version', text: `v${options.version} \u00b7 ${options.levelName}` }),
      el('p', {
        className: 'title__blurb',
        text: 'A first-person parkour run across a cyberpunk rooftop. This build is the V0.0 technical demo: rendering, camera, movement, collision and diagnostics.',
      }),
      button('Start session', {
        className: 'btn btn--primary',
        onClick: () => this.callbacks.onStart(),
      }),
      this.buildControls(),
      this.recoveredBanner,
      el('p', { className: 'title__hint', text: 'Click the window, then press Esc to pause.' }),
    ]);

    // ------------------------------------------------------------------ pause
    this.pauseScreen = this.buildScreen('screen--pause', [
      el('h2', { className: 'screen__heading', text: 'PAUSED' }),
      el('p', { className: 'screen__sub', text: 'Mouse look is released while paused.' }),
      button('Resume', { className: 'btn btn--primary', onClick: () => this.callbacks.onResume() }),
      button('Respawn', {
        title: 'Return to the spawn point without restarting',
        onClick: () => this.callbacks.onRespawn(),
      }),
      button('Restart', { onClick: () => this.callbacks.onRestart() }),
      button('Quit demo', { className: 'btn btn--danger', onClick: () => this.callbacks.onQuit() }),
      this.buildControls(),
    ]);

    // ------------------------------------------------------------------ ended
    this.endedScreen = this.buildScreen('screen--ended', [
      el('h2', { className: 'screen__heading', text: 'SESSION ENDED' }),
      el('p', {
        className: 'screen__sub',
        text: 'The renderer and the game loop have been shut down and their resources released.',
      }),
      el('p', {
        className: 'screen__sub',
        text: 'Your browser may block us from closing the tab: if it stays open, close it yourself.',
      }),
      button('Start a new session', {
        className: 'btn btn--primary',
        onClick: () => this.callbacks.onRestart(),
      }),
    ]);

    // ------------------------------------------------------------------ crash
    this.crashTitle = el('h2', { className: 'screen__heading screen__heading--error' });
    this.crashMeta = el('dl', { className: 'crash__meta' });
    this.crashStack = el('pre', { className: 'crash__stack' });

    this.crashScreen = this.buildScreen('screen--crash', [
      this.crashTitle,
      el('p', {
        className: 'screen__sub',
        text: 'A crash report has been written automatically. Download or copy it to help diagnose the problem.',
      }),
      this.crashMeta,
      this.crashStack,
      button('Download report (.json)', {
        className: 'btn btn--primary',
        onClick: () => {
          if (this.currentReport) this.callbacks.onDownloadReport(this.currentReport);
        },
      }),
      button('Copy report', {
        onClick: () => {
          if (this.currentReport) this.callbacks.onCopyReport(this.currentReport);
        },
      }),
      button('Restart demo', { onClick: () => this.callbacks.onRestart() }),
      button('Quit demo', { className: 'btn btn--danger', onClick: () => this.callbacks.onQuit() }),
    ]);

    this.noticeBox = el('div', { className: 'notice notice--toast' });
    setHidden(this.noticeBox, true);

    this.crosshair = el('div', { className: 'crosshair', attrs: { 'aria-hidden': 'true' } });
    setHidden(this.crosshair, true);

    // The death overlay is not a screen: it appears *during* play, over the
    // scene, and the game keeps running underneath it.
    this.deathTitle = el('h2', { className: 'death__title', text: 'YOU FELL' });
    this.deathDetail = el('p', { className: 'death__detail' });

    const deathPanel = el('div', { className: 'death__panel' });
    deathPanel.append(this.deathTitle, this.deathDetail);

    this.deathOverlay = el('div', {
      className: 'death',
      attrs: { role: 'status', 'aria-live': 'polite' },
    });
    this.deathOverlay.append(deathPanel);
    setHidden(this.deathOverlay, true);

    this.root.append(
      this.crosshair,
      this.deathOverlay,
      this.startScreen,
      this.pauseScreen,
      this.endedScreen,
      this.crashScreen,
      this.noticeBox,
    );

    this.showStart();
  }

  // -------------------------------------------------------------- visibility

  showStart(): void {
    this.playMode = false;
    this.setActive(this.startScreen);
    this.setCrosshair(false);
    this.hideDeath();
  }

  showPause(): void {
    this.playMode = false;
    this.setActive(this.pauseScreen);
    this.setCrosshair(false);
  }

  showEnded(): void {
    this.playMode = false;
    this.setActive(this.endedScreen);
    this.setCrosshair(false);
  }

  /** Hides every screen: the game is running. */
  showGame(): void {
    this.playMode = true;
    this.setActive(null);
    this.setCrosshair(true);
    this.hideDeath();
  }

  /** Shows the "you died" overlay while the respawn timer runs. */
  showDeath(title: string, detail: string): void {
    this.deathTitle.textContent = title;
    this.deathDetail.textContent = detail;
    setHidden(this.deathOverlay, false);
    this.setCrosshair(false);
  }

  hideDeath(): void {
    setHidden(this.deathOverlay, true);
    if (this.playMode) this.setCrosshair(true);
  }

  get isDeathVisible(): boolean {
    return !this.deathOverlay.hasAttribute('hidden');
  }

  showCrash(report: CrashReport): void {
    this.currentReport = report;

    this.crashTitle.textContent = summarizeReport(report);
    this.crashStack.textContent = report.error.stack ?? report.error.message;

    this.crashMeta.replaceChildren(
      ...metaRow('source', report.source),
      ...metaRow('severity', report.severity),
      ...metaRow('version', report.version),
      ...metaRow('occurrences', String(report.occurrences)),
      ...metaRow('fingerprint', report.fingerprint),
      ...metaRow('captured', report.timestamp),
      ...metaRow('level', report.game.levelId ?? 'unknown'),
      ...metaRow('frames', `${report.game.frameCount} in ${formatNumber(report.game.elapsedSeconds, 1)} s`),
      ...metaRow('gpu', report.environment.renderer ?? 'unknown'),
    );

    this.playMode = false;
    this.setActive(this.crashScreen);
    this.setCrosshair(false);
  }

  /** Number of crash reports recovered from a previous session. */
  setRecoveredReports(reports: readonly CrashReport[]): void {
    const count = reports.length;
    setHidden(this.recoveredBanner, count === 0);
    if (count === 0) return;

    const latest = reports[count - 1];
    this.recoveredBanner.replaceChildren(
      el('strong', {
        text: `${count} crash report${count === 1 ? '' : 's'} saved from an earlier session.`,
      }),
      el('span', {
        text: latest === undefined ? '' : ` Most recent: ${summarizeReport(latest)}`,
      }),
      button('Download them', {
        className: 'btn btn--small',
        onClick: () => this.callbacks.onDownloadRecovered(),
      }),
    );
  }

  /** Transient message, e.g. "report copied". */
  toast(message: string, durationMs = 3000): void {
    this.noticeBox.textContent = message;
    setHidden(this.noticeBox, false);

    const previous = this.toastHandle;
    if (previous !== null) window.clearTimeout(previous);
    this.toastHandle = window.setTimeout(() => {
      setHidden(this.noticeBox, true);
      this.toastHandle = null;
    }, durationMs);
  }

  private toastHandle: number | null = null;

  get crashReport(): CrashReport | null {
    return this.currentReport;
  }

  destroy(): void {
    if (this.toastHandle !== null) window.clearTimeout(this.toastHandle);
    this.toastHandle = null;
    this.root.replaceChildren();
  }

  // ------------------------------------------------------------------ private

  private setActive(screen: HTMLElement | null): void {
    for (const candidate of [this.startScreen, this.pauseScreen, this.endedScreen, this.crashScreen]) {
      setHidden(candidate, candidate !== screen);
    }
  }


  private setCrosshair(visible: boolean): void {
    setHidden(this.crosshair, !visible);
  }

  private buildScreen(modifier: string, children: readonly HTMLElement[]): HTMLElement {
    const screen = el('div', { className: `screen ${modifier}` });
    const panel = el('div', { className: 'panel' });
    panel.append(...children);
    screen.append(panel);
    return screen;
  }

  private buildControls(): HTMLElement {
    const list = el('dl', { className: 'controls' });
    for (const [keys, description] of CONTROLS) {
      list.append(
        el('dt', { className: 'controls__keys', text: keys }),
        el('dd', { className: 'controls__action', text: description }),
      );
    }
    return list;
  }
}

function metaRow(label: string, value: string): [HTMLElement, HTMLElement] {
  return [
    el('dt', { className: 'crash__meta-label', text: label }),
    el('dd', { className: 'crash__meta-value', text: value }),
  ];
}
