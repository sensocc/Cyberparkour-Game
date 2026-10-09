/**
 * Entry point.
 *
 * Wires the four layers together - simulation (`Game`), presentation (`GameUi`),
 * input and diagnostics - and installs the global crash handlers.
 *
 * Boot happens in two phases so the title screen is up immediately rather than
 * waiting on the network: the shell (DOM, UI, crash reporter) is built first,
 * then the flat textures are loaded, then the game is created. Everything that
 * can fail does so *after* the reporter is installed, so even a broken start-up
 * produces a downloadable report.
 */

import './style.css';

import { DEFAULT_CONFIG } from './core/config.js';
import { DEFAULT_SETTINGS, normaliseSettings, readSettings, type GameSettings } from './core/settings.js';
import { logger, type LogBuffer } from './core/log.js';
import { APP_VERSION, DEMO_LABEL } from './core/version.js';
import {
  emptyGameState,
  type CrashEnvironment,
  type CrashGameState,
} from './diagnostics/crashReport.js';
import { CrashReporter } from './diagnostics/crashReporter.js';
import {
  ConsoleCrashSink,
  CRASH_STORAGE_KEY,
  MemoryCrashSink,
  StorageCrashSink,
  resolveStore,
  type KeyValueStore,
} from './diagnostics/crashSinks.js';
import { createAudio, type AudioOutput } from './audio/engine.js';
import { Game } from './game/game.js';
import { DEMO_DISTRICT } from './game/level/levelData.js';
import { InputState } from './input/inputState.js';
import { disposeSceneAssets, loadSceneAssets } from './render/assets.js';
import { NO_ASSETS, type SceneAssets } from './render/types.js';
import { GameView } from './render/view.js';
import { GameHud } from './ui/gameHud.js';
import { DebugHud } from './ui/hud.js';
import { copyReport, downloadReport, downloadReports } from './ui/reportIO.js';
import { GameUi } from './ui/screens.js';

export interface CyberparkourHandle {
  readonly game: Game;
  readonly reporter: CrashReporter;
  readonly logs: LogBuffer;
}

function requireElement<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Required element #${id} is missing from the document.`);
  return node as T;
}

/** Everything that exists before the renderer does. */
interface Shell {
  readonly app: HTMLElement;
  readonly canvasHost: HTMLElement;
  readonly input: InputState;
  readonly hud: DebugHud;
  readonly gameHud: GameHud;
  readonly ui: GameUi;
  readonly reporter: CrashReporter;
  /** Where the best time is kept. Shared with the crash reporter's storage. */
  readonly store: KeyValueStore;
  /** The one audio backend, shared by the game and the menus. */
  readonly audio: AudioOutput;
  /** What the player chose, read once at boot and applied by the game. */
  readonly settings: GameSettings;
  /** Assigned once the game exists; the UI callbacks read it lazily. */
  readonly holder: { game: Game | null };
}

/**
 * Builds the audio backend.
 *
 * Browsers will not start an audio context until a user gesture, so this only
 * creates it; `Game.start()` resumes it from the click that begins play.
 */
function createAudioBackend(): AudioOutput {
  return createAudio({ config: DEFAULT_CONFIG });
}

function createShell(): Shell {
  const app = requireElement('app');
  const canvasHost = requireElement('canvas-host');
  const uiRoot = requireElement('ui-root');

  const store = resolveStore();
  // Read once, before anything that needs them: the input layer, the camera and the
  // mixer are all constructed from what the player chose last time.
  const settings = readSettings(store);

  const input = new InputState(settings.bindings);
  const audio = createAudioBackend();

  // The game and the UI reference each other, so the game is published through
  // a holder that the UI callbacks read lazily.
  const holder: { game: Game | null } = { game: null };

  const hud = new DebugHud(uiRoot);
  const gameHud = new GameHud();
  uiRoot.append(gameHud.element);

  const storageSink = new StorageCrashSink(store, CRASH_STORAGE_KEY, 10);
  const memorySink = new MemoryCrashSink(50);

  /** Reports recovered from an earlier session, shown as a banner. */
  const recovered = storageSink.read();

  const ui = new GameUi({
    root: uiRoot,
    version: APP_VERSION,
    levelName: DEMO_DISTRICT.name,
    settings,
    callbacks: {
      onStart: () => holder.game?.start(),
      onResume: () => holder.game?.resume(),
      onRestart: () => holder.game?.restart(),
      onQuit: () => holder.game?.quit(),
      onRespawn: () => holder.game?.respawn(),
      onMainMenu: () => holder.game?.toMainMenu(),
      onDownloadReport: (report) => {
        const ok = downloadReport(report);
        ui.toast(ok ? 'Crash report downloaded.' : 'The browser blocked the download.');
      },
      onCopyReport: (report) => {
        void copyReport(report).then((ok) => {
          ui.toast(
            ok
              ? 'Crash report copied to the clipboard.'
              : 'Copy failed - select the text and copy it manually.',
          );
        });
      },
      onDownloadRecovered: () => {
        const ok = downloadReports(recovered, 'cyberparkour-crash-reports.json');
        ui.toast(ok ? 'Recovered reports downloaded.' : 'The browser blocked the download.');
      },
      // The game is the one that clamps, applies and stores, so the screen is
      // redrawn from its answer rather than from what was asked for.
      onSettingsChange: (patch) => {
        if (holder.game) holder.game.updateSettings(patch);
        else ui.setSettings(normaliseSettings({ ...settings, ...patch }));
      },
      onSettingsReset: () => {
        if (holder.game) holder.game.resetSettings();
        else ui.setSettings(DEFAULT_SETTINGS);
      },
    },
  });

  if (recovered.length > 0) {
    ui.setRecoveredReports(recovered);
    logger.warn('app', `${recovered.length} crash report(s) recovered from an earlier session`);
  }

  const reporter = new CrashReporter({
    version: APP_VERSION,
    sinks: [new ConsoleCrashSink(), memorySink, storageSink],
    logBuffer: logger,
    logTail: 80,
    getGameState: (): CrashGameState => {
      const game = holder.game;
      if (!game) return emptyGameState();

      const snapshot = game.snapshot();
      return {
        levelId: snapshot.levelId,
        frameCount: snapshot.stats.frames,
        elapsedSeconds: snapshot.stats.elapsedSeconds,
        fps: snapshot.stats.fps,
        player: snapshot.player,
      };
    },
    getEnvironment: (): CrashEnvironment => ({
      userAgent: navigator.userAgent,
      url: location.href,
      language: navigator.language,
      viewport: {
        width: globalThis.innerWidth,
        height: globalThis.innerHeight,
        devicePixelRatio: globalThis.devicePixelRatio || 1,
      },
      pointerLocked: document.pointerLockElement !== null,
      renderer: holder.game?.rendererInfo ?? null,
    }),
    // The single presentation point for every captured failure, including
    // errors that never passed through the game loop.
    onCapture: (report) => {
      ui.showCrash(report);
    },
  });

  reporter.install();
  logger.info('app', `${DEMO_LABEL} booting`);

  // Menu sounds. The game cannot do this: it is not the thing being clicked, and a
  // button that makes no noise is a button the player is not sure they pressed.
  uiRoot.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest('button')) return;
    // The first click of a session is also the gesture that lets the audio context
    // start, which is why this resumes rather than assuming.
    audio.resume();
    audio.play({ kind: 'ui-click' });
  });

  ui.showStart();

  return { app, canvasHost, input, hud, gameHud, ui, reporter, store, settings, audio, holder };
}

/** Loads the flat textures, degrading to flat colours rather than failing. */
async function loadAssets(): Promise<SceneAssets> {
  try {
    return await loadSceneAssets();
  } catch (error) {
    logger.warn('app', 'scene textures could not be loaded - using flat colours', {
      error: String(error),
    });
    return NO_ASSETS;
  }
}

function createGame(shell: Shell, assets: SceneAssets): CyberparkourHandle {
  // From here on, anything thrown is captured and shown rather than lost.
  const game = new Game({
    host: shell.canvasHost,
    pointerLockTarget: shell.app,
    ui: shell.ui,
    hud: shell.hud,
    gameHud: shell.gameHud,
    input: shell.input,
    crashReporter: shell.reporter,
    logBuffer: logger,
    config: DEFAULT_CONFIG,
    level: DEMO_DISTRICT,
    store: shell.store,
    settings: shell.settings,
    onSettingsChange: (next) => shell.ui.setSettings(next),
    audio: shell.audio,
    createView: (canvas, definition, config) =>
      new GameView({ canvas, definition, config, assets }),
    onStatusChange: (status) => {
      logger.debug('app', `status -> ${status}`);
    },
  });
  shell.holder.game = game;

  globalThis.addEventListener('pagehide', () => {
    logger.info('app', 'page hidden - releasing resources');
    shell.reporter.uninstall();
    game.dispose();
    // The view borrows the textures, so this is the only place they are freed.
    disposeSceneAssets(assets);
  });

  logger.info('app', 'ready');
  return { game, reporter: shell.reporter, logs: logger };
}

/** Last-resort panel for a failure that happened before the UI existed. */
function renderBootFailure(error: unknown): void {
  const root = document.getElementById('ui-root') ?? document.body;
  const panel = document.createElement('div');
  panel.className = 'screen screen--crash';

  const inner = document.createElement('div');
  inner.className = 'panel';

  const heading = document.createElement('h2');
  heading.className = 'screen__heading screen__heading--error';
  heading.textContent = 'Cyberparkour failed to start';

  const detail = document.createElement('pre');
  detail.className = 'crash__stack';
  detail.textContent = error instanceof Error ? (error.stack ?? error.message) : String(error);

  inner.append(heading, detail);
  panel.append(inner);
  root.append(panel);
}

let shell: Shell | null = null;

try {
  shell = createShell();
  const assets = await loadAssets();
  const handle = createGame(shell, assets);

  // Handy in the devtools console: `cyberparkour.game.snapshot()`.
  (globalThis as { cyberparkour?: CyberparkourHandle }).cyberparkour = handle;
} catch (error) {
  logger.error('app', 'boot failed', { error: String(error) });
  // If the reporter made it up, the crash screen is already showing; otherwise
  // fall back to a plain message rather than a blank page.
  if (!shell) renderBootFailure(error);
}
