/**
 * The game: owns the loop, the simulation, the view and the UI state machine.
 *
 * Status transitions
 *
 *   idle ──start──▶ playing ⇄ paused
 *                     │  ╲
 *                     │   ╲ finish ──▶ completed ──restart──▶ playing
 *                     │   ╲ quit ──▶ ended ──restart──▶ playing
 *                     └── error ──▶ crashed ──restart──▶ playing
 *
 * The frame loop keeps ticking while paused so that the menus stay responsive
 * and key handling lives in exactly one place; simulation, statistics and
 * rendering are all skipped, so a paused frame costs nothing measurable. A
 * *completed* run is paused in the same sense: the results screen is up, the
 * world is frozen behind it, and the loop is still there to be restarted.
 */

import { DEFAULT_CONFIG, fixedStep, withMotionScale, type GameConfig } from '../core/config.js';
import {
  DEFAULT_SETTINGS,
  MOTION_SCALES,
  QUALITY_PRESETS,
  normaliseSettings,
  readSettings,
  writeSettings,
  type GameSettings,
  type VolumeSettings,
} from '../core/settings.js';
import { FixedStepAccumulator } from '../core/delta.js';
import { logger, type LogBuffer } from '../core/log.js';
import { AudioDirector, type AudioCue } from '../audio/director.js';
import { SilentAudio, type AudioOutput } from '../audio/engine.js';
import { GameLoop, type FrameScheduler } from '../core/loop.js';
import { vec3, type Vec3 } from '../core/vec3.js';
import type { CrashReporter } from '../diagnostics/crashReporter.js';
import { FrameStats, type StatsSnapshot } from '../diagnostics/stats.js';
import { DomInput } from '../input/domInput.js';
import { floorFromAction } from '../input/bindings.js';
import type { InputState } from '../input/inputState.js';
import { CameraEffects, type MotionSample } from './camera.js';
import { applyLook, type Orientation } from './look.js';
import { describePose, emptyPose, type PlayerPose } from './pose.js';
import { buildLevel, climbableIds as collectClimbableIds, pipeIds as collectPipeIds, type BuiltLevel } from './level/level.js';
import { DoorSystem } from './level/doors.js';
import { ElevatorSystem, carryRider } from './level/elevators.js';
import { MotionTracker } from './movement.js';
import { readBestTime, writeBestTime, withinTrigger, RunState, type RunSnapshot, type TimeStore } from './run.js';
import { DEMO_DISTRICT, type CollectibleDefinition, type LevelDefinition } from './level/levelData.js';
import {
  createPlayerState,
  eyePosition,
  gaitPhaseAt,
  interpolatePlayerPosition,
  resetPlayerState,
  respawnPlayer,
  standingSize,
  snapshotPlayer,
  stepPlayer,
  type PlayerSnapshot,
  type PlayerState,
} from './player.js';
import { GraphicsUnavailableError, type CreateView, type GameViewLike } from '../render/types.js';
import type { ElevatorPrompt, GameHud } from '../ui/gameHud.js';
import type { DebugHud, HudSnapshot } from '../ui/hud.js';
import type { GameUi } from '../ui/screens.js';

export type GameStatus = 'idle' | 'playing' | 'paused' | 'completed' | 'ended' | 'crashed';

export interface GameOptions {
  /** Element the canvas is created in. Replaced on every restart. */
  readonly host: HTMLElement;
  /** Stable element that receives pointer lock (never replaced). */
  readonly pointerLockTarget: HTMLElement;
  readonly ui: GameUi;
  readonly hud: DebugHud;
  readonly gameHud: GameHud;
  readonly input: InputState;
  readonly crashReporter: CrashReporter;
  readonly logBuffer?: LogBuffer;
  readonly config?: GameConfig;
  readonly level?: LevelDefinition;
  /**
   * Builds the renderer. Injected rather than imported so that this class - the
   * whole game state machine - stays free of WebGL and unit-testable.
   */
  readonly createView: CreateView;
  /** Frame cadence source. Defaults to `requestAnimationFrame`. */
  readonly scheduler?: FrameScheduler;
  /** Audio backend. Defaults to silence, so tests never touch Web Audio. */
  readonly audio?: AudioOutput;
  /**
   * Where the best time is kept between sessions.
   *
   * Injected rather than reached for, so a test can supply a fake - and so the
   * game never touches `localStorage` itself.
   */
  readonly store?: TimeStore;
  /**
   * Player settings. Read from the store when omitted, so a game constructed
   * without them still respects what the player chose last time.
   */
  readonly settings?: GameSettings;
  /** Called after any settings change, so a UI can redraw what it shows. */
  readonly onSettingsChange?: (settings: GameSettings) => void;
  readonly onStatusChange?: (status: GameStatus) => void;
}

export interface GameSnapshot {
  readonly status: GameStatus;
  readonly levelId: string;
  readonly levelName: string;
  readonly stats: StatsSnapshot;
  readonly player: PlayerSnapshot;
  readonly renderer: string | null;
}

export class Game {
  private readonly options: GameOptions;
  private readonly config: GameConfig;
  private readonly definition: LevelDefinition;
  private readonly log: LogBuffer | undefined;
  private readonly loop: GameLoop;
  private readonly accumulator: FixedStepAccumulator;
  private readonly stats: FrameStats;
  private readonly domInput: DomInput;
  /**
   * Watches the movement state machine.
   *
   * V0.4 made the movement modes explicit; this is the observer that notices if
   * the game ever makes a transition the graph forbids. It never drives anything
   * - it reports, which is the whole point of keeping it separate.
   */
  private readonly motion = new MotionTracker();
  /** What the view does in response to the body: see `camera.ts`. */
  private readonly effects = new CameraEffects();
  private readonly scratchOrientation: Orientation = { yaw: 0, pitch: 0, roll: 0 };
  /**
   * What the lift in front of the player is offering, or null.
   *
   * Recomputed every frame from where they are standing, and pushed to the HUD, so
   * there is no state here to go stale.
   */
  private elevatorPrompt: ElevatorPrompt | null = null;
  /** The body's pose, rewritten every frame so the render path allocates nothing. */
  private readonly scratchPose: PlayerPose = emptyPose();
  private readonly scratchSample: MotionSample & {
    speedFraction: number;
    crouching: boolean;
    slideFraction: number;
    wallRunFraction: number;
    wallRunSide: -1 | 0 | 1;
  } = { speedFraction: 0, crouching: false, slideFraction: 0, wallRunFraction: 0, wallRunSide: 0 };

  private level: BuiltLevel;
  private player: PlayerState;
  /** Doors, and which are open. Rebuilt with the level. */
  private doors: DoorSystem;
  /** Lifts, and where they are. Rebuilt with the level. */
  private elevators: ElevatorSystem;
  /** The clock, the pickups and the record. */
  private run: RunState;
  /** The level's pickups, in the order they were declared. */
  private readonly collectibles: readonly CollectibleDefinition[];
  /**
   * Seconds of *playing* time, for purely visual animation.
   *
   * Separate from the run clock on purpose: smoke should drift while the player
   * stands still at the spawn with the timer stopped.
   */
  private effectsSeconds = 0;
  private view: GameViewLike | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private status: GameStatus = 'idle';
  /**
   * Whether pointer lock has ever been granted.
   *
   * Only a loss *after* a successful hold means "the player pressed Esc". A
   * browser that refuses or does not implement pointer lock must not pause the
   * game the moment it starts.
   */
  private hadPointerLock = false;
  private lastHudUpdate = 0;
  private resizeObserver: ResizeObserver | null = null;
  /** Whether the sprint key is held, for the debug HUD only. */
  private sprinting = false;
  /** Colliders tagged climbable, resolved once per level build. */
  private climbables: ReadonlySet<string> = new Set();
  /** Colliders that are climbable pipes, resolved once per level build. */
  private pipes: ReadonlySet<string> = new Set();
  /** Whether the player has muted the demo. */
  private muted = false;
  /** What the player has chosen, and what everything reads. */
  private settings: GameSettings;
  /**
   * The config as the *camera* sees it, with the motion setting applied.
   *
   * Only the head bob differs, but the copy is what keeps the setting from having
   * to be consulted at every point that reads a bob amplitude.
   */
  private motionConfig: GameConfig;
  private readonly audioDirector: AudioDirector;
  private readonly audioOutput: AudioOutput;
  /** Where the best time and the settings are kept. */
  private readonly store: TimeStore | undefined;

  // Reused per-frame scratch objects: the render path allocates nothing.
  private readonly scratchFeet: Vec3 = vec3();
  private readonly scratchEye: Vec3 = vec3();

  constructor(options: GameOptions) {
    this.options = options;
    this.config = options.config ?? DEFAULT_CONFIG;
    this.definition = options.level ?? DEMO_DISTRICT;
    this.log = options.logBuffer;
    this.store = options.store;
    this.settings = normaliseSettings(options.settings ?? readSettings(options.store));
    this.motionConfig = withMotionScale(this.config, MOTION_SCALES[this.settings.motion]);

    this.accumulator = new FixedStepAccumulator(
      fixedStep(this.config),
      this.config.world.maxSubSteps,
    );
    this.stats = new FrameStats(this.config.debug.fpsSampleCount);

    // Built twice on purpose: the constructor validates the level immediately,
    // so an authoring mistake surfaces at boot rather than on first frame.
    this.level = buildLevel(this.definition, {
      maxSubStep: this.config.world.maxCollisionSubStep,
      player: standingSize(this.config.player),
    });
    this.climbables = collectClimbableIds(this.level.colliders);
    this.pipes = collectPipeIds(this.level.colliders);
    this.doors = new DoorSystem(this.definition.doors ?? [], this.level.world);
    this.elevators = new ElevatorSystem(this.definition.elevators ?? [], this.level.world, {
      speed: this.config.elevator.speed,
      doorSeconds: this.config.elevator.doorSeconds,
    });
    this.collectibles = this.definition.collectibles ?? [];
    this.run = new RunState({
      checkpointCount: this.definition.checkpoints.length,
      collectibleCount: this.collectibles.length,
      bestSeconds: readBestTime(options.store),
    });
    this.player = createPlayerState(this.definition.spawn, this.config);

    this.domInput = new DomInput({
      target: options.pointerLockTarget,
      input: options.input,
      onPointerLockChange: (locked) => this.handlePointerLockChange(locked),
    });

    this.audioDirector = new AudioDirector(this.config);
    this.audioOutput = options.audio ?? new SilentAudio();

    // A settings file that disagrees with the code is applied at boot, not on the
    // first frame: these three are cheap and none of them needs a view.
    this.options.input.setBindings(this.settings.bindings);
    this.domInput.setBindings(this.settings.bindings);
    this.audioOutput.setVolumes(this.settings.volumes);

    this.loop = new GameLoop({
      onFrame: (delta) => this.handleFrame(delta),
      onError: (error) => this.handleFrameError(error),
      maxDelta: this.config.world.maxFrameDelta,
      ...(options.scheduler ? { scheduler: options.scheduler } : {}),
    });

    this.log?.info('game', 'constructed', {
      level: this.definition.id,
      props: this.level.colliders.length,
      tickRate: this.config.world.tickRate,
    });
  }

  get currentStatus(): GameStatus {
    return this.status;
  }

  /** GPU description, or null before the view exists. */
  get rendererInfo(): string | null {
    return this.view?.rendererInfo ?? null;
  }

  get pointerLocked(): boolean {
    return this.domInput.pointerLocked;
  }

  snapshot(): GameSnapshot {
    return {
      status: this.status,
      levelId: this.definition.id,
      levelName: this.definition.name,
      stats: this.stats.snapshot(),
      player: snapshotPlayer(this.player),
      renderer: this.rendererInfo,
    };
  }

  // ------------------------------------------------------------ lifecycle

  /** Starts or resumes play. Safe to call at any time. */
  start(): void {
    if (this.status === 'playing') return;

    try {
      this.ensureView();
    } catch (error) {
      this.reportFatal(error, 'startup');
      return;
    }

    this.resetSimulation();
    this.setStatus('playing');
    this.domInput.attach();
    this.loop.start();
    this.options.ui.showGame();
    this.domInput.requestPointerLock();
    this.warnIfNoMouseLook();
    this.audioOutput.resume();
    this.audioOutput.setMusic(true);
    this.log?.info('game', 'started');
  }

  /**
   * Tells the player when the browser cannot grant pointer lock.
   *
   * The demo stays playable - WASD and the debug overlay do not need it - but
   * silently losing mouse look would look like a bug.
   */
  private warnIfNoMouseLook(): void {
    if (this.domInput.pointerLockSupported) return;
    this.options.ui.toast(
      'Mouse look is unavailable: this browser does not support pointer lock.',
      8000,
    );
  }

  /** Freezes the simulation and shows the pause menu. */
  pause(reason = 'manual'): void {
    if (this.status !== 'playing') return;

    // Render one last frame so the paused view is the scene, not a stale buffer.
    this.renderFrame();
    this.setStatus('paused');
    // Released explicitly rather than relying on the lock loss to do it: on a
    // browser without pointer lock there would be no such event, and the keys
    // would stay held across the pause.
    this.options.input.clear();
    this.domInput.exitPointerLock();
    this.options.ui.showPause();
    this.audioDirector.reset();
    this.audioOutput.silence();
    this.log?.info('game', 'paused', { reason });
  }

  resume(): void {
    if (this.status !== 'paused') return;

    this.setStatus('playing');
    this.options.ui.showGame();
    this.domInput.attach();
    this.loop.start();
    this.domInput.requestPointerLock();
    this.log?.info('game', 'resumed');
  }

  /**
   * Leaves the session and returns to the title screen.
   *
   * Not the same as quitting: nothing is torn down, so the next Play is instant,
   * but the run is abandoned - the checkpoint progress and the death count go with
   * it, because starting the route again is the point of leaving.
   */
  toMainMenu(): void {
    if (this.status === 'ended') return;
    this.setStatus('idle');
    this.options.input.clear();
    this.domInput.detach();
    this.domInput.exitPointerLock();
    this.loop.stop();
    this.audioDirector.reset();
    this.audioOutput.silence();
    this.audioOutput.setMusic(false);
    this.options.hud.setVisible(true);
    this.options.ui.showStart();
    this.log?.info('game', 'returned to the main menu');
  }

  /** Tears everything down and rebuilds from the spawn point. */
  restart(): void {
    this.log?.info('game', 'restarting', { from: this.status });

    try {
      this.disposeView();
      this.ensureView();
    } catch (error) {
      this.reportFatal(error, 'startup');
      return;
    }

    this.resetSimulation();
    this.options.hud.setVisible(true);
    this.setStatus('playing');
    this.options.ui.showGame();
    this.domInput.attach();

    // Stop first so the delta baseline is re-established: otherwise the
    // restart's own duration would be simulated as one enormous frame.
    this.loop.stop();
    this.loop.start();
    this.domInput.requestPointerLock();
  }

  /** Shuts the demo down and releases the GPU. */
  quit(): void {
    if (this.status === 'ended') return;

    this.setStatus('ended');
    this.loop.stop();
    this.disposeView();
    this.domInput.exitPointerLock();
    this.domInput.detach();
    this.options.ui.showEnded();
    this.audioOutput.silence();
    this.audioOutput.setMusic(false);
    this.log?.info('game', 'quit');

    // Only permitted for windows opened by a script; the ended screen tells the
    // player to close the tab when the browser says no.
    try {
      globalThis.close();
    } catch {
      // Ignored: the ended screen already covers this case.
    }
  }

  /** Full teardown, including listeners. */
  dispose(): void {
    this.audioOutput.dispose();
    this.loop.stop();
    this.disposeView();
    this.domInput.detach();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    globalThis.removeEventListener('resize', this.handleResize);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.setStatus('ended');
  }

  // ------------------------------------------------------------- internals

  /** Options handed to every `stepPlayer` call. */
  private stepOptions() {
    return {
      world: this.level.world,
      config: this.config.player,
      game: this.motionConfig,
      climbableIds: this.climbables,
      pipeIds: this.pipes,
      checkpoints: this.definition.checkpoints,
      killPlaneY: this.definition.killPlaneY,
      respawnDelaySeconds: this.config.respawn.delaySeconds,
      safetyFloorY: this.config.world.safetyFloorY,
    };
  }

  /** Fall detection or fall damage killed the player. */
  private handleDeath(): void {
    const cause = this.player.deathCause ?? 'fell';
    this.log?.info('game', 'player died', {
      cause,
      y: this.player.position.y,
      deaths: this.player.deaths,
    });
    this.options.ui.showDeath(
      cause === 'impact' ? 'YOU DIED' : 'YOU FELL',
      cause === 'impact' ? 'The landing was too hard. Respawning…' : 'Respawning…',
    );
  }

  /** A landing, so the audio and the screen can react to how hard it was. */
  private handleLanding(impact: number, damage: number): void {
    this.audioDirector.landing(impact, damage);
    // The camera answers the same fall the health bar does: 0 at the threshold, 1
    // at the speed that would kill, so a landing that hurts is one that shows.
    const { safeImpactSpeed, fatalImpactSpeed } = this.config.fallDamage;
    const span = Math.max(1e-6, fatalImpactSpeed - safeImpactSpeed);
    this.effects.land(
      Math.min(1, Math.max(0, (impact - safeImpactSpeed) / span)),
      this.config.cameraEffects,
    );
    if (damage > 0) {
      this.options.ui.flashDamage(damage);
      this.log?.info('game', 'took fall damage', {
        impact: Math.round(impact * 10) / 10,
        damage: Math.round(damage),
        health: Math.round(this.player.health),
      });
    }
  }

  /**
   * Records a checkpoint reached, and tells the player.
   *
   * The toast matters more than it looks: the checkpoint radius is deliberately
   * generous, so a player can cross one without noticing, and being told is the
   * difference between "the game saved my progress" and "the game respawned me
   * somewhere strange after I fell".
   */
  private handleCheckpoint(index: number): void {
    const total = this.definition.checkpoints.length;
    this.log?.info('game', 'checkpoint reached', { checkpoint: index, total });
    // Heard as well as read: the checkpoint radius is generous enough to cross
    // without noticing, and a sound is what makes it land.
    this.playCue({ kind: 'checkpoint' });
    this.options.ui.toast(`CHECKPOINT ${index + 1} / ${total}`);
    this.run.reachCheckpoint(index);
    this.updateGameHud();
  }

  /**
   * Checks the pickups and the finish line.
   *
   * Run once per simulation step rather than once per frame, for the same reason
   * checkpoints are: a player at sprint speed covers a third of a metre per step,
   * and a trigger that is only tested per frame is a trigger that can be run past.
   */
  private updateTriggers(): void {
    // A dead player is falling, not running: they must not take a pickup on the
    // way past one, and - worse - they must not *finish* on the way past the
    // goal. Dying from the landing that put you on the pad is a death, not a
    // completed run.
    if (!this.player.alive) return;

    const { radius, heightTolerance } = this.config.collectible;
    for (const pickup of this.collectibles) {
      if (this.run.hasCollected(pickup.id)) continue;
      if (!withinTrigger(this.player.position, pickup.position, radius, heightTolerance)) continue;

      this.run.collect(pickup.id);
      this.view?.setCollectibleVisible(pickup.id, false);
      this.audioDirector.push({ kind: 'pickup', index: this.run.snapshot().collected });
      if (this.run.allCollected) this.options.ui.toast('ALL PICKUPS COLLECTED');
      this.log?.info('game', 'pickup collected', { id: pickup.id, collected: this.run.snapshot().collected });
    }

    const goal = this.definition.goal;
    if (!goal || this.run.isFinished) return;
    // The finish only counts once the route is behind you, so a goal near the
    // spawn is not a way to skip the district.
    if (!this.run.armed) return;
    const reach = this.config.goal;
    if (withinTrigger(this.player.position, goal.position, reach.radius, reach.heightTolerance)) {
      this.completeRun();
    }
  }

  /** The run in progress: the clock, the pickups and the record. */
  get runSnapshot(): RunSnapshot {
    return this.run.snapshot();
  }

  /** What the player has chosen. */
  get currentSettings(): GameSettings {
    return this.settings;
  }

  /**
   * Applies settings, in whole or in part.
   *
   * The one entry point for every setting, and it is deliberately total: a patch
   * is merged over what is in force, normalised (so nothing out of range can be
   * introduced from a slider or a URL), pushed to everything that reads it, saved,
   * and reported back. Changing the field of view from the pause menu therefore
   * takes effect on the frame it is changed, without a restart.
   *
   * @returns the settings actually in force, which may differ from the patch.
   */
  updateSettings(
    patch: Partial<Omit<GameSettings, 'volumes'>> & { volumes?: Partial<VolumeSettings> },
  ): GameSettings {
    const next = normaliseSettings({
      ...this.settings,
      ...patch,
      volumes: { ...this.settings.volumes, ...(patch.volumes ?? {}) },
    });
    this.settings = next;
    this.motionConfig = withMotionScale(this.config, MOTION_SCALES[next.motion]);

    this.options.input.setBindings(next.bindings);
    this.domInput.setBindings(next.bindings);
    this.audioOutput.setVolumes(next.volumes);
    this.view?.setFov(next.fov);
    this.view?.setQuality(QUALITY_PRESETS[next.quality]);

    const stored = writeSettings(this.store, next);
    this.log?.info('game', 'settings applied', {
      quality: next.quality,
      motion: next.motion,
      fov: next.fov,
      saved: stored,
    });
    this.options.onSettingsChange?.(next);
    return next;
  }

  /**
   * Puts every setting back to what the demo ships with.
   *
   * A reset that only reset the sliders would be a lie: the bindings are a setting
   * too, and the reason to reach for this button is that the game has stopped
   * responding the way the player expects.
   */
  resetSettings(): GameSettings {
    return this.updateSettings(DEFAULT_SETTINGS);
  }

  private updateGameHud(): void {
    const run = this.run.snapshot();
    this.options.gameHud.update({
      health: this.player.health,
      maxHealth: this.config.fallDamage.maxHealth,
      checkpoint: this.player.checkpoint,
      checkpointCount: this.definition.checkpoints.length,
      elapsedSeconds: run.elapsedSeconds,
      running: run.started && !run.finished,
      collected: run.collected,
      collectibleCount: run.collectibleCount,
      goalArmed: run.goalArmed,
      prompt: this.elevatorPrompt,
    });
  }

  private handleRespawn(): void {
    this.log?.info('game', 'player respawned', { deaths: this.player.deaths });
    this.options.ui.hideDeath();
  }

  /** Returns the player to the spawn point without going through death. */
  respawn(): void {
    respawnPlayer(this.player, this.config);
    this.accumulator.reset();
    this.options.ui.hideDeath();
    this.audioDirector.reset();
    this.audioOutput.silence();
    this.log?.info('game', 'respawned on request');
  }

  /**
   * Crosses the finish line.
   *
   * The clock stops, the record is weighed and written, and the world freezes
   * behind the results screen - the same shape as pausing, because a finished run
   * is a paused run with a story to tell.
   */
  private completeRun(): void {
    const result = this.run.finish();
    if (!result) return;

    writeBestTime(this.options.store, result.bestSeconds);
    this.log?.info('game', 'run complete', {
      seconds: Math.round(result.seconds * 100) / 100,
      collected: result.collected,
      of: result.collectibleCount,
      improved: result.improved,
    });

    // The completion chord is queued before the status changes, because the
    // audio path only runs while the game is playing.
    this.audioDirector.push({ kind: 'complete' });
    this.updateAudio(0);
    this.renderFrame();

    this.setStatus('completed');
    this.options.input.clear();
    this.domInput.exitPointerLock();
    this.options.ui.showComplete(result);
    this.updateGameHud();
  }

  private resetSimulation(): void {
    this.level = buildLevel(this.definition, {
      maxSubStep: this.config.world.maxCollisionSubStep,
      player: standingSize(this.config.player),
    });
    this.climbables = collectClimbableIds(this.level.colliders);
    this.pipes = collectPipeIds(this.level.colliders);
    this.doors = new DoorSystem(this.definition.doors ?? [], this.level.world);
    this.elevators = new ElevatorSystem(this.definition.elevators ?? [], this.level.world, {
      speed: this.config.elevator.speed,
      doorSeconds: this.config.elevator.doorSeconds,
    });
    this.run.begin();
    this.effectsSeconds = 0;
    resetPlayerState(this.player, this.config);
    this.audioDirector.reset();
    this.audioOutput.silence();
    this.accumulator.reset();
    this.stats.reset();
    this.lastHudUpdate = 0;
    this.sprinting = false;
    this.options.input.clear();
    this.motion.reset();
    this.applyWorldState();
  }

  /**
   * Pushes the world's movable state to a freshly created view.
   *
   * A view is rebuilt on every restart, so everything the game has changed since
   * the level was authored - which door is open, where the lifts are, which
   * pickups are gone - has to be told to it again.
   */
  private applyWorldState(): void {
    if (!this.view) return;
    for (const door of this.doors.snapshot()) this.view.setDoorOpen(door.id, door.open);
    for (const car of this.elevators.snapshot()) {
      this.view.setElevator(car.id, car.topY, car.floor, car.doorsOpen);
    }
    for (const pickup of this.collectibles) {
      this.view.setCollectibleVisible(pickup.id, !this.run.hasCollected(pickup.id));
    }
  }

  private ensureView(): void {
    if (this.view) return;

    const canvas = document.createElement('canvas');
    canvas.className = 'game-canvas';
    canvas.setAttribute('aria-label', 'Cyberparkour game viewport');
    this.options.host.append(canvas);

    try {
      this.view = this.options.createView(canvas, this.definition, this.config);
      // Settings outlive views - a restart builds a new one - so every view is
      // told what the player chose the moment it exists.
      this.view.setFov(this.settings.fov);
      this.view.setQuality(QUALITY_PRESETS[this.settings.quality]);
    } catch (error) {
      canvas.remove();
      throw error instanceof GraphicsUnavailableError
        ? error
        : new GraphicsUnavailableError('The 3D view could not be created.', error);
    }

    this.canvas = canvas;
    canvas.addEventListener('webglcontextlost', this.handleContextLost);

    const { width, height } = this.hostSize();
    this.view.setSize(width, height);

    this.attachResizeHandling();
  }

  private disposeView(): void {
    this.canvas?.removeEventListener('webglcontextlost', this.handleContextLost);
    this.view?.dispose();
    this.view = null;
    this.canvas?.remove();
    this.canvas = null;
  }

  private attachResizeHandling(): void {
    globalThis.removeEventListener('resize', this.handleResize);
    globalThis.addEventListener('resize', this.handleResize);

    if (this.resizeObserver === null && typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.handleResize());
      this.resizeObserver.observe(this.options.host);
    }

    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  }

  private hostSize(): { width: number; height: number } {
    const rect = this.options.host.getBoundingClientRect();
    return {
      width: rect.width > 0 ? rect.width : globalThis.innerWidth || 1280,
      height: rect.height > 0 ? rect.height : globalThis.innerHeight || 720,
    };
  }

  private handleResize = (): void => {
    if (!this.view) return;
    const { width, height } = this.hostSize();
    this.view.setSize(width, height);
    this.renderFrame();
  };

  private handleVisibilityChange = (): void => {
    if (document.hidden && this.status === 'playing') this.pause('tab-hidden');
  };

  private handlePointerLockChange(locked: boolean): void {
    const lost = this.hadPointerLock && !locked;
    this.hadPointerLock = locked;

    // Losing a lock we actually held (typically Esc) is the player asking to
    // pause. Never having had one is not.
    if (lost && this.status === 'playing') this.pause('pointer-lock-lost');
  }

  private handleContextLost = (event: Event): void => {
    event.preventDefault();
    this.reportFatal(
      new Error('The WebGL context was lost (the GPU driver reset or reclaimed memory).'),
      'webgl-context-lost',
    );
  };

  private handleFrameError(error: unknown): boolean {
    this.reportFatal(error, 'game-loop');
    // Stop the loop: a broken frame would otherwise repeat forever.
    return false;
  }

  private reportFatal(error: unknown, source: 'startup' | 'game-loop' | 'webgl-context-lost'): void {
    // Presentation is not handled here: `CrashReporter.onCapture` (wired up in
    // `main.ts`) is the single place that puts the crash screen in front of the
    // player, so errors raised outside the game loop get it too.
    this.options.crashReporter.capture(error, { source, severity: 'fatal' });
    this.setStatus('crashed');
    this.loop.stop();
    this.disposeView();
    this.domInput.exitPointerLock();
  }

  private setStatus(status: GameStatus): void {
    if (this.status === status) return;
    const previous = this.status;
    this.status = status;
    this.log?.debug('game', `status ${previous} -> ${status}`);
    this.options.onStatusChange?.(status);
  }

  // ---------------------------------------------------------------- frame

  private handleFrame(delta: number): void {
    this.processActions();
    if (this.status !== 'playing') return;

    // Mouse look happens once per frame; the simulation may run several steps.
    const pointer = this.options.input.consumePointerDelta();
    if (pointer.dx !== 0 || pointer.dy !== 0) {
      applyLook(this.player, pointer.dx, pointer.dy, {
        // A multiplier rather than an absolute: the tuned base is a good default,
        // and "twice as fast as the tuned base" survives the base being retuned.
        sensitivity: this.config.camera.sensitivity * this.settings.sensitivity,
        invertY: this.settings.invertY,
        maxPitch: this.config.camera.maxPitch,
      });
    }

    const moveInput = this.options.input.moveInput;
    this.sprinting = moveInput.sprint;

    const moving =
      Math.hypot(this.player.velocity.x, this.player.velocity.z) > 0.25 ||
      moveInput.forward !== 0 ||
      moveInput.right !== 0;

    // The simulated time this frame actually covered. Not `steps * step`: a run
    // that finishes part-way through a frame stops simulating, and the remaining
    // sub-steps are not part of it.
    let simulated = 0;

    this.accumulator.run(delta, (dt) => {
      if (this.status !== 'playing') return;
      simulated += dt;

      // Lifts move first, so a rider is carried *before* the step that decides
      // what they are standing on - otherwise the floor would slide out from
      // under them for a frame every time one started.
      this.updateElevators(dt);

      const outcome = stepPlayer(this.player, moveInput, dt, this.stepOptions());
      if (outcome.died) this.handleDeath();
      else if (outcome.respawned) this.handleRespawn();
      if (outcome.landing) this.handleLanding(outcome.landing.impact, outcome.landing.damage);
      if (outcome.started) this.audioDirector.maneuverStart(outcome.started);
      if (outcome.ended) this.audioDirector.maneuverEnd(outcome.ended);
      if (outcome.checkpoint !== null) this.handleCheckpoint(outcome.checkpoint);

      this.run.tick(dt, moving);
      this.updateTriggers();
    });

    this.updateEffects(simulated);
    this.effectsSeconds += simulated;
    this.updateAudio(simulated);
    this.trackMotion();
    const swing = this.doors.update(simulated);
    for (const change of swing) this.view?.setDoorOpen(change.id, change.open);
    this.view?.animate(this.effectsSeconds);
    this.stats.push(delta);
    this.renderFrame(delta);
    this.updateHud();
  }

  /**
   * Moves the lifts, and takes their passengers with them.
   *
   * The carry is a plain translation of the player by however far the platform
   * moved, and it only happens for the lift the player is *standing on*: a player
   * in the air above a rising lift should be caught by it, not dragged up by it.
   */
  private updateElevators(dt: number): void {
    const feet = this.player.position;
    // Which car the player is in, asked once: the system owns the rule, so the game and
    // the tests cannot disagree about what "riding" means.
    const riding = this.elevators.riding(feet);
    const riders = new Set(riding === null ? [] : [riding]);
    for (const car of this.elevators.update(dt)) {
      // Whoever is standing on the car rides with it - and only them: a player in the air
      // above a rising car should be caught by it, not dragged up by it.
      //
      // "Standing on it" is not simply `groundId === car.id`, because a car docked at a
      // floor is *flush* with the floor it serves: its top and the deck's top are the same
      // height, the physics picks whichever collider comes first, and on a city street
      // that is the street. So the test is where the player is, not what the bookkeeping
      // says: inside the car's footprint, and on its roof.
      if (riders.has(car.id) && car.deltaY !== 0) carryRider(this.player, car.deltaY);
      this.view?.setElevator(car.id, car.topY, car.floor, car.doorsOpen);
    }
    this.refreshElevatorPrompt();
  }

  /**
   * What the player can do with the lift in front of them.
   *
   * Worked out fresh every frame rather than kept as state, because it is a fact
   * about where they are standing: a prompt that has to be cleared is a prompt that
   * gets left on the screen.
   */
  private refreshElevatorPrompt(): void {
    if (this.status !== 'playing') return;
    const near = this.elevators.approach(this.player.position);
    if (!near) {
      this.elevatorPrompt = null;
      return;
    }

    const inside = this.elevators.riding(this.player.position);
    if (inside) {
      const floors = this.elevators.floors(inside);
      const here = this.elevators.floorOf(inside) ?? 0;
      this.elevatorPrompt = {
        kind: 'select',
        title: 'SELECT A FLOOR',
        detail: floors
          .map((floor, index) => `${index + 1} ${floor.name}${index === here ? ' *' : ''}`)
          .join('  ·  '),
      };
      return;
    }

    const floors = this.elevators.floors(near.id);
    const name = floors[near.floor]?.name ?? 'this floor';
    this.elevatorPrompt = {
      kind: near.docked ? 'enter' : 'call',
      title: near.docked ? 'LIFT HERE' : 'LIFT AWAY',
      detail: near.docked ? `Walk in - ${name}` : 'Press E to call it',
    };
  }

  /**
   * Sends a lift to the floor the player is standing on, if they are at one.
   *
   * @returns whether a car was called.
   */
  private callElevator(): boolean {
    const near = this.elevators.approach(this.player.position);
    if (!near || near.docked) return false;
    const called = this.elevators.call(near.id, near.floor);
    if (called) {
      this.playCue({ kind: 'ui-click' });
      this.options.ui.toast(`LIFT CALLED - ${this.elevators.floors(near.id)[near.floor]?.name ?? ''}`);
    }
    return called;
  }

  /**
   * Sends the car the player is standing in to a floor.
   *
   * @returns whether the car is on its way.
   */
  private sendElevator(floor: number): boolean {
    const inside = this.elevators.riding(this.player.position);
    if (!inside) return false;
    const car = this.elevators.call(inside, floor);
    if (car) {
      const name = this.elevators.floors(inside)[floor]?.name ?? '';
      this.playCue({ kind: 'checkpoint' });
      this.options.ui.toast(`LIFT TO ${name.toUpperCase()}`);
    }
    return car;
  }

  /**
   * Describes the body to the camera effects, once a frame.
   *
   * Read from the *player's* own state rather than from a count of events, so the
   * effects follow a wall run or a slide for as long as it lasts without anybody
   * having to say when it started and stopped.
   */
  private updateEffects(dt: number): void {
    // The pose is derived first: the camera's lean is one of the things it says.
    describePose(this.player, this.config, this.scratchPose, gaitPhaseAt(this.player, this.accumulator.alpha));
    const sample = this.scratchSample;
    const speed = Math.hypot(this.player.velocity.x, this.player.velocity.z);
    sample.speedFraction = speed / Math.max(1e-6, this.config.player.sprintSpeed);
    sample.crouching = this.player.crouching;
    sample.slideFraction = this.player.sliding ? 1 : 0;
    sample.wallRunFraction =
      this.player.wallId === null
        ? 0
        : Math.min(
            1,
            this.player.wallRunElapsed / Math.max(1e-6, this.config.maneuver.wallRun.maxSeconds),
          );
    // The lean wants the same answer the body's does, so it is taken from the pose
    // rather than worked out a second way - two derivations of "which side" is one
    // more than can be kept consistent.
    sample.wallRunSide = this.scratchPose.wallSide;
    this.effects.update(dt, sample, this.config.cameraEffects, MOTION_SCALES[this.settings.motion]);
  }

  /**
   * Watches the movement state machine and complains about illegal moves.
   *
   * An illegal transition is a bug in one of the abilities - the kind that is
   * otherwise invisible until a play session feels wrong. Naming it in the log
   * turns it into something a crash report carries.
   */
  private trackMotion(): void {
    const change = this.motion.update(this.player);
    if (change.illegal) {
      this.log?.warn('movement', 'illegal transition', {
        from: change.illegal.from,
        to: change.illegal.to,
      });
    }
  }

  /** Plays the cues this frame produced and updates the continuous wind. */
  private updateAudio(simulatedSeconds: number): void {
    if (this.status !== 'playing') return;

    let frame;
    try {
      frame = this.audioDirector.update(this.player, simulatedSeconds);
    } catch (error) {
      logger.warn('audio', 'the audio director failed', { error: String(error) });
      return;
    }

    for (const cue of frame.cues) this.playCue(cue);
    this.audioOutput.setWind(frame.windIntensity);
  }

  private playCue(cue: AudioCue): void {
    try {
      this.audioOutput.play(cue);
    } catch (error) {
      // Sound must never be able to stop the game.
      logger.debug('audio', 'cue failed', { cue: cue.kind, error: String(error) });
    }
  }

  private renderFrame(dt = 0): void {
    if (!this.view) return;

    const feet = interpolatePlayerPosition(this.player, this.accumulator.alpha, this.scratchFeet);
    // Eye height follows the stance and the head bob, so crouching visibly drops
    // the camera and running visibly rocks it.
    // The gait phase at the moment being drawn, not at the last simulation step: on a
    // display faster than the tick rate the difference is a stutter you can see.
    const gaitPhase = gaitPhaseAt(this.player, this.accumulator.alpha);
    eyePosition(this.player, this.motionConfig, this.scratchEye, feet, gaitPhase);

    // The camera effects are a *view* offset on top of that: they never move the
    // player, so a shake cannot be mistaken for the body moving.
    const frame = this.effects.current;
    this.scratchEye.x += frame.offsetX;
    this.scratchEye.y += frame.offsetY;
    this.scratchEye.z += frame.offsetZ;

    this.scratchOrientation.yaw = this.player.yaw;
    this.scratchOrientation.pitch = this.player.pitch;
    this.scratchOrientation.roll = frame.roll;

    // The field of view is the setting plus whatever the effects are doing with it,
    // and `setFov` ignores a value it already has - so a frame that changes nothing
    // does not touch the projection matrix.
    this.view.setFov(this.settings.fov + frame.fov);

    // The body goes where the *interpolated* player is, not where the last
    // simulation step left them, or it would jitter against the camera.
    this.view.setPlayerBody(
      feet,
      this.player.yaw,
      describePose(this.player, this.config, this.scratchPose, gaitPhase),
      dt,
    );

    this.view.render(this.scratchEye, this.scratchOrientation);
  }

  /** The play HUD lives next to the health and the checkpoints, not the debug rows. */
  private updateHud(): void {
    // The play HUD moves every frame. Its clock is the whole point of the time
    // trial, and a timer that ticks ten times a second reads as broken; the rest
    // of it is a handful of text nodes and a transform, written only when they
    // change. The debug overlay is the expensive one - a dozen rows of measured
    // text - so it keeps its 10 Hz budget.
    this.updateGameHud();

    const stats = this.stats.snapshot();
    const interval = 1 / Math.max(1, this.config.debug.hudRefreshHz);
    if (stats.elapsedSeconds - this.lastHudUpdate < interval) return;
    this.lastHudUpdate = stats.elapsedSeconds;
    this.options.hud.update(this.hudSnapshot(stats));
  }

  private hudSnapshot(stats: StatsSnapshot): HudSnapshot {
    const player = snapshotPlayer(this.player);
    return {
      fps: stats.fps,
      frameTimeMs: stats.frameTimeMs,
      worstFrameTimeMs: stats.worstFrameTimeMs,
      position: player.position,
      velocity: player.velocity,
      speed: player.speed,
      yaw: player.yaw,
      pitch: player.pitch,
      grounded: player.grounded,
      groundId: player.groundId,
      stance: player.stance,
      locomotion: player.locomotion,
      sprinting: this.sprinting,
      alive: player.alive,
      deaths: player.deaths,
      health: player.health,
      maxHealth: this.config.fallDamage.maxHealth,
      frameCount: stats.frames,
      elapsedSeconds: stats.elapsedSeconds,
      renderer: this.rendererInfo,
    };
  }

  private processActions(): void {
    for (const action of this.options.input.consumeActions()) {
      // The lift's floor buttons are one action each (`floor1`..`floor8`), so they are
      // caught here rather than as eight arms of the switch below.
      const floor = floorFromAction(action);
      if (floor !== null) {
        if (this.status === 'playing') this.sendElevator(floor);
        continue;
      }

      switch (action) {
        case 'toggleDebug': {
          const visible = this.options.hud.toggle();
          this.log?.info('game', `debug hud ${visible ? 'shown' : 'hidden'}`);
          break;
        }
        case 'mute': {
          this.muted = !this.muted;
          this.audioOutput.setMuted(this.muted);
          this.options.ui.toast(this.muted ? 'Sound muted (M)' : 'Sound on (M)');
          break;
        }
        case 'interact': {
          // Works whichever door the player is standing next to, if any. Doing
          // nothing when there is none is correct: there is no "use" target, so
          // there is nothing to report.
          //
          // Only while playing: on the title screen, or frozen behind a results
          // screen, a stray E must not swing a door somewhere off-camera.
          if (this.status !== 'playing') break;
          if (this.callElevator()) break;
          const worked = this.doors.toggleNear(this.player.position);
          if (worked !== null) this.log?.debug('game', 'door worked', { door: worked });
          break;
        }
        case 'pause':
          // Esc is normally caught by the pointer-lock exit; this covers the
          // case where pointer lock was never acquired.
          this.pause('key');
          break;
        case 'restart':
          if (this.status !== 'ended') this.restart();
          break;
        default:
          break;
      }
    }
  }
}

