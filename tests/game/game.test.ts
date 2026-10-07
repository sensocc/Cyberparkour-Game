// @vitest-environment jsdom
//
// `Game` owns the canvas, the DOM lifecycle and the crash path, so it belongs
// in a DOM environment. The renderer is injected, which is what makes this
// testable without WebGL.

import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_CONFIG } from '../../src/core/config.js';
import { LogBuffer } from '../../src/core/log.js';
import type { ReadonlyVec3 } from '../../src/core/vec3.js';
import { CrashReporter } from '../../src/diagnostics/crashReporter.js';
import { MemoryCrashSink } from '../../src/diagnostics/crashSinks.js';
import { Game, type GameStatus } from '../../src/game/game.js';
import { DEMO_ROOF } from '../../src/game/level/levelData.js';
import type { Orientation } from '../../src/game/look.js';
import { InputState } from '../../src/input/inputState.js';
import { GraphicsUnavailableError, type CreateView, type GameViewLike } from '../../src/render/types.js';
import { DebugHud } from '../../src/ui/hud.js';
import { GameUi } from '../../src/ui/screens.js';
import { FakeScheduler } from '../helpers/fakeScheduler.js';

interface RenderedFrame {
  readonly eye: ReadonlyVec3;
  readonly orientation: Orientation;
}

class FakeView implements GameViewLike {
  readonly rendererInfo = 'Fake GPU';
  readonly frames: RenderedFrame[] = [];
  readonly sizes: { width: number; height: number }[] = [];
  disposed = false;

  setSize(width: number, height: number): void {
    this.sizes.push({ width, height });
  }

  render(eye: ReadonlyVec3, orientation: Orientation): void {
    this.frames.push({ eye: { ...eye }, orientation: { ...orientation } });
  }

  dispose(): void {
    this.disposed = true;
  }
}

interface Harness {
  readonly game: Game;
  readonly ui: GameUi;
  readonly hud: DebugHud;
  readonly input: InputState;
  readonly reporter: CrashReporter;
  readonly sink: MemoryCrashSink;
  readonly scheduler: FakeScheduler;
  readonly host: HTMLElement;
  readonly views: FakeView[];
  readonly statuses: GameStatus[];
  readonly canvases: () => HTMLCanvasElement[];
}

interface HarnessOptions {
  readonly createView?: CreateView;
  readonly level?: typeof DEMO_ROOF;
}

function createHarness(options: HarnessOptions = {}): Harness {
  document.body.innerHTML = '';

  const app = document.createElement('div');
  const host = document.createElement('div');
  const uiRoot = document.createElement('div');
  app.append(host, uiRoot);
  document.body.append(app);

  const input = new InputState();
  const scheduler = new FakeScheduler();
  const sink = new MemoryCrashSink();
  const views: FakeView[] = [];
  const statuses: GameStatus[] = [];

  const reporter = new CrashReporter({
    version: '0.0.0',
    sinks: [sink],
    logBuffer: new LogBuffer({ mirrorToConsole: false }),
    getGameState: () => ({
      levelId: DEMO_ROOF.id,
      frameCount: 0,
      elapsedSeconds: 0,
      fps: 0,
      player: null,
    }),
  });

  const hud = new DebugHud(uiRoot);
  const ui = new GameUi({
    root: uiRoot,
    version: '0.0.0',
    levelName: DEMO_ROOF.name,
    callbacks: {
      onStart: vi.fn(),
      onResume: vi.fn(),
      onRestart: vi.fn(),
      onQuit: vi.fn(),
      onDownloadReport: vi.fn(),
      onCopyReport: vi.fn(),
      onDownloadRecovered: vi.fn(),
    },
  });

  const createView: CreateView =
    options.createView ??
    (() => {
      const view = new FakeView();
      views.push(view);
      return view;
    });

  const game = new Game({
    host,
    pointerLockTarget: app,
    ui,
    hud,
    input,
    crashReporter: reporter,
    logBuffer: new LogBuffer({ mirrorToConsole: false }),
    config: DEFAULT_CONFIG,
    level: options.level ?? DEMO_ROOF,
    createView,
    scheduler,
    onStatusChange: (status) => statuses.push(status),
  });

  return {
    game,
    ui,
    hud,
    input,
    reporter,
    sink,
    scheduler,
    host,
    views,
    statuses,
    canvases: () => [...host.querySelectorAll('canvas')],
  };
}

function stepFrames(harness: Harness, count: number, deltaMs = 16): void {
  harness.scheduler.runFrames(count, deltaMs);
}

describe('Game construction', () => {
  it('starts idle, with no canvas and no renderer', () => {
    const harness = createHarness();
    expect(harness.game.currentStatus).toBe('idle');
    expect(harness.canvases()).toHaveLength(0);
    expect(harness.game.rendererInfo).toBeNull();
  });

  it('validates the level immediately, so an authoring mistake fails at boot', () => {
    expect(() =>
      createHarness({ level: { ...DEMO_ROOF, id: 'broken', props: [] } }),
    ).toThrow(/Invalid level "broken"/);
  });

  it('leaves the title screen visible', () => {
    createHarness();
    expect(document.querySelector('.screen--start')?.hasAttribute('hidden')).toBe(false);
  });
});

describe('Game.start', () => {
  it('creates one canvas, a view, and begins playing', () => {
    const harness = createHarness();
    harness.game.start();

    expect(harness.game.currentStatus).toBe('playing');
    expect(harness.canvases()).toHaveLength(1);
    expect(harness.views).toHaveLength(1);
    expect(harness.views[0]?.disposed).toBe(false);
    expect(harness.scheduler.queued).toBeGreaterThan(0);
  });

  it('sizes the view to the host', () => {
    const harness = createHarness();
    harness.game.start();
    // jsdom reports a zero-sized rect, so the viewport fallback is used.
    expect(harness.views[0]?.sizes[0]?.width).toBeGreaterThan(0);
    expect(harness.views[0]?.sizes[0]?.height).toBeGreaterThan(0);
  });

  it('hides the title screen and shows the crosshair', () => {
    const harness = createHarness();
    harness.game.start();

    expect(document.querySelector('.screen--start')?.hasAttribute('hidden')).toBe(true);
    expect(document.querySelector('.crosshair')?.hasAttribute('hidden')).toBe(false);
  });

  it('renders frames and reports the renderer', () => {
    const harness = createHarness();
    harness.game.start();
    stepFrames(harness, 5);

    expect(harness.views[0]?.frames.length).toBeGreaterThan(0);
    expect(harness.game.rendererInfo).toBe('Fake GPU');
  });

  it('places the camera at eye height above the player feet', () => {
    const harness = createHarness();
    harness.game.start();

    // The spawn point is half a metre above the deck; let it land first.
    stepFrames(harness, 90);

    const frame = harness.views[0]?.frames.at(-1);
    expect(frame).toBeDefined();
    // Feet rest on the deck at y = 0.001 (one collision skin), eye height 1.65.
    expect(frame?.eye.y).toBeCloseTo(0.001 + DEFAULT_CONFIG.player.eyeHeight, 3);
  });

  it('never renders the camera inside the floor', () => {
    const harness = createHarness();
    harness.game.start();
    stepFrames(harness, 90);

    for (const frame of harness.views[0]?.frames ?? []) {
      expect(frame.eye.y).toBeGreaterThan(DEFAULT_CONFIG.player.height - 0.5);
    }
  });

  it('is idempotent', () => {
    const harness = createHarness();
    harness.game.start();
    harness.game.start();
    harness.game.start();

    expect(harness.canvases()).toHaveLength(1);
    expect(harness.views).toHaveLength(1);
  });

  it('simulates movement when a key is held', () => {
    const harness = createHarness();
    harness.game.start();

    harness.input.keyDown('KeyW');
    stepFrames(harness, 60);
    harness.input.keyUp('KeyW');

    const { player } = harness.game.snapshot();
    expect(player.position.z).toBeLessThan(DEMO_ROOF.spawn.position.z - 1);
    expect(player.grounded).toBe(true);
  });

  it('applies mouse look from accumulated pointer motion', () => {
    const harness = createHarness();
    harness.game.start();
    stepFrames(harness, 2);

    harness.input.addPointerDelta(200, 50);
    stepFrames(harness, 1);

    const { player } = harness.game.snapshot();
    expect(player.yaw).toBeLessThan(0); // moving right turns right
    expect(player.pitch).toBeLessThan(0); // moving down looks down
  });

  it('consumes pointer motion only once, so look is frame-rate independent', () => {
    const harness = createHarness();
    harness.game.start();
    stepFrames(harness, 2);

    harness.input.addPointerDelta(100, 0);
    stepFrames(harness, 1);
    const afterFirst = harness.game.snapshot().player.yaw;

    stepFrames(harness, 1);
    expect(harness.game.snapshot().player.yaw).toBeCloseTo(afterFirst, 12);
  });
});

describe('Game.pause and resume', () => {
  it('pauses: freezes the simulation and shows the menu', () => {
    const harness = createHarness();
    harness.game.start();
    harness.input.keyDown('KeyW');
    stepFrames(harness, 30);

    harness.game.pause('test');
    const frozen = harness.game.snapshot().player.position;

    expect(harness.game.currentStatus).toBe('paused');
    expect(document.querySelector('.screen--pause')?.hasAttribute('hidden')).toBe(false);

    // Frames keep arriving (menus stay responsive) but nothing moves.
    stepFrames(harness, 30);
    expect(harness.game.snapshot().player.position).toEqual(frozen);
  });

  it('renders a final frame on pause so the scene stays on screen', () => {
    const harness = createHarness();
    harness.game.start();
    stepFrames(harness, 3);
    const before = harness.views[0]?.frames.length ?? 0;

    harness.game.pause('test');
    expect(harness.views[0]?.frames.length).toBe(before + 1);
  });

  it('clears held keys on pause so nothing is stuck on resume', () => {
    const harness = createHarness();
    harness.game.start();
    harness.input.keyDown('KeyW');
    harness.game.pause('test');

    expect(harness.input.moveInput).toEqual({ forward: 0, right: 0 });
  });

  it('does nothing when not playing', () => {
    const harness = createHarness();
    harness.game.pause('test');
    expect(harness.game.currentStatus).toBe('idle');
  });

  it('resumes back into play', () => {
    const harness = createHarness();
    harness.game.start();
    harness.game.pause();
    harness.game.resume();

    expect(harness.game.currentStatus).toBe('playing');
    expect(document.querySelector('.crosshair')?.hasAttribute('hidden')).toBe(false);
  });

  it('resume is ignored unless paused', () => {
    const harness = createHarness();
    harness.game.resume();
    expect(harness.game.currentStatus).toBe('idle');
  });

  it('records every status transition', () => {
    const harness = createHarness();
    harness.game.start();
    harness.game.pause();
    harness.game.resume();

    expect(harness.statuses).toEqual(['playing', 'paused', 'playing']);
  });
});

describe('Game.restart', () => {
  it('rebuilds the world and returns the player to the spawn point', () => {
    const harness = createHarness();
    harness.game.start();
    harness.input.keyDown('KeyW');
    stepFrames(harness, 60);
    harness.input.keyUp('KeyW');
    const moved = harness.game.snapshot().player.position;

    harness.game.restart();

    expect(harness.game.currentStatus).toBe('playing');
    expect(moved.z).toBeLessThan(DEMO_ROOF.spawn.position.z);
    const { player } = harness.game.snapshot();
    expect(player.position.z).toBeCloseTo(DEMO_ROOF.spawn.position.z, 9);
    expect(player.position.x).toBeCloseTo(DEMO_ROOF.spawn.position.x, 9);
    expect(player.velocity).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('disposes the old view and creates exactly one new one', () => {
    const harness = createHarness();
    harness.game.start();
    const first = harness.views[0];

    harness.game.restart();

    expect(first?.disposed).toBe(true);
    expect(harness.views).toHaveLength(2);
    expect(harness.canvases()).toHaveLength(1);
  });

  it('resets the frame statistics and the debug HUD', () => {
    const harness = createHarness();
    harness.game.start();
    stepFrames(harness, 120);
    expect(harness.game.snapshot().stats.frames).toBeGreaterThan(50);

    harness.game.restart();
    expect(harness.game.snapshot().stats.frames).toBe(0);
    expect(harness.hud.isVisible).toBe(true);
  });

  it('works from the ended state, starting a fresh session', () => {
    const harness = createHarness();
    harness.game.start();
    harness.game.quit();
    expect(harness.game.currentStatus).toBe('ended');

    harness.game.restart();

    expect(harness.game.currentStatus).toBe('playing');
    expect(harness.canvases()).toHaveLength(1);
  });

  it('works from the crashed state', () => {
    const harness = createHarness();
    harness.game.start();
    // Force a crash from inside a frame.
    harness.scheduler.runFrame(16);
    vi.spyOn(harness.views[0] as FakeView, 'render').mockImplementation(() => {
      throw new Error('renderer exploded');
    });
    stepFrames(harness, 1);
    expect(harness.game.currentStatus).toBe('crashed');

    harness.game.restart();
    expect(harness.game.currentStatus).toBe('playing');
  });
});

describe('Game.quit', () => {
  it('releases the view, the canvas and the frame loop', () => {
    const harness = createHarness();
    harness.game.start();
    const view = harness.views[0];

    harness.game.quit();

    expect(harness.game.currentStatus).toBe('ended');
    expect(view?.disposed).toBe(true);
    expect(harness.canvases()).toHaveLength(0);
    expect(harness.scheduler.queued).toBe(0);
    expect(harness.game.rendererInfo).toBeNull();
  });

  it('shows the ended screen', () => {
    const harness = createHarness();
    harness.game.start();
    harness.game.quit();
    expect(document.querySelector('.screen--ended')?.hasAttribute('hidden')).toBe(false);
  });

  it('is idempotent', () => {
    const harness = createHarness();
    harness.game.start();
    harness.game.quit();
    harness.game.quit();
    expect(harness.game.currentStatus).toBe('ended');
    expect(harness.canvases()).toHaveLength(0);
  });
});

describe('Game.dispose', () => {
  it('tears everything down and stops the loop', () => {
    const harness = createHarness();
    harness.game.start();
    const view = harness.views[0];

    harness.game.dispose();

    expect(view?.disposed).toBe(true);
    expect(harness.canvases()).toHaveLength(0);
    expect(harness.scheduler.queued).toBe(0);
    expect(harness.game.currentStatus).toBe('ended');
  });
});

describe('Game debug HUD toggle', () => {
  it('F3 hides and shows the panel', () => {
    const harness = createHarness();
    harness.game.start();
    expect(harness.hud.isVisible).toBe(true);

    harness.input.keyDown('F3');
    stepFrames(harness, 1);
    expect(harness.hud.isVisible).toBe(false);

    harness.input.keyUp('F3');
    harness.input.keyDown('F3');
    stepFrames(harness, 1);
    expect(harness.hud.isVisible).toBe(true);
  });

  it('R restarts the demo', () => {
    const harness = createHarness();
    harness.game.start();
    harness.input.keyDown('KeyW');
    stepFrames(harness, 60);
    harness.input.keyUp('KeyW');

    harness.input.keyDown('KeyR');
    stepFrames(harness, 1);

    expect(harness.game.snapshot().player.position.z).toBeCloseTo(DEMO_ROOF.spawn.position.z, 9);
  });

  it('Esc pauses when pointer lock was never acquired', () => {
    const harness = createHarness();
    harness.game.start();
    harness.input.keyDown('Escape');
    stepFrames(harness, 1);
    expect(harness.game.currentStatus).toBe('paused');
  });
});

describe('Game crash handling', () => {
  it('captures an error thrown inside a frame and stops the loop', () => {
    const harness = createHarness();
    harness.game.start();
    harness.scheduler.runFrame(16);

    vi.spyOn(harness.views[0] as FakeView, 'render').mockImplementation(() => {
      throw new Error('frame blew up');
    });
    stepFrames(harness, 1);

    expect(harness.game.currentStatus).toBe('crashed');
    expect(harness.scheduler.queued).toBe(0);
    expect(harness.reporter.reports).toHaveLength(1);
    expect(harness.reporter.lastReport?.source).toBe('game-loop');
    expect(harness.reporter.lastReport?.error.message).toBe('frame blew up');
    expect(harness.reporter.lastReport?.game.levelId).toBe(DEMO_ROOF.id);
  });

  it('releases the GPU when the renderer dies', () => {
    const harness = createHarness();
    harness.game.start();
    const view = harness.views[0];

    vi.spyOn(view as FakeView, 'render').mockImplementation(() => {
      throw new Error('frame blew up');
    });
    stepFrames(harness, 1);

    expect(view?.disposed).toBe(true);
    expect(harness.canvases()).toHaveLength(0);
    expect(harness.game.rendererInfo).toBeNull();
  });

  it('captures a lost WebGL context', () => {
    const harness = createHarness();
    harness.game.start();
    const canvas = harness.canvases()[0] as HTMLCanvasElement;

    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));

    expect(harness.game.currentStatus).toBe('crashed');
    expect(harness.reporter.lastReport?.source).toBe('webgl-context-lost');
  });

  it('reports a renderer that cannot be created at all', () => {
    const harness = createHarness({
      createView: () => {
        throw new GraphicsUnavailableError('WebGL is not available.');
      },
    });

    harness.game.start();

    expect(harness.game.currentStatus).toBe('crashed');
    expect(harness.reporter.lastReport?.source).toBe('startup');
    expect(harness.reporter.lastReport?.error.message).toBe('WebGL is not available.');
    expect(harness.canvases()).toHaveLength(0);
  });

  it('wraps an unexpected view-creation failure in a graphics error', () => {
    const harness = createHarness({
      createView: () => {
        throw new TypeError('cannot read properties of null');
      },
    });

    harness.game.start();

    expect(harness.game.currentStatus).toBe('crashed');
    expect(harness.reporter.lastReport?.error.name).toBe('GraphicsUnavailableError');
  });

  it('does not leave a stray canvas behind when the view cannot be created', () => {
    const harness = createHarness({
      createView: () => {
        throw new GraphicsUnavailableError('nope');
      },
    });
    harness.game.start();
    expect(harness.canvases()).toHaveLength(0);
  });

  it('keeps the simulation alive after a crash until restart', () => {
    const harness = createHarness();
    harness.game.start();
    vi.spyOn(harness.views[0] as FakeView, 'render').mockImplementation(() => {
      throw new Error('frame blew up');
    });
    stepFrames(harness, 1);

    const frozen = harness.game.snapshot().player.position;
    stepFrames(harness, 10);
    expect(harness.game.snapshot().player.position).toEqual(frozen);
  });
});

describe('Game pause triggers', () => {
  it('pauses when pointer lock is lost while playing', () => {
    const harness = createHarness();
    harness.game.start();
    const app = harness.host.parentElement as HTMLElement;

    // jsdom has no real pointer lock, so stand in for it: grant the lock, then
    // take it away again, exactly as Esc does.
    // jsdom does not define `pointerLockElement` at all, so install it.
    let lockedElement: Element | null = null;
    Object.defineProperty(document, 'pointerLockElement', {
      configurable: true,
      get: () => lockedElement,
    });

    try {
      lockedElement = app;
      document.dispatchEvent(new Event('pointerlockchange'));
      expect(harness.game.currentStatus).toBe('playing');

      lockedElement = null;
      document.dispatchEvent(new Event('pointerlockchange'));
      expect(harness.game.currentStatus).toBe('paused');
      expect(document.querySelector('.screen--pause')?.hasAttribute('hidden')).toBe(false);
    } finally {
      Reflect.deleteProperty(document, 'pointerLockElement');
    }
  });

  it('does not pause when pointer lock was never granted', () => {
    const harness = createHarness();

    // A browser without pointer lock must not pause the game on start.
    harness.game.start();
    document.dispatchEvent(new Event('pointerlockchange'));

    expect(harness.game.currentStatus).toBe('playing');
  });

  it('pauses when the tab is hidden', () => {
    const harness = createHarness();
    harness.game.start();

    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));

    expect(harness.game.currentStatus).toBe('paused');
    hidden.mockRestore();
  });

  it('does not pause when the tab is hidden while already paused', () => {
    const harness = createHarness();
    harness.game.start();
    harness.game.pause();

    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));

    expect(harness.game.currentStatus).toBe('paused');
  });
});

describe('Game snapshot', () => {
  it('describes the world, the player and the timing', () => {
    const harness = createHarness();
    harness.game.start();
    stepFrames(harness, 30);

    const snapshot = harness.game.snapshot();
    expect(snapshot.status).toBe('playing');
    expect(snapshot.levelId).toBe(DEMO_ROOF.id);
    expect(snapshot.levelName).toBe(DEMO_ROOF.name);
    expect(snapshot.stats.frames).toBe(30);
    expect(snapshot.stats.elapsedSeconds).toBeGreaterThan(0);
    expect(snapshot.renderer).toBe('Fake GPU');
    expect(snapshot.player.grounded).toBe(true);
    expect(snapshot.player.groundId).toBe('roof-deck');
  });

  it('is safe to read before the game has started', () => {
    const snapshot = createHarness().game.snapshot();
    expect(snapshot.status).toBe('idle');
    expect(snapshot.renderer).toBeNull();
    expect(snapshot.stats.frames).toBe(0);
  });
});

describe('Game resize handling', () => {
  it('resizes the view when the window resizes', () => {
    const harness = createHarness();
    harness.game.start();
    const before = harness.views[0]?.sizes.length ?? 0;

    window.dispatchEvent(new Event('resize'));

    expect(harness.views[0]?.sizes.length).toBe(before + 1);
  });

  it('ignores a resize after the view is gone', () => {
    const harness = createHarness();
    harness.game.start();
    harness.game.quit();
    expect(() => window.dispatchEvent(new Event('resize'))).not.toThrow();
  });
});
