/**
 * Screens: start, pause, ended, crash - and the recovered-report banner.
 *
 * Every screen is a real DOM node with real `<button>`s, so the demo is
 * keyboard-navigable and testable in jsdom. Nothing here reaches into the game
 * directly; the game supplies callbacks.
 */

import type { CrashReport } from '../diagnostics/crashReport.js';
import { summarizeReport } from '../diagnostics/crashReport.js';
import type { GameSettings } from '../core/settings.js';
import { formatRunTime, type RunResult } from '../game/run.js';
import { button, el, formatNumber, setHidden } from './dom.js';
import { describePickups } from './gameHud.js';
import { SettingsPanel } from './settingsScreen.js';

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
  /** Applies a settings change. The screen redraws from the result, not the patch. */
  readonly onSettingsChange: (patch: Partial<GameSettings>) => void;
  readonly onSettingsReset: () => void;
}

export interface GameUiOptions {
  readonly root: HTMLElement;
  readonly version: string;
  readonly levelName: string;
  /** The settings in force, drawn on the settings screen. */
  readonly settings: GameSettings;
  readonly callbacks: UiCallbacks;
}

/** What the demo is, in one sentence per entry, for the About panel. */
export const ABOUT_LINES: readonly string[] = [
  'A low-poly first-person parkour run across a cyberpunk rooftop district.',
  'Nine roofs on two levels, crossed by mantling, pull-ups, climbing, vaulting, wall running, pipe climbing and well-timed landings — and joined by two lifts, so the district is a loop rather than a line.',
  'Two of the roofs have machine rooms you can walk into, lit from the inside and behind a door you open yourself, and the signage across them glows.',
  'Eight pickups are scattered along the route, including a few that need the abilities rather than a straight line. Reach the finish with every checkpoint behind you to complete the run — the clock is on the screen, and the record is kept.',
  'You have a body: look down and you will see your own chest, arms and legs, and the sun casts your shadow onto the roof.',
  'Every key, the mouse sensitivity, the field of view, the graphics preset, the volume and how much the camera moves can all be changed in Settings, and they are remembered between sessions.',
];

const CONTROLS: readonly [string, string][] = [
  ['W A S D', 'Move'],
  ['Mouse', 'Look'],
  ['Shift', 'Sprint'],
  ['Space', 'Jump · pull up from a hang · kick off a wall · kick off a pipe'],
  ['Ctrl / C', 'Crouch · slide at speed · roll on a hard landing'],
  ['W into a ledge', 'Mantle; keep running into a waist-high rail to vault it'],
  ['Sprint at a rail', 'Kong vault — a diving vault that keeps its speed'],
  ['Aim along a wall', 'Wall run; chain two facing walls to climb'],
  ['W into a pipe', 'Climb it; C or S slides down it, faster than climbing'],
  ['E at a door', 'Open or close it'],
  ['F3', 'Toggle the debug overlay (off by default)'],
  ['M', 'Mute'],
  ['Esc', 'Pause'],
  ['R', 'Restart'],
];

/** One labelled figure on the results screen. */
function completeRow(label: string, value: string): HTMLElement {
  const row = el('div', { className: 'complete__metaRow' });
  row.append(el('span', { className: 'complete__metaLabel', text: label }));
  row.append(el('span', { className: 'complete__metaValue', text: value }));
  return row;
}

export class GameUi {
  readonly root: HTMLElement;
  private readonly callbacks: UiCallbacks;
  private readonly startScreen: HTMLElement;
  private readonly menuScreen: HTMLElement;
  private readonly aboutScreen: HTMLElement;
  private readonly pauseScreen: HTMLElement;
  private readonly endedScreen: HTMLElement;
  private readonly completeScreen: HTMLElement;
  private readonly completeHeading: HTMLElement;
  private readonly completeTime: HTMLElement;
  private readonly completeBest: HTMLElement;
  private readonly completeMeta: HTMLElement;
  private readonly completeSplits: HTMLElement;
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
  /** The one screen with inputs; it owns its own DOM and reports patches upward. */
  private readonly settingsPanel: SettingsPanel;
  private currentReport: CrashReport | null = null;
  /** True while the presentation is "playing", so the crosshair can come back. */
  private playMode = false;

  constructor(options: GameUiOptions) {
    this.callbacks = options.callbacks;
    this.root = options.root;
    this.root.classList.add('ui');

    this.settingsPanel = new SettingsPanel({
      onChange: (patch) => this.callbacks.onSettingsChange(patch),
      onReset: () => this.callbacks.onSettingsReset(),
      onBack: () => this.goBack(),
    });
    this.settingsPanel.update(options.settings);
    this.root.append(this.settingsPanel.element);
    setHidden(this.settingsPanel.element, true);

    // ------------------------------------------------------------------ start
    this.recoveredBanner = el('div', { className: 'notice notice--recovered' });
    setHidden(this.recoveredBanner, true);

    this.startScreen = this.buildScreen('screen--start', [
      el('p', { className: 'title__eyebrow', text: 'CYBERPARKOUR' }),
      el('h1', { className: 'title__heading', text: 'Technical Demo' }),
      el('p', { className: 'title__version', text: `v${options.version} \u00b7 ${options.levelName}` }),
      el('p', {
        className: 'title__blurb',
        text: 'A first-person parkour run across a cyberpunk rooftop district. This build is the V0.6 technical demo: a complete district on two levels, joined by lifts, with pickups, a finish line and a clock on the wall — and a body of your own, settings you keep, and a camera that answers the running.',
      }),
      this.menu([
        button('Play', {
          className: 'btn btn--primary',
          onClick: () => this.callbacks.onStart(),
        }),
        button('Settings', { onClick: () => this.showSettings() }),
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
        button('Settings', { onClick: () => this.showSettings() }),
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

    // --------------------------------------------------------------- complete
    // The results screen. Its numbers are filled in by `showComplete`, because a
    // finished run is the only thing that can produce them.
    this.completeHeading = el('h2', { className: 'screen__heading screen__heading--good', text: 'RUN COMPLETE' });
    this.completeTime = el('p', { className: 'complete__time', text: '-:--.--' });
    this.completeBest = el('p', { className: 'complete__best' });
    this.completeMeta = el('div', { className: 'complete__meta' });
    this.completeSplits = el('ol', { className: 'complete__splits' });

    this.completeScreen = this.buildScreen('screen--complete', [
      this.completeHeading,
      this.completeTime,
      this.completeBest,
      this.completeMeta,
      this.completeSplits,
      this.menu([
        button('Run it again', {
          className: 'btn btn--primary',
          onClick: () => this.callbacks.onRestart(),
        }),
        button('Main menu', { onClick: () => this.callbacks.onMainMenu() }),
      ]),
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
      this.completeScreen,
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

  /**
   * The settings screen, reachable from the title screen and the pause menu.
   *
   * While it is open the game is *not* playing: from the title screen there is no
   * run yet, and from the pause menu the run is paused. That is what makes it safe
   * for the screen to capture keystrokes for rebinding.
   */
  showSettings(): void {
    this.playMode = false;
    this.returnTo = this.active;
    this.setActive(this.settingsPanel.element);
    this.setCrosshair(false);
  }

  /** Redraws the settings screen from the settings now in force. */
  setSettings(settings: GameSettings): void {
    this.settingsPanel.update(settings);
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

  /**
   * Shows the results of a finished run.
   *
   * Everything on the screen comes from the one summary, and the copy changes
   * with it: a run that beat the record says so, and a run that did not still
   * says what the record is.
   */
  showComplete(summary: RunResult): void {
    this.playMode = false;

    this.completeHeading.textContent = 'RUN COMPLETE';
    this.completeTime.textContent = formatRunTime(summary.seconds);
    this.completeBest.textContent = summary.improved
      ? 'NEW BEST'
      : `BEST ${formatRunTime(summary.bestSeconds)}`;
    this.completeBest.dataset.improved = String(summary.improved);

    this.completeMeta.replaceChildren(
      completeRow('Pickups', describePickups(summary.collected, summary.collectibleCount)),
      completeRow('Checkpoints', `${summary.splits.length}`),
    );

    this.completeSplits.replaceChildren(
      ...summary.splits.map((split) =>
        el('li', {
          className: 'complete__split',
          text: `CP${split.checkpoint + 1}  ${formatRunTime(split.seconds)}`,
        }),
      ),
    );

    this.setActive(this.completeScreen);
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
      this.completeScreen,
      this.crashScreen,
      this.settingsPanel.element,
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
