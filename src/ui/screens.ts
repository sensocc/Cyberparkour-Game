/**
 * Screens: start, pause, ended, crash - and the recovered-report banner.
 *
 * Every screen is a real DOM node with real `<button>`s, so the demo is
 * keyboard-navigable and testable in jsdom. Nothing here reaches into the game
 * directly; the game supplies callbacks.
 */

import type { CrashReport } from '../diagnostics/crashReport.js';
import { summarizeReport } from '../diagnostics/crashReport.js';
import type { GameSettings, VolumeSettings } from '../core/settings.js';
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
  /**
   * A settings change from the panel, with the volumes partial.
   *
   * One volume slider should not have to restate the other two; the game merges what it is
   * handed. See `SettingsPanelCallbacks.onChange`.
   */
  readonly onSettingsChange: (
    patch: Partial<Omit<GameSettings, 'volumes'>> & { volumes?: Partial<VolumeSettings> },
  ) => void;
  readonly onSettingsReset: () => void;
}

export interface GameUiOptions {
  readonly root: HTMLElement;
  readonly version: string;
  /**
   * The level's name, shown on the title and About screens.
   *
   * Optional because the level is built *after* the UI in `main.ts` - the crash reporter has to
   * exist first, or a generator bug is a blank page with no report. `setLevelName` fills it in.
   */
  readonly levelName?: string;
  /** The settings in force, drawn on the settings screen. */
  readonly settings: GameSettings;
  readonly callbacks: UiCallbacks;
}

/** What the demo is, in one sentence per entry, for the About panel. */
export const ABOUT_LINES: readonly string[] = [
  'A low-poly first-person parkour run across a kilometre of generated cyberpunk city.',
  'Sixteen by sixteen blocks of buildings, courtyards and streets, thirty-five metres above the road — crossed by mantling, pull-ups, climbing, vaulting, wall running, pipe climbing and well-timed landings.',
  'Ninety lifts serve the towers, so the street is never a dead end: call one, pick a floor, and step out where you meant to be. Ladders, fire escapes and scaffolds do the same job for the patient.',
  'A courtyard cat wants ten shards. Find it first — nothing can be picked up until it has asked — then run the five checkpoints and bring them back to where the cat is sitting.',
  'Three time trials start at a gate and end at a gate, scored one to three stars. Somewhere there is also a phone, which is not one of the ten and is not on any list.',
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

/**
 * What the loading screen says while the first view is built.
 *
 * Chosen to read as the city coming alive rather than as a progress bar: a progress bar promises a
 * measurement, and there is nothing to measure yet - the scene is one synchronous half-second.
 * Cycled with JS rather than a CSS animation, so a reduced-motion player gets a single static line
 * (see `showLoading`).
 */
const LOADING_PHRASES: readonly string[] = ['LINKING CITY\u2026', 'RAISING BUILDINGS\u2026', 'WIRING NEON\u2026'];
/** How long one loading phrase stays up before the next, in milliseconds. */
const LOADING_PHRASE_MS = 650;

/**
 * The loading glyph: the favicon's triangle, drawn larger and unboxed.
 *
 * Inlined as an SVG string rather than a node, so the spinner is one element with nothing to
 * allocate and nothing to reach into. The stroke uses `currentColor`, which the CSS sets to the
 * neon accent - one colour, one source.
 */
const LOADING_GLYPH_SVG =
  '<svg viewBox="0 0 32 32" width="54" height="54" aria-hidden="true">' +
  '<path d="M6 23 L16 7 L26 23" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linejoin="round"/></svg>';

export class GameUi {  readonly root: HTMLElement;
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
  private readonly speedVignette: HTMLElement;
  /** The loading screen's cycling copy line, rewritten while it is up. */
  private readonly loadingText: HTMLElement;
  /** The glyph to stop spinning for a reduced-motion player. */
  private readonly loadingGlyph: HTMLElement;
  private readonly loadingScreen: HTMLElement;
  private loadingTimer: number | null = null;
  private loadingPhrase = 0;
  /** Whether the player asked for less motion, which also stills the loading screen. */
  private reducedMotion = false;
  /** The last opacity written, so a settled value does not rewrite the overlay every frame. */
  private vignetteValue = -1;
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
  private readonly flashElement: HTMLElement;
  /** The one screen with inputs; it owns its own DOM and reports patches upward. */
  private readonly settingsPanel: SettingsPanel;
  /** The title lines that name the level; rewritten when the level is known. */
  private readonly versionLabels: HTMLElement[] = [];
  private readonly version: string;
  private levelName: string;
  private currentReport: CrashReport | null = null;
  /** True while the presentation is "playing", so the crosshair can come back. */
  private playMode = false;

  constructor(options: GameUiOptions) {
    this.callbacks = options.callbacks;
    this.root = options.root;
    this.version = options.version;
    this.levelName = options.levelName ?? '\u2026';
    this.reducedMotion = options.settings.motion !== 'full';
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
      this.versionLabel(),
      el('p', {
        className: 'title__blurb',
        text: 'A first-person parkour run across a kilometre of generated cyberpunk city: a courtyard cat with ten shards to find, five checkpoints to run, three time trials, ninety lifts, and a street thirty-five metres below the rooftops. Mantle, vault, wall run and climb your way back up.',
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
      this.versionLabel(),
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

    // ------------------------------------------------------------------ loading
    // Not a panel: a bare, centred column, because there is nothing to read yet and a card would
    // promise text. Built up front and hidden, so showing it later is a class flip rather than a
    // DOM write in the middle of a frame.
    this.loadingText = el('p', { className: 'loading__text', text: LOADING_PHRASES[0] });
    this.loadingGlyph = el('div', { className: 'loading__glyph', attrs: { 'aria-hidden': 'true' }, html: LOADING_GLYPH_SVG });
    this.loadingScreen = el('div', { className: 'screen screen--loading' });
    const loadingInner = el('div', { className: 'loading' });
    const loadingScan = el('div', { className: 'loading__scan' });
    loadingInner.append(this.loadingGlyph, this.loadingText, loadingScan);
    this.loadingScreen.append(loadingInner);
    setHidden(this.loadingScreen, true);

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
    this.flashElement = el('div', { className: 'pickup-flash', attrs: { 'aria-hidden': 'true' } });
    // The speed vignette: a darkening at the edges that follows how fast the player is going. It
    // sits *under* the damage flash and the pickup flash, because those are events and this is a
    // standing state - an impact should read through it, not behind it.
    this.speedVignette = el('div', { className: 'speed-vignette', attrs: { 'aria-hidden': 'true' } });

    this.root.append(
      this.crosshair,
      this.speedVignette,
      this.damageFlash,
      this.flashElement,
      this.deathOverlay,
      this.startScreen,
      this.menuScreen,
      this.aboutScreen,
      this.pauseScreen,
      this.endedScreen,
      this.completeScreen,
      this.crashScreen,
      this.loadingScreen,
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
    this.reducedMotion = settings.motion !== 'full';
    this.settingsPanel.update(settings);
  }

  /**
   * A `v1.0.21 · Neon Grid` line, tracked so it can be relabelled later.
   *
   * The level is built *after* the shell, so the title cannot know its name at construction - and
   * a title card that names the wrong level is exactly the kind of copy bug this project keeps
   * finding. One helper, one list, so both title lines move together.
   */
  private versionLabel(): HTMLElement {
    const label = el('p', { className: 'title__version', text: this.titleVersion() });
    this.versionLabels.push(label);
    return label;
  }

  private titleVersion(): string {
    return `v${this.version} \u00b7 ${this.levelName}`;
  }

  /** Names the level on the title and About screens, once it has been built. */
  setLevelName(name: string): void {
    this.levelName = name;
    const text = this.titleVersion();
    for (const label of this.versionLabels) label.textContent = text;
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

  /**
   * Shows the loading screen while the first view is built.
   *
   * The scene build is a synchronous half-second, so the only way the player sees a spinner rather
   * than a frozen title is for the game to paint this *before* the build and hide it after the
   * first frame. This method is the "paint me" half: it swaps the screen and starts the copy
   * cycling. For a reduced-motion player it swaps the screen and leaves one static line.
   */
  showLoading(): void {
    this.playMode = false;
    this.setActive(this.loadingScreen);
    this.setCrosshair(false);
    this.hideDeath();

    this.loadingPhrase = 0;
    this.loadingText.textContent = LOADING_PHRASES[0] as string;
    this.loadingGlyph.classList.toggle('loading__glyph--still', this.reducedMotion);
    if (this.reducedMotion) return;

    // Cycling is the only motion that is *not* a CSS transform, so it must be driven by a timer -
    // and a timer armed before the synchronous build first fires on the other side of it, which is
    // exactly the point: the phrases keep moving through the half-second the main thread is busy.
    this.loadingTimer = window.setInterval(() => {
      this.loadingPhrase = (this.loadingPhrase + 1) % LOADING_PHRASES.length;
      this.loadingText.textContent = LOADING_PHRASES[this.loadingPhrase] as string;
    }, LOADING_PHRASE_MS);
  }

  /** Hides the loading screen once the first frame is on screen. */
  hideLoading(): void {
    if (this.loadingTimer !== null) {
      window.clearInterval(this.loadingTimer);
      this.loadingTimer = null;
    }
    this.showGame();
  }

  /** Shows the "you died" overlay while the respawn timer runs. */
  showDeath(title: string, detail: string): void {
    this.deathTitle.textContent = title;
    this.deathDetail.textContent = detail;
    setHidden(this.deathOverlay, false);
    this.setCrosshair(false);
  }

  /**
   * The secret ending.
   *
   * Reuses the death overlay's shape - a title and a line - because it is the same kind of thing: a
   * full-screen announcement that stops the world for a moment. It does not stop the *game*, since
   * the run is over by then either way and the player is free to keep moving.
   */
  showSecret(): void {
    this.deathTitle.textContent = 'SOMEBODY ANSWERED';
    this.deathDetail.textContent = 'They knew your name, and they were not surprised.';
    setHidden(this.deathOverlay, false);
    this.secretShown = true;
  }

  /** Whether the secret ending has been announced this session. */
  private secretShown = false;

  get secretAnnounced(): boolean {
    return this.secretShown;
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

  /**
   * Every message this session has shown.
   *
   * Kept because the UI is the only thing that knows what the player was *told*, and a test that
   * cannot see the toasts cannot tell a scored trial from a silent one.
   */
  readonly toasts: string[] = [];

  /**
   * A brief flash across the screen.
   *
   * For the one thing in the game that is worth interrupting for: a shard. It is a DOM element
   * rather than a post effect because it has to be *felt* rather than drawn - two hundred
   * milliseconds of #57e0ff at a fifth of an opacity, which reads as the world noticing.
   */
  flash(color = '#57e0ff'): void {
    this.flashElement.style.background = color;
    this.flashElement.classList.add('flash--on');
    const previous = this.flashHandle;
    if (previous !== null) window.clearTimeout(previous);
    this.flashHandle = window.setTimeout(() => {
      this.flashElement.classList.remove('flash--on');
      this.flashHandle = null;
    }, 180);
  }

  /** Transient message, e.g. "report copied". */
  toast(message: string, durationMs = 3000): void {
    this.toasts.push(message);
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
      this.loadingScreen,
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
    // The vignette and the crosshair are both "the player is playing right now" indicators, so they
    // come and go together: leaving a full-screen darkening up behind a pause menu would read as
    // the game being broken. Cleared rather than merely hidden, so returning to play starts from
    // nothing instead of from where the last sprint left it.
    if (!visible) this.setSpeedVignette(0);
  }

  /**
   * Sets how dark the edges of the screen are, 0..1.
   *
   * Driven every frame while playing, so the write is guarded: this is an opacity on a
   * full-screen overlay, and re-setting an identical value forces the compositor to notice it.
   *
   * **The guard compares numbers, not the style string.** The CSSOM normalises what it is given -
   * `style.opacity = '0.200'` reads back as `'0.2'` - so a guard written against the serialised
   * value would never match and would rewrite the overlay on every frame of every run.
   *
   * Non-finite input is ignored rather than written, because one NaN opacity makes the whole
   * overlay vanish and would read as the effect breaking.
   */
  setSpeedVignette(strength: number): void {
    if (!Number.isFinite(strength)) return;
    // Rounded to the precision the style keeps, so a value that has *settled* compares equal and
    // writes nothing: `easeToward` approaches asymptotically and would otherwise churn the last
    // thousandth for ever.
    const value = Math.round(Math.max(0, Math.min(1, strength)) * 1000) / 1000;
    if (value === this.vignetteValue) return;
    this.vignetteValue = value;
    this.speedVignette.style.opacity = String(value);
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
