/**
 * Entry point.
 *
 * Wires the four layers together - simulation (`Game`), presentation (`GameUi`),
 * input and diagnostics - and installs the global crash handlers. Everything
 * that can fail during boot does so *after* the reporter is installed, so even a
 * broken start-up produces a downloadable report.
 */

import './style.css';

import { DEFAULT_CONFIG } from './core/config.js';
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
} from './diagnostics/crashSinks.js';
import { Game } from './game/game.js';
import { DEMO_ROOF } from './game/level/levelData.js';
import { InputState } from './input/inputState.js';
import { GameView } from './render/view.js';
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

function boot(): CyberparkourHandle {
  const app = requireElement('app');
  const canvasHost = requireElement('canvas-host');
  const uiRoot = requireElement('ui-root');

  const input = new InputState();

  // The game and the UI reference each other, so the game is published through
  // a holder that the UI callbacks read lazily.
  const holder: { game: Game | null } = { game: null };

  const hud = new DebugHud(uiRoot);

  const store = resolveStore();
  const storageSink = new StorageCrashSink(store, CRASH_STORAGE_KEY, 10);
  const memorySink = new MemoryCrashSink(50);

  /** Reports recovered from an earlier session, shown as a banner. */
  const recovered = storageSink.read();

  const ui = new GameUi({
    root: uiRoot,
    version: APP_VERSION,
    levelName: DEMO_ROOF.name,
    callbacks: {
      onStart: () => holder.game?.start(),
      onResume: () => holder.game?.resume(),
      onRestart: () => holder.game?.restart(),
      onQuit: () => holder.game?.quit(),
      onDownloadReport: (report) => {
        const ok = downloadReport(report);
        ui.toast(ok ? 'Crash report downloaded.' : 'The browser blocked the download.');
      },
      onCopyReport: (report) => {
        void copyReport(report).then((ok) => {
          ui.toast(ok ? 'Crash report copied to the clipboard.' : 'Copy failed - select the text and copy it manually.');
        });
      },
      onDownloadRecovered: () => {
        const ok = downloadReports(recovered, 'cyberparkour-crash-reports.json');
        ui.toast(ok ? 'Recovered reports downloaded.' : 'The browser blocked the download.');
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

  // From here on, anything thrown is captured and shown rather than lost.
  const game = new Game({
    host: canvasHost,
    pointerLockTarget: app,
    ui,
    hud,
    input,
    crashReporter: reporter,
    logBuffer: logger,
    config: DEFAULT_CONFIG,
    level: DEMO_ROOF,
    createView: (canvas, definition, config) => new GameView({ canvas, definition, config }),
    onStatusChange: (status) => {
      logger.debug('app', `status -> ${status}`);
    },
  });
  holder.game = game;

  globalThis.addEventListener('pagehide', () => {
    logger.info('app', 'page hidden - releasing resources');
    reporter.uninstall();
    game.dispose();
  });

  logger.info('app', 'ready');
  return { game, reporter, logs: logger };
}

try {
  const handle = boot();
  // Handy in the devtools console: `cyberparkour.game.snapshot()`.
  (globalThis as { cyberparkour?: CyberparkourHandle }).cyberparkour = handle;
} catch (error) {
  // Last resort: the reporter itself could not be created, so fall back to a
  // plain message rather than a blank screen.
  logger.error('app', 'boot failed', { error: String(error) });

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
