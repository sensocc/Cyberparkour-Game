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
  /** Leave the session and go back to the title screen. */
  readonly onMainMenu: () => void;
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

/** What the demo is, in one sentence per entry, for the About panel. */
export const ABOUT_LINES: readonly string[] = [
  'A low-poly first-person parkour run across a cyberpunk rooftop district.',
  'Five furnished roofs, six metres apart horizontally and up to four apart vertically, crossed by mantling, pull-ups, climbing, vaulting, wall running and well-timed landings.',
  'Fall and you go back to the last checkpoint you reached — not to the start.',
];

const CONTROLS: readonly [string, string][] = [
  ['W A S D', 'Move'],
  ['Mouse', 'Look'],
  ['Shift', 'Sprint'],
  ['Space', 'Jump · pull up from a hang · kick off a wall'],
  ['Ctrl / C', 'Crouch · slide at speed · roll on a hard landing'],
  ['W into a ledge', 'Mantle; keep running into a waist-high rail to vault it'],
  ['Sprint at a rail', 'Kong vault — a diving vault that keeps its speed'],
  ['Aim along a wall', 'Wall run; chain two facing walls to climb'],
  ['F3', 'Toggle debug info'],
  ['M', 'Mute'],
  ['Esc', 'Pause'],
  ['R', 'Restart'],
];

export class GameUi {
  readonly root: HTMLElement;
  private readonly callbacks: UiCallbacks;
  private readonly startScreen: HTMLElement;
  private readonly menuScreen: HTMLElement;
  private readonly aboutScreen: HTMLElement;
  private readonly pauseScreen: HTMLElement;
  private readonly endedScreen: HTMLElement;
  private readonly crashScreen: HTMLElement;
  private readonly crosshair: HTMLElement;
  private readonly deathOverlay: HTMLElement;
  private readonly damageFlash: HTMLElement;
  private flashHandle: number | null = null;
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
        text: 'A first-person parkour run across a cyberpunk rooftop district. This build is the V0.3 technical demo: vertical rooftops, gaps between buildings, and the moves that cross them.',
      }),
      this.menu([
        button('Play', {
          className: 'btn btn--primary',
          onClick: () => this.callbacks.onStart(),
        }),
        button('Controls', { onClick: () => this.showControls() }),
        button('About', { onClick: () => this.showAbout() }),
      ]),
      this.recoveredBanner,
      el('p', { className: 'title__hint', text: 'Click the window to lock the mouse, then press Esc to pause.' }),
    ]);

    this.menuScreen = this.buildScreen('screen--menu', [
      el('h2', { className: 'screen__heading', text: 'CONTROLS' }),
      el('p', {
        className: 'screen__sub',
        text: 'The manoeuvres engage from the movement itself, so there is no key to learn for them.',
      }),
      this.buildControls(),
      button('Back', { className: 'btn btn--primary', onClick: () => this.goBack() }),
    ]);

    // ------------------------------------------------------------------ pause
    this.pauseScreen = this.buildScreen('screen--pause', [
      el('h2', { className: 'screen__heading', text: 'PAUSED' }),
      el('p', { className: 'screen__sub', text: 'Mouse look is released while paused.' }),
      this.menu([
        button('Resume', { className: 'btn btn--primary', onClick: () => this.callbacks.onResume() }),
        button('Respawn', {
          title: 'Go back to the last checkpoint without restarting',
          onClick: () => this.callbacks.onRespawn(),
        }),
        button('Controls', { onClick: () => this.showControls() }),
        button('Restart run', {
          title: 'Start the route again from the beginning',
          onClick: () => this.callbacks.onRestart(),
        }),
        button('Main menu', { onClick: () => this.callbacks.onMainMenu() }),
        button('Quit demo', { className: 'btn btn--danger', onClick: () => this.callbacks.onQuit() }),
      ]),
    ]);

    // ------------------------------------------------------------------ about
    this.aboutScreen = this.buildScreen('screen--about', [
      el('h2', { className: 'screen__heading', text: 'ABOUT' }),
      ...ABOUT_LINES.map((line) => el('p', { className: 'screen__sub', text: line })),
      el('p', { className: 'title__version', text: `v${options.version} \u00b7 ${options.levelName}` }),
      button('Back', { className: 'btn btn--primary', onClick: () => this.goBack() }),
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

    // A brief red vignette on impact: fall damage needs feedback *at the moment
    // of the hit*, which a persistent bar cannot give. The health bar proper
    // lives in the play HUD (`ui/gameHud.ts`).
    this.damageFlash = el('div', { className: 'damage-flash', attrs: { 'aria-hidden': 'true' } });
    setHidden(this.damageFlash, true);

    this.root.append(
      this.crosshair,
      this.damageFlash,
      this.deathOverlay,
      this.startScreen,
      this.menuScreen,
      this.aboutScreen,
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

  /** The controls list, reachable from both the title screen and the pause menu. */
  showControls(): void {
    this.playMode = false;
    this.returnTo = this.active;
    this.setActive(this.menuScreen);
    this.setCrosshair(false);
  }

  /** What this build is, reachable from the title screen. */
  showAbout(): void {
    this.playMode = false;
    this.returnTo = this.active;
    this.setActive(this.aboutScreen);
    this.setCrosshair(false);
  }

  /** Which screen a Back button returns to. */
  private returnTo: HTMLElement | null = null;
  private active: HTMLElement | null = null;

  goBack(): void {
    const target = this.returnTo ?? this.startScreen;
    this.returnTo = null;
    if (target === this.pauseScreen) this.showPause();
    else this.showStart();
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

  /**
   * Flashes the screen for a hard landing.
   *
   * The opacity scales with the damage, so a scrape and a near-fatal drop do not
   * look the same.
   */
  flashDamage(damage: number, peak = 0.55): void {
    const strength = Math.max(0.12, Math.min(1, damage / 60)) * peak;
    this.damageFlash.style.setProperty('--damage-strength', String(strength));
    setHidden(this.damageFlash, false);

    if (this.flashHandle !== null) window.clearTimeout(this.flashHandle);
    this.flashHandle = window.setTimeout(() => {
      setHidden(this.damageFlash, true);
      this.flashHandle = null;
    }, 260);
  }

  get isDamageFlashVisible(): boolean {
    return !this.damageFlash.hasAttribute('hidden');
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
    if (this.flashHandle !== null) window.clearTimeout(this.flashHandle);
    this.flashHandle = null;
    this.root.replaceChildren();
  }

  // ------------------------------------------------------------------ private

  private setActive(screen: HTMLElement | null): void {
    this.active = screen;
    for (const candidate of [
      this.startScreen,
      this.menuScreen,
      this.aboutScreen,
      this.pauseScreen,
      this.endedScreen,
      this.crashScreen,
    ]) {
      setHidden(candidate, candidate !== screen);
    }
  }

  /** A vertical list of menu buttons. */
  private menu(entries: readonly HTMLElement[]): HTMLElement {
    const list = el('div', { className: 'menu' });
    list.append(...entries);
    return list;
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
