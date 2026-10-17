// @vitest-environment jsdom
//
// `Game` owns the canvas, the DOM lifecycle and the crash path, so it belongs
// in a DOM environment. The renderer is injected, which is what makes this
// testable without WebGL.

import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_CONFIG } from '../../src/core/config.js';
import { LogBuffer } from '../../src/core/log.js';
import {
  DEFAULT_SETTINGS,
  FOV_RANGE,
  SENSITIVITY_RANGE,
  type GameSettings,
  type QualityPreset,
} from '../../src/core/settings.js';
import type { ReadonlyVec3 } from '../../src/core/vec3.js';
import type { AudioOutput } from '../../src/audio/engine.js';
import type { AudioCue } from '../../src/audio/director.js';
import { CrashReporter } from '../../src/diagnostics/crashReporter.js';
import { MemoryCrashSink } from '../../src/diagnostics/crashSinks.js';
import { Game, type GameStatus } from '../../src/game/game.js';
import { DEMO_DISTRICT, type LevelDefinition, type PropDefinition } from '../../src/game/level/levelData.js';
import type { Orientation } from '../../src/game/look.js';
import type { PlayerPose } from '../../src/game/pose.js';
import { InputState } from '../../src/input/inputState.js';
import { GraphicsUnavailableError, type CreateView, type GameViewLike } from '../../src/render/types.js';
import { GameHud } from '../../src/ui/gameHud.js';
import { DebugHud } from '../../src/ui/hud.js';
import { GameUi } from '../../src/ui/screens.js';
import { formatRunTime, type TimeStore } from '../../src/game/run.js';
import { FakeScheduler } from '../helpers/fakeScheduler.js';

interface RenderedFrame {
  readonly eye: ReadonlyVec3;
  readonly orientation: Orientation;
}

class FakeView implements GameViewLike {
  readonly rendererInfo = 'Fake GPU';
  readonly frames: RenderedFrame[] = [];
  readonly sizes: { width: number; height: number }[] = [];
  readonly doors: { id: string; open: number }[] = [];
  readonly lifts: { id: string; topY: number; floor: number; doorsOpen: number }[] = [];
  readonly pickups: { id: string; visible: boolean }[] = [];
  readonly animations: number[] = [];
  readonly fovs: number[] = [];
  readonly bodies: { feet: ReadonlyVec3; yaw: number; pose: PlayerPose; dt: number }[] = [];
  readonly qualities: QualityPreset[] = [];
  /** Every resolution scale the game has asked for, in order. */
  readonly renderScales: number[] = [];
  /** Every dust burst the game has asked for, so a landing's effect can be asserted. */
  readonly dust: { x: number; y: number; z: number; strength: number; spread: number }[] = [];
  /** How many times the dust has been cleared - a respawn or a restart must do it. */
  dustCleared = 0;
  disposed = false;

  setSize(width: number, height: number): void {
    this.sizes.push({ width, height });
  }

  render(eye: ReadonlyVec3, orientation: Orientation): void {
    this.frames.push({ eye: { ...eye }, orientation: { ...orientation } });
  }

  setDoorOpen(id: string, open: number): void {
    this.doors.push({ id, open });
  }

  setElevator(id: string, topY: number, floor: number, doorsOpen: number): void {
    this.lifts.push({ id, topY, floor, doorsOpen });
  }

  setCollectibleVisible(id: string, visible: boolean): void {
    this.pickups.push({ id, visible });
  }

  animate(elapsedSeconds: number, _deltaSeconds: number): void {
    this.animations.push(elapsedSeconds);
  }

  burstDust(x: number, y: number, z: number, strength: number, spread: number): void {
    this.dust.push({ x, y, z, strength, spread });
  }

  clearDust(): void {
    this.dustCleared += 1;
  }

  setFov(fov: number): void {
    this.fovs.push(fov);
  }

  setPlayerBody(feet: ReadonlyVec3, yaw: number, pose: PlayerPose, dt: number): void {
    this.bodies.push({ feet: { ...feet }, yaw, pose, dt });
  }

  setQuality(preset: QualityPreset): void {
    this.qualities.push(preset);
  }

  setRenderScale(scale: number): void {
    this.renderScales.push(scale);
  }

  dispose(): void {
    this.disposed = true;
  }
}

interface Harness {
  readonly game: Game;
  readonly ui: GameUi;
  readonly hud: DebugHud;
  readonly gameHud: GameHud;
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
  readonly level?: typeof DEMO_DISTRICT;
  readonly store?: TimeStore;
  readonly settings?: GameSettings;
  /** Replaces the silent default, so a test can see what was asked of the mixer. */
  readonly audio?: AudioOutput;
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
      levelId: DEMO_DISTRICT.id,
      frameCount: 0,
      elapsedSeconds: 0,
      fps: 0,
      player: null,
    }),
  });

  const hud = new DebugHud(uiRoot);
  const gameHud = new GameHud();
  uiRoot.append(gameHud.element);
  const ui = new GameUi({
    root: uiRoot,
    version: '0.0.0',
    levelName: DEMO_DISTRICT.name,
    settings: options.settings ?? DEFAULT_SETTINGS,
    callbacks: {
      onStart: vi.fn(),
      onResume: vi.fn(),
      onRestart: vi.fn(),
      onRespawn: vi.fn(),
      onMainMenu: vi.fn(),
      onQuit: vi.fn(),
      onDownloadReport: vi.fn(),
      onCopyReport: vi.fn(),
      onDownloadRecovered: vi.fn(),
      onSettingsChange: vi.fn(),
      onSettingsReset: vi.fn(),
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
    gameHud,
    input,
    crashReporter: reporter,
    logBuffer: new LogBuffer({ mirrorToConsole: false }),
    config: DEFAULT_CONFIG,
    level: options.level ?? DEMO_DISTRICT,
    ...(options.settings ? { settings: options.settings } : {}),
    ...(options.store ? { store: options.store } : {}),
    createView,
    scheduler,
    ...(options.audio ? { audio: options.audio } : {}),
    onStatusChange: (status) => statuses.push(status),
  });

  return {
    game,
    ui,
    hud,
    gameHud,
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

/**
 * A two-tier level: a deck to stand on and a floor five metres below it.
 *
 * The shipped district is no use for a *survivable* hard landing: its roofs are six metres apart
 * over a twelve-metre kill plane, so every drop off one is a death rather than an impact. Five
 * metres onto a floor gives about 16 m/s, which is above the 12 m/s that hurts and well under the
 * 26 m/s that kills - the band a landing's dust lives in.
 */
function dropLevel(): LevelDefinition {
  const slab = (id: string, at: readonly [number, number], top: number, width: number, depth: number): PropDefinition => ({
    id,
    model: 'slab',
    kind: 'floor',
    position: { x: at[0], y: top - 0.5, z: at[1] },
    size: { x: width, y: 1, z: depth },
  });

  return {
    ...DEMO_DISTRICT,
    id: 'drop-test',
    name: 'Drop Test',
    props: [slab('deck', [0, 0], 0, 10, 10), slab('ground', [34, 0], -5, 60, 40)],
    checkpoints: [],
    collectibles: [],
    doors: [],
    elevators: [],
    lights: [],
    smoke: [],
    goal: undefined,
    npc: undefined,
    trials: undefined,
    // Facing +X, which is the way to the edge.
    spawn: { position: { x: 0, y: 0.2, z: 0 }, yaw: -Math.PI / 2, pitch: 0 },
    killPlaneY: -30,
  };
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
      createHarness({ level: { ...DEMO_DISTRICT, id: 'broken', props: [] } }),
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
    expect(frame?.eye.y).toBeCloseTo(0.001 + DEFAULT_CONFIG.player.standEyeHeight, 3);
  });

  it('never renders the camera inside the floor', () => {
    const harness = createHarness();
    harness.game.start();
    stepFrames(harness, 90);

    for (const frame of harness.views[0]?.frames ?? []) {
      expect(frame.eye.y).toBeGreaterThan(DEFAULT_CONFIG.player.standHeight - 0.5);
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
    expect(player.position.z).toBeLessThan(DEMO_DISTRICT.spawn.position.z - 1);
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

    expect(harness.input.moveInput).toMatchObject({
      forward: 0,
      right: 0,
      sprint: false,
      jump: false,
      crouch: false,
    });
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
    expect(moved.z).toBeLessThan(DEMO_DISTRICT.spawn.position.z);
    const { player } = harness.game.snapshot();
    expect(player.position.z).toBeCloseTo(DEMO_DISTRICT.spawn.position.z, 9);
    expect(player.position.x).toBeCloseTo(DEMO_DISTRICT.spawn.position.x, 9);
    expect(player.velocity).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('keeps the view it already has, because the world it draws has not changed', () => {
    // V1.0.16. A restart used to dispose the view and build it again - six hundred milliseconds
    // of merging the city, a hundred and sixty of rebuilding the level, a re-upload of every
    // texture and a fresh compile of every shader, to arrive back at the same picture. The
    // canvas, the scene and the context are the same objects they were a frame ago.
    const harness = createHarness();
    harness.game.start();
    const view = harness.views[0];

    harness.game.restart();

    expect(view?.disposed).toBe(false);
    expect(harness.views).toHaveLength(1);
    expect(harness.canvases()).toHaveLength(1);
  });

  it('builds a new view when the old one is gone, as after a crash', () => {
    const harness = createHarness();
    harness.game.start();
    const first = harness.views[0];

    // A lost context, a fatal frame error: either way the view is disposed and there is nothing
    // to keep, so a restart has to put a fresh canvas and context on the screen.
    harness.game.restart();
    expect(harness.views).toHaveLength(1);

    vi.spyOn(harness.views[0] as FakeView, 'render').mockImplementation(() => {
      throw new Error('renderer exploded');
    });
    stepFrames(harness, 1);
    expect(first?.disposed).toBe(true);

    harness.game.restart();
    expect(harness.views).toHaveLength(2);
    expect(harness.views[1]?.disposed).toBe(false);
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

describe('dynamic resolution', () => {
  /**
   * A clock the test can walk, because the controller is rate-limited by wall time.
   *
   * `performance.now` is the only clock `adaptResolution` reads, so replacing it makes the whole
   * thing deterministic: frames are simulated by the scheduler and seconds are simulated here.
   */
  function withClock(run: (advance: (ms: number) => void) => void): void {
    let now = 1000;
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => now);
    try {
      run((ms) => { now += ms; });
    } finally {
      spy.mockRestore();
    }
  }

  it('takes the resolution down when the frames do not fit', () => {
    // A heat-soaked integrated GPU, or a window twice the size: the frame stops fitting and the
    // game is the only thing that can do anything about it. Measured on the machine this was tuned
    // on, the same view costs 16.7 ms cool and 19.6 ms hot, which is sixty frames a second against
    // fifty - the difference between playable and not.
    withClock((advance) => {
      const harness = createHarness();
      harness.game.start();
      const view = harness.views[0] as FakeView;

      // A hundred and twenty frames at 40 ms: a frame time a 60 Hz display cannot show.
      stepFrames(harness, 120, 40);
      advance(2_000);

      expect(view.renderScales.length).toBeGreaterThanOrEqual(1);
      expect(view.renderScales[0]).toBeCloseTo(0.9, 5);
    });
  });

  it('leaves the resolution alone when the frames fit', () => {
    withClock((advance) => {
      const harness = createHarness();
      harness.game.start();
      const view = harness.views[0] as FakeView;

      stepFrames(harness, 240, 16.7);
      advance(2_000);

      expect(view.renderScales).toEqual([]);
    });
  });

  it('walks all the way down to the floor and stops there', () => {
    withClock((advance) => {
      const harness = createHarness();
      harness.game.start();
      const view = harness.views[0] as FakeView;

      // Hopeless frames, and enough simulated time for every rate-limited step to happen.
      for (let round = 0; round < 12; round += 1) {
        stepFrames(harness, 40, 60);
        advance(2_000);
      }

      expect(view.renderScales.length).toBeGreaterThanOrEqual(4);
      expect(view.renderScales[view.renderScales.length - 1]).toBe(0.6);
      for (const scale of view.renderScales) {
        expect(scale).toBeGreaterThanOrEqual(0.6);
        expect(scale).toBeLessThanOrEqual(1);
      }
    });
  });

  it('starts a fresh view at its preset resolution', () => {
    withClock((advance) => {
      const harness = createHarness();
      harness.game.start();
      stepFrames(harness, 120, 40);
      advance(2_000);
      expect((harness.views[0] as FakeView).renderScales.length).toBe(1);

      // A restart keeps the view (V1.0.16), but the *game* keeps its own scale; a rebuilt view is
      // a new start. Crash one, so the restart has to build a new view.
      vi.spyOn(harness.views[0] as FakeView, 'render').mockImplementation(() => {
        throw new Error('renderer exploded');
      });
      stepFrames(harness, 1);
      harness.game.restart();

      expect(harness.views).toHaveLength(2);
      expect((harness.views[1] as FakeView).renderScales).toEqual([]);
    });
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
  it('F3 shows and hides the panel, which starts hidden', () => {
    // V0.6's UI pass: the debug overlay is off by default, so a technical demo does
    // not look like a development build.
    const harness = createHarness();
    harness.game.start();
    expect(harness.hud.isVisible).toBe(false);

    harness.input.keyDown('F3');
    stepFrames(harness, 1);
    expect(harness.hud.isVisible).toBe(true);

    harness.input.keyUp('F3');
    harness.input.keyDown('F3');
    stepFrames(harness, 1);
    expect(harness.hud.isVisible).toBe(false);
  });

  it('R restarts the demo', () => {
    const harness = createHarness();
    harness.game.start();
    harness.input.keyDown('KeyW');
    stepFrames(harness, 60);
    harness.input.keyUp('KeyW');

    harness.input.keyDown('KeyR');
    stepFrames(harness, 1);

    expect(harness.game.snapshot().player.position.z).toBeCloseTo(DEMO_DISTRICT.spawn.position.z, 9);
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
    expect(harness.reporter.lastReport?.game.levelId).toBe(DEMO_DISTRICT.id);
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
    expect(snapshot.levelId).toBe(DEMO_DISTRICT.id);
    expect(snapshot.levelName).toBe(DEMO_DISTRICT.name);
    expect(snapshot.stats.frames).toBe(30);
    expect(snapshot.stats.elapsedSeconds).toBeGreaterThan(0);
    expect(snapshot.renderer).toBe('Fake GPU');
    expect(snapshot.player.grounded).toBe(true);
    expect(snapshot.player.groundId).toBe('deck');
    expect(snapshot.player.stance).toBe('standing');
    expect(snapshot.player.alive).toBe(true);
    expect(snapshot.player.deaths).toBe(0);
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

describe('Game locomotion abilities', () => {
  it('sprints faster than it walks when Shift is held', () => {
    const walk = createHarness();
    walk.game.start();
    walk.input.keyDown('KeyW');
    stepFrames(walk, 90);

    const sprint = createHarness();
    sprint.game.start();
    sprint.input.keyDown('KeyW');
    sprint.input.keyDown('ShiftLeft');
    stepFrames(sprint, 90);

    const walked = walk.game.snapshot().player.horizontalSpeed;
    const sprinted = sprint.game.snapshot().player.horizontalSpeed;

    expect(walked).toBeCloseTo(DEFAULT_CONFIG.player.walkSpeed, 1);
    expect(sprinted).toBeCloseTo(DEFAULT_CONFIG.player.sprintSpeed, 1);
    expect(sprinted).toBeGreaterThan(walked);
  });

  it('jumps on Space and lands again', () => {
    const harness = createHarness();
    harness.game.start();
    stepFrames(harness, 30);

    const groundY = harness.game.snapshot().player.position.y;
    harness.input.keyDown('Space');
    stepFrames(harness, 20);
    const airborne = harness.game.snapshot().player;
    harness.input.keyUp('Space');
    stepFrames(harness, 120);

    expect(airborne.grounded).toBe(false);
    expect(airborne.position.y).toBeGreaterThan(groundY + 0.5);

    const landed = harness.game.snapshot().player;
    expect(landed.grounded).toBe(true);
    expect(landed.position.y).toBeCloseTo(0.001, 3);
  });

  it('crouches on Ctrl, changing the stance and the camera height', () => {
    const harness = createHarness();
    harness.game.start();
    stepFrames(harness, 60);

    const standingEye = harness.views[0]?.frames.at(-1)?.eye.y ?? 0;

    harness.input.keyDown('ControlLeft');
    stepFrames(harness, 5);

    expect(harness.game.snapshot().player.stance).toBe('crouched');
    const crouchedEye = harness.views[0]?.frames.at(-1)?.eye.y ?? 0;
    expect(standingEye - crouchedEye).toBeCloseTo(
      DEFAULT_CONFIG.player.standEyeHeight - DEFAULT_CONFIG.player.crouchEyeHeight,
      3,
    );

    // Releasing stands back up.
    harness.input.keyUp('ControlLeft');
    stepFrames(harness, 5);
    expect(harness.game.snapshot().player.stance).toBe('standing');
  });

  it('reports the gait in the debug HUD', () => {
    const harness = createHarness();
    harness.game.start();
    // A hidden overlay is not updated at all, which is the point of hiding it.
    harness.hud.setVisible(true);

    harness.input.keyDown('KeyW');
    harness.input.keyDown('ShiftLeft');
    stepFrames(harness, 90);

    const text = document.querySelector('.hud__list')?.textContent ?? '';
    expect(text).toContain('sprint');
  });
});

describe('Game fall detection and respawn', () => {
  /** Runs south off the deck and waits for the death to register. */
  function fallOffTheRoof(harness: Harness): { diedAfter: number; overlayShown: boolean } {
    harness.game.start();
    stepFrames(harness, 20);

    // The spawn is ~7 m from the south edge; sprinting backwards gets there fast.
    harness.input.keyDown('KeyS');
    harness.input.keyDown('ShiftLeft');

    for (let frame = 0; frame < 600; frame += 1) {
      stepFrames(harness, 1);
      if (harness.ui.isDeathVisible) {
        return { diedAfter: frame, overlayShown: true };
      }
    }
    return { diedAfter: -1, overlayShown: false };
  }

  it('shows the death overlay when the player falls off the roof', () => {
    const harness = createHarness();
    const { overlayShown } = fallOffTheRoof(harness);

    expect(overlayShown).toBe(true);
    expect(harness.game.snapshot().player.alive).toBe(false);
    expect(harness.game.snapshot().player.deaths).toBe(1);
    expect(document.querySelector('.crosshair')?.hasAttribute('hidden')).toBe(true);
  });

  it('respawning clears the overlay and returns the player to spawn', () => {
    const harness = createHarness();
    fallOffTheRoof(harness);

    harness.input.keyUp('KeyS');
    harness.input.keyUp('ShiftLeft');

    // Long enough for the respawn delay.
    let respawned = false;
    for (let frame = 0; frame < 600 && !respawned; frame += 1) {
      stepFrames(harness, 1);
      if (!harness.ui.isDeathVisible) respawned = true;
    }

    expect(respawned).toBe(true);
    const player = harness.game.snapshot().player;
    expect(player.alive).toBe(true);
    expect(player.position.z).toBeCloseTo(DEMO_DISTRICT.spawn.position.z, 3);
    expect(player.position.x).toBeCloseTo(DEMO_DISTRICT.spawn.position.x, 3);
    expect(player.deaths).toBe(1);
    // Back in play, so the crosshair returns.
    expect(document.querySelector('.crosshair')?.hasAttribute('hidden')).toBe(false);
  });

  it('respawn() returns the player to spawn on request', () => {
    const harness = createHarness();
    harness.game.start();
    harness.input.keyDown('KeyW');
    stepFrames(harness, 60);
    harness.input.keyUp('KeyW');
    expect(harness.game.snapshot().player.position.z).toBeLessThan(DEMO_DISTRICT.spawn.position.z - 1);

    harness.game.respawn();

    const player = harness.game.snapshot().player;
    expect(player.position.z).toBeCloseTo(DEMO_DISTRICT.spawn.position.z, 9);
    expect(player.velocity).toEqual({ x: 0, y: 0, z: 0 });
    expect(player.alive).toBe(true);
    // A respawn is not a restart: the death count survives.
    expect(player.deaths).toBe(0);
  });

  it('restarting clears the death count and the overlay', () => {
    const harness = createHarness();
    fallOffTheRoof(harness);
    expect(harness.game.snapshot().player.deaths).toBe(1);

    harness.game.restart();

    expect(harness.game.snapshot().player.deaths).toBe(0);
    expect(harness.ui.isDeathVisible).toBe(false);
    expect(harness.game.snapshot().player.alive).toBe(true);
  });

  it('the death overlay is not up during normal play', () => {
    const harness = createHarness();
    harness.game.start();
    stepFrames(harness, 120);
    expect(harness.ui.isDeathVisible).toBe(false);
  });

  it('pausing while dead keeps the overlay and pauses the loop', () => {
    const harness = createHarness();
    fallOffTheRoof(harness);

    harness.game.pause('test');

    expect(harness.game.currentStatus).toBe('paused');
    // Respawn is driven by the simulation, which is frozen while paused.
    expect(harness.ui.isDeathVisible).toBe(true);
  });

  it('throws dust up on a hard landing, scaled by the impact', () => {
    // The camera already answers a landing; this is the ground doing the same, so what the eye
    // sees and what the camera feels are one event.
    const harness = createHarness({ level: dropLevel() });
    harness.game.start();
    stepFrames(harness, 10);

    const view = harness.views[0];
    const before = view?.dust.length ?? 0;

    // Sprint east off the deck, then land on the floor five metres below and settle.
    harness.input.keyDown('KeyW');
    harness.input.keyDown('ShiftLeft');
    stepFrames(harness, 90);
    harness.input.keyUp('KeyW');
    harness.input.keyUp('ShiftLeft');
    stepFrames(harness, 240);

    // It was a landing, not a death: the point of this level.
    expect(harness.game.snapshot().player.alive).toBe(true);

    const bursts = (view?.dust.length ?? 0) - before;
    expect(bursts).toBeGreaterThan(0);
    for (const burst of view?.dust ?? []) {
      expect(burst.strength).toBeGreaterThan(0);
      expect(burst.strength).toBeLessThanOrEqual(1);
      // A spread past a couple of metres reads as an explosion rather than a footfall.
      expect(burst.spread).toBeLessThan(5);
    }
  });

  it('clears any dust on a respawn, so it is not carried to the spawn point', () => {
    const harness = createHarness();
    harness.game.start();
    stepFrames(harness, 10);
    const before = harness.views[0]?.dustCleared ?? 0;

    harness.game.respawn();

    expect((harness.views[0]?.dustCleared ?? 0) - before).toBe(1);
  });

  it('clears any dust on a restart, so a new run starts with clean air', () => {
    const harness = createHarness();
    harness.game.start();
    stepFrames(harness, 10);
    const before = harness.views[0]?.dustCleared ?? 0;

    harness.game.restart();

    expect((harness.views[0]?.dustCleared ?? 0) - before).toBe(1);
  });
});

describe('the V0.3 play HUD and checkpoints', () => {
  it('shows the play HUD with health, checkpoint progress, the clock and the pickups', () => {
    const harness = createHarness();
    harness.game.start();
    // The HUD refreshes at 10 Hz, so it takes a few frames to appear.
    stepFrames(harness, 12);

    const vitals = document.querySelector('.vitals');
    expect(vitals).not.toBeNull();
    expect(vitals?.textContent).toContain('100%');
    expect(vitals?.textContent).toContain('CP 0 / 5');
    expect(vitals?.querySelectorAll('.vitals__pip')).toHaveLength(5);
    // V0.5: the clock starts stopped, and the pickups are counted.
    expect(vitals?.querySelector('.vitals__time')?.textContent).toBe('0:00.00');
    expect(vitals?.querySelector('.vitals__pickups')?.textContent).toBe('0 / 8');
    expect((vitals as HTMLElement).dataset.running).toBe('false');
  });

  /**
   * Walks the player into the first checkpoint, which sits on the annex roof
   * across the northern gap.
   *
   * Driven by input rather than by moving the player directly: the checkpoint has
   * to be reached by the simulation, which is the thing under test.
   */
  function reachFirstCheckpoint(harness: Harness): void {
    const target = DEMO_DISTRICT.checkpoints[0]?.position;
    harness.game.start();
    stepFrames(harness, 10);

    const set = (code: string, on: boolean): void => {
      if (on) harness.input.keyDown(code);
      else harness.input.keyUp(code);
    };

    for (let frame = 0; frame < 1200; frame += 1) {
      const player = harness.game.snapshot().player;
      if (player.checkpoint === 0) return;

      // Steer at the checkpoint. The spawn faces -Z, so forward is -Z and right
      // is +X.
      const dx = (target?.x ?? 0) - player.position.x;
      const dz = (target?.z ?? 0) - player.position.z;
      set('KeyW', dz < -0.5);
      set('KeyS', dz > 0.5);
      set('KeyD', dx > 0.5);
      set('KeyA', dx < -0.5);
      set('ShiftLeft', true);

      // Jump to cross the gap; then release and press again to pull up, because
      // the press that grabbed the ledge is latched.
      set('Space', player.locomotion === 'hanging' ? frame % 8 < 4 : player.grounded && frame % 6 < 3);

      stepFrames(harness, 1);
    }
  }

  it('marks a checkpoint reached, and says so', () => {
    const harness = createHarness();
    reachFirstCheckpoint(harness);

    expect(harness.game.snapshot().player.checkpoint).toBe(0);
    expect(document.querySelector('.notice--toast')?.textContent).toBe('CHECKPOINT 1 / 5');
    expect(document.querySelector('.vitals__pip--reached')).not.toBeNull();
  });

  it('keeps the checkpoint across a respawn, but not across a restart', () => {
    const harness = createHarness();
    reachFirstCheckpoint(harness);
    expect(harness.game.snapshot().player.checkpoint).toBe(0);

    harness.game.respawn();
    expect(harness.game.snapshot().player.checkpoint).toBe(0);

    harness.game.restart();
    expect(harness.game.snapshot().player.checkpoint).toBe(-1);
  });

  it('returns to the main menu, and stops the loop doing it', () => {
    const harness = createHarness();
    harness.game.start();
    stepFrames(harness, 2);

    harness.game.toMainMenu();

    expect(harness.game.currentStatus).toBe('idle');
    expect(document.querySelector('.screen--start')?.hasAttribute('hidden')).toBe(false);
    expect(document.querySelector('.crosshair')?.hasAttribute('hidden')).toBe(true);

    // And the title menu can start a fresh run from there.
    harness.game.start();
    expect(harness.game.currentStatus).toBe('playing');
    expect(harness.game.snapshot().player.checkpoint).toBe(-1);
  });
});


describe('the V0.4 doors', () => {
  /** The demo district, with a door standing just north of the spawn. */
  const DOOR_LEVEL = {
    ...DEMO_DISTRICT,
    doors: [
      { id: 'test-door', position: { x: 0, y: 1.1, z: 1 }, size: { x: 1.4, y: 2.2, z: 0.3 }, hinge: 'x-' as const, openAngle: 2.1 },
    ],
  };

  it('pushes every door to a freshly created view, shut to begin with', () => {
    const harness = createHarness({ level: DOOR_LEVEL });
    harness.game.start();
    stepFrames(harness, 2);

    const view = harness.views[0];
    expect(view).toBeDefined();
    expect(view?.doors.length).toBeGreaterThan(0);
    // Every door starts closed, so the view was told about all of them at zero.
    expect(view?.doors.every((entry) => entry.id === 'test-door' && entry.open === 0)).toBe(true);
  });

  it('works the door the player is standing next to with E', () => {
    const harness = createHarness({ level: DOOR_LEVEL });
    harness.game.start();
    stepFrames(harness, 2);

    harness.input.keyDown('KeyE');
    stepFrames(harness, 1);
    harness.input.keyUp('KeyE');

    // The leaf takes about a second to swing, so let it.
    stepFrames(harness, 90);

    const view = harness.views[0];
    const latest = view?.doors.filter((entry) => entry.id === 'test-door').at(-1);
    expect(latest?.open).toBeGreaterThan(0.5);
  });

  it('closes it again on a second press', () => {
    const harness = createHarness({ level: DOOR_LEVEL });
    harness.game.start();
    stepFrames(harness, 2);

    const press = (): void => {
      harness.input.keyDown('KeyE');
      stepFrames(harness, 1);
      harness.input.keyUp('KeyE');
    };

    press();
    stepFrames(harness, 90);
    press();
    stepFrames(harness, 90);

    const view = harness.views[0];
    const latest = view?.doors.filter((entry) => entry.id === 'test-door').at(-1);
    expect(latest?.open).toBe(0);
  });
});

describe('the V0.5 run: pickups, the finish and the clock', () => {
  /** The demo district, with a pickup and a finish sitting on the spawn. */
  const nearSpawn = (overrides: Record<string, unknown>) => ({ ...DEMO_DISTRICT, ...overrides });

  const PICKUP_LEVEL = nearSpawn({
    collectibles: [{ id: 'test-shard', position: { x: 0, y: 1.4, z: 3 } }],
    goal: undefined,
  });

  /** A level with a cat at the spawn, a shard beside it, and the finish where the cat is. */
  const QUEST_LEVEL = nearSpawn({
    collectibles: [{ id: 'test-shard', position: { x: 0, y: 1.4, z: 3 } }],
    checkpoints: [],
    npc: { id: 'test-cat', name: 'Alley cat', position: { x: 0, y: 0.5, z: 3 }, reach: 4 },
    goal: { id: 'test-goal', position: { x: 0, y: 0.5, z: 3 } },
  });

  /** A trial whose two gates are both within reach of the spawn. */
  const TRIAL_LEVEL = nearSpawn({
    collectibles: [],
    checkpoints: [],
    goal: undefined,
    trials: [
      {
        id: 'test-trial',
        from: { x: 0, y: 0.5, z: 3 },
        to: { x: 0, y: 0.5, z: 3 },
        reach: 3.4,
        starTimes: [60, 90, 120] as const,
      },
    ],
  });

  /** The phone, lying where the player spawns. */
  const PHONE_LEVEL = nearSpawn({
    collectibles: [{ id: 'secret-phone', position: { x: 0, y: 0.9, z: 3 } }],
    checkpoints: [],
    goal: undefined,
  });

  /** A floor, and a box in the way of a sprint: something to land off. */
  const ROUGH_LEVEL = nearSpawn({
    collectibles: [],
    checkpoints: [],
    goal: undefined,
    // The district's own lifts come with the district: a level with a floor and a box in it has no
    // shafts to put gates in.
    elevators: [],
    doors: [],
    props: [
      // Big enough that a sprint does not run off the end of it: falling off is a respawn, and a
      // respawn is a teleport, which is the one thing this measurement must not be confused by.
      { id: 'test-floor', model: 'slab', position: { x: 0, y: -0.5, z: 0 }, size: { x: 900, y: 1, z: 900 }, kind: 'floor' },
      { id: 'test-box', model: 'crate', position: { x: 0, y: 0.6, z: 6 }, size: { x: 2.4, y: 1.2, z: 3 } },
    ],
  });

  const UNARMED_GOAL_LEVEL = nearSpawn({
    collectibles: [],
    goal: { id: 'test-goal', position: { x: 0, y: 0.5, z: 3 } },
  });

  const ARMED_GOAL_LEVEL = nearSpawn({
    collectibles: [],
    checkpoints: [],
    // Five metres north of the spawn, so the player has to run to it - and a run
    // that has not started yet is not a time worth recording.
    goal: { id: 'test-goal', position: { x: 0, y: 0.5, z: -2 } },
  });

  /** A tiny in-memory `localStorage`. */
  function fakeStore(initial: Record<string, string> = {}) {
    const data: Record<string, string> = { ...initial };
    return {
      data,
      getItem: (key: string) => data[key] ?? null,
      setItem: (key: string, value: string) => {
        data[key] = value;
      },
    };
  }

  it('takes a pickup the player walks into, and hides it', () => {
    const harness = createHarness({ level: PICKUP_LEVEL });
    harness.game.start();
    stepFrames(harness, 2);

    expect(harness.game.runSnapshot.collected).toBe(1);
    // The view was told, so the shard is gone rather than ghosted.
    expect(harness.views[0]?.pickups).toContainEqual({ id: 'test-shard', visible: false });
  });

  it('refuses a shard until the cat has asked for it', () => {
    // The quest gate: eight unmarked boxes on a kilometre are a scavenger hunt with no giver. The
    // shard is right there and cannot be taken - and once the cat has been talked to, it can.
    const harness = createHarness({ level: QUEST_LEVEL });
    harness.game.start();
    stepFrames(harness, 2);
    expect(harness.game.runSnapshot.collected).toBe(0);
    expect(harness.game.runSnapshot.quest).toBe('none');

    harness.input.keyDown('KeyE');
    stepFrames(harness, 1);
    harness.input.keyUp('KeyE');
    expect(harness.game.runSnapshot.quest).toBe('taken');
    stepFrames(harness, 2);
    expect(harness.game.runSnapshot.collected).toBe(1);
  });

  it('does not arm the finish until the cat has been told, and arms it when it has', () => {
    // The finish is the return trip. A player who collects the eight and never comes back is early
    // rather than done.
    const harness = createHarness({ level: QUEST_LEVEL });
    harness.game.start();
    stepFrames(harness, 2);
    harness.input.keyDown('KeyE');
    stepFrames(harness, 1);
    harness.input.keyUp('KeyE');
    stepFrames(harness, 2);
    expect(harness.game.runSnapshot.collected, 'the shard is in').toBe(1);
    expect(harness.game.runSnapshot.goalArmed).toBe(false);

    harness.input.keyDown('KeyE');
    stepFrames(harness, 1);
    harness.input.keyUp('KeyE');
    expect(harness.game.runSnapshot.quest).toBe('done');
    expect(harness.game.runSnapshot.goalArmed).toBe(true);
  });

  it('counts the shards the cat asked for, and not the secret', () => {
    // "0 / 11" tells the player there is one they have not been told about, which is the opposite of
    // what a secret is.
    const harness = createHarness({ level: PHONE_LEVEL });
    harness.game.start();
    stepFrames(harness, 2);
    expect(harness.game.runSnapshot.collectibleCount, 'the phone is not a shard').toBe(0);
  });

  it('runs a time trial from the gate to the gate, and scores it', () => {
    // Both gates beside the spawn, so the run starts and finishes inside the same second: what is
    // tested is the flow - through the gate, the clock runs, reaching the other gate scores - rather
    // than a route, which `city.test.ts` covers by laying three of them across the map.
    const harness = createHarness({ level: TRIAL_LEVEL });
    harness.game.start();
    stepFrames(harness, 3);

    const trial = harness.game.currentTrial;
    expect(trial, 'the trial must have started').not.toBeNull();
    expect(trial?.stars, 'nothing is faster than three').toBe(3);
    expect(harness.ui.toasts.some((message) => message.includes('*')), 'a score').toBe(true);
  });

  it('plays the phone call and the secret ending when the phone is found', () => {
    // The one scripted moment in the game: the arm comes up, somebody answers, and then the
    // announcement. It is checked end to end because a secret that does not fire is not a secret.
    const harness = createHarness({ level: PHONE_LEVEL });
    harness.game.start();
    stepFrames(harness, 2);

    expect(harness.game.runSnapshot.collected, 'not one of the eight').toBe(0);
    expect(harness.game.calling).toBe(true);

    for (let frame = 0; frame < 400; frame += 1) stepFrames(harness, 1);
    expect(harness.game.calling).toBe(false);
    expect(harness.ui.secretAnnounced, 'the announcement').toBe(true);
  });

  it('asks for as many shards as the level has, rather than a number in a sentence', () => {
    // The cat used to say "the eight shards" over a level with ten in it, which is the kind of thing
    // a player notices in the first minute and no test does unless it is written down.
    const harness = createHarness({ level: QUEST_LEVEL });
    harness.game.start();
    harness.input.keyDown('KeyE');
    stepFrames(harness, 1);
    harness.input.keyUp('KeyE');

    const asked = harness.ui.toasts.at(-1) ?? '';
    expect(asked).toContain(String(harness.game.runSnapshot.collectibleCount));
    expect(asked).not.toContain('eight');
  });

  it('points at the shards and never at the secret', () => {
    // A phone you are guided to is not hidden, and the guide is the one thing in the game that knows
    // where everything is.
    const harness = createHarness({ level: PHONE_LEVEL });
    harness.game.start();
    stepFrames(harness, 2);
    // The only collectible on this level is the phone, so a guide that pointed at collectibles would
    // point at it - and there is nothing else it could be pointing at, which is why the hint is null.
    expect(harness.gameHud.last?.hint, 'nothing worth pointing at').toBeNull();
  });

  it('does not snap the eye when the player lands, or when a scripted move begins', () => {
    // **The feel of it, as a number.** Every discontinuity the player *sees* is a change in the eye's
    // speed between two frames, and at a 240 Hz display the two that mattered were a landing - which
    // kills the fall speed inside one simulation step - and the start of a scripted move, which used
    // to set the velocity to zero on the frame it began.
    //
    // The eye coming out of the game is the one that is drawn, camera spring and all, which is why
    // this is measured here rather than in the player's own tests.
    const harness = createHarness({ level: ROUGH_LEVEL });
    harness.game.start();
    harness.input.keyDown('KeyW');
    harness.input.keyDown('ShiftLeft');

    let last: { x: number; y: number; z: number } | null = null;
    let lastSpeed: number | null = null;
    let worst = 0;
    for (let frame = 0; frame < 400; frame += 1) {
      stepFrames(harness, 1);
      // The first frames are the view appearing and the camera settling from nowhere: not motion.
      if (frame < 30) continue;
      const eye = harness.views[0]?.frames.at(-1)?.eye;
      if (!eye) continue;
      if (last) {
        const speed = Math.hypot(eye.x - last.x, eye.y - last.y, eye.z - last.z) * 240;
        if (lastSpeed !== null) worst = Math.max(worst, Math.abs(speed - lastSpeed));
        lastSpeed = speed;
      }
      last = { x: eye.x, y: eye.y, z: eye.z };
    }
    // Measured at 5.9 before the spring and the momentum-carrying moves, and 10.6 before both. Six is
    // the bound this holds to, with the landings in there deliberately: the level is a run-up onto a
    // box and off it again.
    expect(worst).toBeLessThan(6);
  });

  it('does not finish a level whose checkpoints are still ahead', () => {
    const harness = createHarness({ level: UNARMED_GOAL_LEVEL });
    harness.game.start();
    stepFrames(harness, 8);

    expect(harness.game.currentStatus).toBe('playing');
    expect(harness.game.runSnapshot.finished).toBe(false);
    expect(harness.game.runSnapshot.goalArmed).toBe(false);
  });

  it('finishes the run at the goal once it is armed, and shows the results', () => {
    const harness = createHarness({ level: ARMED_GOAL_LEVEL });
    harness.game.start();
    harness.input.keyDown('KeyW');
    stepFrames(harness, 60);

    expect(harness.game.currentStatus).toBe('completed');
    expect(harness.game.runSnapshot.finished).toBe(true);

    const screen = document.querySelector('.screen--complete');
    expect(screen?.hasAttribute('hidden')).toBe(false);
    expect(screen?.textContent).toContain('RUN COMPLETE');
    expect(document.querySelector('.complete__time')?.textContent).not.toBe('-:--.--');
  });

  it('freezes the world behind the results', () => {
    const harness = createHarness({ level: ARMED_GOAL_LEVEL });
    harness.game.start();
    harness.input.keyDown('KeyW');
    stepFrames(harness, 60);
    expect(harness.game.currentStatus).toBe('completed');

    const frozen = harness.game.snapshot().player.position.z;
    stepFrames(harness, 30);
    expect(harness.game.snapshot().player.position.z).toBe(frozen);
  });

  it('starts the clock when the player moves, not when the game does', () => {
    const harness = createHarness();
    harness.game.start();
    stepFrames(harness, 10);

    expect(harness.game.runSnapshot.started).toBe(false);
    expect(harness.game.runSnapshot.elapsedSeconds).toBe(0);

    harness.input.keyDown('KeyW');
    stepFrames(harness, 10);

    expect(harness.game.runSnapshot.started).toBe(true);
    expect(harness.game.runSnapshot.elapsedSeconds).toBeGreaterThan(0);
  });

  it('writes a new record, and keeps a better one', () => {
    const first = fakeStore();
    const quick = createHarness({ level: ARMED_GOAL_LEVEL, store: first });
    quick.game.start();
    quick.input.keyDown('KeyW');
    stepFrames(quick, 60);
    expect(quick.game.currentStatus).toBe('completed');
    expect(first.data['cyberparkour.best-time.v1']).toBeDefined();

    // A run that already has a very good record does not overwrite it.
    const second = fakeStore({ 'cyberparkour.best-time.v1': '0.001' });
    const slow = createHarness({ level: ARMED_GOAL_LEVEL, store: second });
    slow.game.start();
    slow.input.keyDown('KeyW');
    stepFrames(slow, 60);
    expect(slow.game.currentStatus).toBe('completed');
    expect(second.data['cyberparkour.best-time.v1']).toBe('0.001');
  });

  it('resets the clock and the pickups when the run restarts', () => {
    const harness = createHarness({ level: PICKUP_LEVEL });
    harness.game.start();
    stepFrames(harness, 4);
    expect(harness.game.runSnapshot.collected).toBe(1);

    harness.game.restart();
    // The pickup is back: a restart is the route from the beginning.
    expect(harness.game.runSnapshot.collected).toBe(0);
    expect(harness.views[0]?.pickups).toContainEqual({ id: 'test-shard', visible: true });
  });
});

describe('the V0.5.1 fixes', () => {
  /**
   * The demo district with a finish that sits *below* its kill plane.
   *
   * Contrived, and deliberately so: it is the one arrangement in which the player
   * is dead and still inside the goal's reach. They fall off the home roof, the
   * kill plane takes them at -12, and they keep falling - through the line at -15.
   * A finish you can cross while dead is not a finished run.
   */
  const FATAL_GOAL_LEVEL = {
    ...DEMO_DISTRICT,
    checkpoints: [],
    collectibles: [],
    goal: { id: 'test-goal', position: { x: 0, y: -15, z: 20 } },
  };

  it('does not finish the run when the player is dead', () => {
    const harness = createHarness({ level: FATAL_GOAL_LEVEL });
    harness.game.start();

    // Walk south, off the edge: the kill plane takes them, and they fall through
    // the line on the way down.
    harness.input.keyDown('KeyS');
    stepFrames(harness, 200);

    expect(harness.game.snapshot().player.deaths).toBeGreaterThan(0);
    expect(harness.game.runSnapshot.finished).toBe(false);
    expect(harness.game.currentStatus).toBe('playing');
    expect(document.querySelector('.screen--complete')?.hasAttribute('hidden')).toBe(true);
  });

  it('keeps the play HUD clock in step with the run, every frame', () => {
    const harness = createHarness();
    harness.game.start();
    harness.input.keyDown('KeyW');
    stepFrames(harness, 8);

    // The clock is the point of the time trial, so it may not lag behind the run
    // it is timing: this is what a ten-Hertz refresh looked like from outside.
    const run = harness.game.runSnapshot;
    expect(run.started).toBe(true);
    expect(document.querySelector('.vitals__time')?.textContent).toBe(
      formatRunTime(run.elapsedSeconds),
    );
  });

  it('ignores the interact key when the game is not playing', () => {
    const DOOR_LEVEL = {
      ...DEMO_DISTRICT,
      doors: [
        {
          id: 'test-door',
          position: { x: 0, y: 1.1, z: 1 },
          size: { x: 1.4, y: 2.2, z: 0.3 },
          hinge: 'x-' as const,
          openAngle: 2.1,
        },
      ],
    };
    const harness = createHarness({ level: DOOR_LEVEL });
    harness.game.start();
    stepFrames(harness, 2);
    harness.game.pause();

    // E while paused must not queue a door to swing open behind the menu.
    harness.input.keyDown('KeyE');
    stepFrames(harness, 1);
    harness.input.keyUp('KeyE');

    harness.game.resume();
    stepFrames(harness, 90);

    const latest = harness.views[0]?.doors.at(-1);
    expect(latest?.open).toBe(0);
  });
});

describe('settings, from the game', () => {
  /** A store that survives being handed to two games, for the persistence tests. */
  function fakeStore(initial: Record<string, string> = {}) {
    const data: Record<string, string> = { ...initial };
    return {
      getItem: (key: string) => data[key] ?? null,
      setItem: (key: string, value: string) => {
        data[key] = value;
      },
    };
  }

  it('sends every volume the panel can move to the audio engine', () => {
    // The bug this covers: the three sliders on the settings screen were built with no callback
    // at all, so they moved, the numbers changed, the settings were never told, and no volume
    // control in the game did anything. The panel's wiring cannot be tested here - the suite runs
    // without a DOM - but the path it feeds can, and a partial patch of one volume has to arrive
    // with the other two intact.
    const audio = recordingAudio();
    const harness = createHarness({ audio });
    harness.game.start();
    harness.game.updateSettings({ volumes: { master: 0.2 } });
    harness.game.updateSettings({ volumes: { effects: 0.1 } });
    harness.game.updateSettings({ volumes: { music: 0.05 } });
    // The default 0.8 first, from the engine being handed the settings at construction, and then
    // 0.2 three times: the effects and music sliders each moved without restating the master, and
    // it was carried through every time. That is the part the panel had no way to do.
    expect(audio.volumes).toEqual([0.8, 0.2, 0.2, 0.2]);
  });

  /** An audio backend that records what it was asked for. */
  function recordingAudio(): AudioOutput & { cues: AudioCue[]; volumes: number[] } {
    const cues: AudioCue[] = [];
    const volumes: number[] = [];
    return {
      isSilent: true,
      cues,
      volumes,
      play: (cue) => cues.push(cue),
      setWind: () => {},
      setMusic: () => {},
      setMuted: () => {},
      setVolumes: (next) => volumes.push(next.master),
      resume: () => {},
      silence: () => {},
      dispose: () => {},
    };
  }

  it('applies a change to everything that reads it', () => {
    const audio = recordingAudio();
    const store = fakeStore();
    const harness = createHarness({ audio, store });
    harness.game.start();
    const fake = harness.views[0];
    expect(fake).toBeDefined();
    fake!.fovs.length = 0;
    fake!.qualities.length = 0;

    const applied = harness.game.updateSettings({ fov: 95, quality: 'low', volumes: { music: 0.2 } });

    expect(applied.fov).toBe(95);
    expect(applied.quality).toBe('low');
    expect(fake!.fovs).toContain(95);
    expect(fake!.qualities.at(-1)?.label).toBe('Low');
    expect(audio.volumes.at(-1)).toBe(applied.volumes.master);
    expect(audio.volumes.at(-1)).toBeCloseTo(0.8, 6);
  });

  it('clamps what it is given, and reports what it settled on', () => {
    const harness = createHarness();
    harness.game.start();
    const applied = harness.game.updateSettings({ fov: 500, sensitivity: -3, quality: 'ultra' as never });

    expect(applied.fov).toBe(FOV_RANGE.max);
    expect(applied.sensitivity).toBe(SENSITIVITY_RANGE.min);
    expect(applied.quality).toBe('high');
  });

  it('saves, and reads back what it saved', () => {
    const store = fakeStore();
    const first = createHarness({ store });
    first.game.start();
    first.game.updateSettings({ motion: 'off', fov: 70 });

    const second = createHarness({ store });
    expect(second.game.currentSettings.motion).toBe('off');
    expect(second.game.currentSettings.fov).toBe(70);
  });

  it('resets to the defaults, bindings included', () => {
    // Bindings are a setting too, and the reason to reach for reset is that the game
    // has stopped answering the way the player expects.
    const harness = createHarness();
    harness.game.start();
    harness.game.updateSettings({ fov: 70, bindings: { ...DEFAULT_SETTINGS.bindings, jump: ['KeyJ'] } });
    expect(harness.game.currentSettings.bindings.jump).toEqual(['KeyJ']);

    const reset = harness.game.resetSettings();
    expect(reset).toEqual(DEFAULT_SETTINGS);
    expect(harness.game.currentSettings.bindings.jump).toEqual(DEFAULT_SETTINGS.bindings.jump);
  });

  it('rebinding takes effect immediately, without a restart', () => {
    const harness = createHarness();
    harness.game.start();
    stepFrames(harness, 2);
    harness.input.keyUp('KeyW');

    harness.game.updateSettings({ bindings: { ...DEFAULT_SETTINGS.bindings, moveForward: ['KeyI'] } });
    harness.input.keyDown('KeyI');
    stepFrames(harness, 30);

    // Pressing the new key moved the player.
    expect(harness.game.snapshot().player.position.z).not.toBeCloseTo(3, 6);
  });

  it('scales the camera motion setting into the head bob', () => {
    /** How far the eye rises and falls above the player's own feet while walking. */
    const bobReach = (motion: 'full' | 'off'): number => {
      const harness = createHarness({ settings: { ...DEFAULT_SETTINGS, motion } });
      harness.game.start();
      harness.input.keyDown('KeyW');
      let min = Infinity;
      let max = -Infinity;
      for (let frame = 0; frame < 150; frame += 1) {
        stepFrames(harness, 1);
        const eye = harness.views[0]?.frames.at(-1)?.eye;
        const player = harness.game.snapshot().player;
        if (!eye || !player.alive || !player.grounded) continue;
        min = Math.min(min, eye.y - player.position.y);
        max = Math.max(max, eye.y - player.position.y);
      }
      return max - min;
    };

    const full = bobReach('full');
    const off = bobReach('off');
    // There has to be a bob for the setting to be about anything.
    expect(full).toBeGreaterThan(0.005);
    // **Sixty per cent, not fifty.** The setting scales two vertical things now: the head bob, and
    // the camera spring that smooths a landing - and the spring is camera motion, so "off" turns it
    // off as well. What that leaves at "off" is the part of the eye's height that follows the
    // *ground*, which the setting was never about; the ratio was 0.5 against a margin of half a
    // millimetre per cent, which is a test that fails when anything at all moves.
    expect(off).toBeLessThan(full * 0.6);
  });
});

describe('the sounds a run makes', () => {
  it('rings when a checkpoint is reached', () => {
    const audio = {
      isSilent: true,
      cues: [] as AudioCue[],
      play(cue: AudioCue) {
        this.cues.push(cue);
      },
      setWind() {},
      setMusic() {},
      setMuted() {},
      setVolumes() {},
      resume() {},
      silence() {},
      dispose() {},
    };
    const harness = createHarness({
      audio,
      level: {
        ...DEMO_DISTRICT,
        // A few metres north of the spawn, so walking reaches it.
        checkpoints: [{ id: 'test-checkpoint', position: { x: 0, y: 0.2, z: -2 } }],
        collectibles: [],
        goal: undefined,
      },
    });
    harness.game.start();

    harness.input.keyDown('KeyW');
    stepFrames(harness, 120);
    harness.input.keyUp('KeyW');

    expect(harness.game.runSnapshot.checkpointsReached).toBeGreaterThan(0);
    expect(audio.cues.some((cue) => cue.kind === 'checkpoint')).toBe(true);
  });
});

describe('the pointer to the pickups', () => {
  /** A HUD snapshot with nothing in it but the fields the pointer needs. */
  const snapshot = (hint: { bearing: number; distance: number } | null) =>
    ({
      health: 100,
      maxHealth: 100,
      checkpoint: 0,
      checkpointCount: 5,
      elapsedSeconds: 0,
      running: true,
      collected: 1,
      collectibleCount: 10,
      goalArmed: false,
      hint,
    }) as const;

  it('draws a bearing and a distance, and nothing at all once they are all found', () => {
    // Eight shards on a kilometre of rooftops are findable by accident and unfindable on purpose:
    // the map is four times the size they were placed for. The HUD carries a bearing and a
    // distance to the nearest one still out there - and it goes away when there is none.
    const hud = new GameHud();

    hud.update(snapshot({ bearing: Math.PI / 2, distance: 42 }) as never);
    expect(hud.last?.hint?.distance).toBe(42);
    expect(hud.element.querySelector('.hint__text')?.textContent).toBe('42 m');
    expect(hud.element.querySelector('.hint')?.classList.contains('hint--off')).toBe(false);

    hud.update(snapshot(null) as never);
    expect(hud.last?.hint).toBe(null);
    expect(hud.element.querySelector('.hint')?.classList.contains('hint--off')).toBe(true);
  });
});
