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
import {
  formatRunTime,
  readBestTime,
  writeBestTime,
  withinTrigger,
  RunState,
  type RunSnapshot,
  type TimeStore,
} from './run.js';
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
  type PlayerStepOptions,
} from './player.js';
import { GraphicsUnavailableError, type CreateView, type GameViewLike } from '../render/types.js';
import type { ElevatorPrompt, GameHud } from '../ui/gameHud.js';
import type { DebugHud, HudSnapshot } from '../ui/hud.js';
import type { GameUi } from '../ui/screens.js';

export type GameStatus = 'idle' | 'playing' | 'paused' | 'completed' | 'ended' | 'crashed';

/** How long the phone call runs, in seconds: raise, answer, and the announcement. */
const SECRET_CALL_SECONDS = 4.5;

/**
 * One step of a critically damped spring, for the one thing the camera smooths.
 *
 * No overshoot and no corner: the whole reason the eye's height is sprung rather than lerped is that
 * a lerp has a velocity of its own, and a camera that arrives with a velocity is a camera that
 * bounces.
 */
function springTowards(current: number, rate: number, target: number, dt: number): number {
  const step = Math.min(1 / 30, Math.max(0, dt));
  const velocity = (target - current) * (1 - Math.exp(-rate * step));
  return current + velocity;
}

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

/**
 * Dynamic resolution: how far the drawing buffer may drop below the preset's cap.
 *
 * A floor rather than nothing, because below this the picture is a smear and a settings change is
 * the honest answer; and 0.6 still leaves a 1080p window drawing most of a million pixels.
 */
const MIN_RENDER_SCALE = 0.6;
/** A frame worse than this is a dropped refresh at 60 Hz, and the signal to take resolution down. */
const LATE_FRAME_MS = 24;
/** This good for long enough means there is room to give some back. */
const EASY_FRAME_MS = 19;

/** `PlayerStepOptions` with its `readonly` lifted, for the cached object `stepOptions` hands out. */
type MutableStepOptions = { -readonly [K in keyof PlayerStepOptions]: PlayerStepOptions[K] };

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
  /** The ones the cat asks for: everything except the secret. */
  private readonly questCollectibles: readonly CollectibleDefinition[];
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
  /** The step options, kept across frames - see `stepOptions`. */
  private stepOptionsCache: MutableStepOptions | null = null;
  /**
   * The resolution the view is drawing at, as a fraction of its preset's cap.
   *
   * The game owns this rather than the view because the *frame statistics* that decide it live
   * here; the view owns the renderer that obeys it. See `adaptResolution`.
   */
  private renderScale = 1;
  /** When the last adaptation step was taken. */
  private lastAdaptAt = 0;
  /** When resolution was last given back, and how long to wait before trying again. */
  private lastScaleUpAt = 0;
  private scaleUpCooldownMs = 10_000;
  /**
   * What each lift's meshes were last told, so an idle shaft costs nothing.
   *
   * Reused objects rather than a fresh record per car: this is read on the simulation step, and a
   * step is not a place to allocate ninety of anything.
   */
  private readonly elevatorShown = new Map<
    string,
    { topY: number; floor: number; doorsOpen: number }
  >();
  /** Whether the player has muted the demo. */
  private muted = false;
  /**
   * The `?perf` readout, if it was asked for.
   *
   * A URL flag rather than a settings item on purpose: it is a diagnostic, it is not part of the game,
   * and someone who wants it can type it. It reports to the console as well as to the corner of the
   * screen, so the numbers survive a screenshot of nothing but the log.
   */
  /** The run time the play HUD was last written at, for its 10 Hz budget. */
  private lastGameHud = -Infinity;

  private readonly perfEnabled = typeof location !== 'undefined' && /[?&]perf\b/.test(location.search);
  private perfElement: HTMLElement | null = null;
  private perfRenderMs = 0;
  /** All the work the frame did on this thread, which is what tells CPU from GPU. */
  private perfWorkMs = 0;
  /** Wall clock between frames: pinned to the display's refresh unless the frame is missing it. */
  private perfIntervalMs = 0;
  /** When the current frame began, for `perfWorkMs`. */
  private perfFrameStart = 0;
  private perfText = '';
  private perfShownAt = 0;
  private perfMarkAt = 0;
  private perfLastAt = 0;
  /** Smoothed milliseconds per section of the frame: everything before the render, then the render, then the HUD. */
  private readonly perfSections = { anim: 0, render: 0, hud: 0 };

  /** The smoothed eye height, and how fast it catches up. */
  private eyeSpring = Number.NaN;
  private readonly eyeRate = 20;

  /** Seconds left in the secret phone call, and whether anybody has picked up. */
  private secretCall = 0;
  private secretAnswered = false;
  /** The trial in progress, and how far into it the player is. */
  private activeTrial: { id: string; startedAt: number; starTimes: readonly [number, number, number] } | null = null;
  private trialElapsed = 0;
  /** Best stars per trial, for this session. */
  private readonly trialBests = new Map<string, number>();
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

    // **Validated once, and kept.** An authoring mistake must surface at boot rather than on the
    // first frame, so the level is built (and so validated) here - and then *reused* for every
    // run rather than rebuilt. The colliders and the collision world are immutable, so a restart
    // only has to return the movable systems to their starting state; rebuilding them was ~105 ms
    // of duplicate work per `Game`, and the constructor is on the boot path.
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
    // The counter is the cat's eight, not the level's list: a secret counted on the HUD is not a
    // secret, and "0 / 11" tells the player there is one they have not been told about.
    this.questCollectibles = this.collectibles.filter((pickup) => !pickup.id.startsWith('secret-'));
    this.run = new RunState({
      checkpointCount: this.definition.checkpoints.length,
      collectibleCount: this.questCollectibles.length,
      hasNpc: Boolean(this.definition.npc),
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

  /** Starts a fresh run from the spawn point, keeping the world it is played in. */
  restart(): void {
    this.log?.info('game', 'restarting', { from: this.status, keepView: this.view !== null });

    // **A restart is a new run, not a new world.**
    //
    // This used to throw the view away and build it again: about six hundred milliseconds merging
    // the city into chunks, a hundred and sixty rebuilding the level, a full re-upload of every
    // texture and a fresh compile of every shader - to arrive back at the same picture. The scene
    // is deterministic and nothing in it has been lost; the game pushes the world state it owns
    // back into it (`applyWorldState`) instead. A view that is *gone* - a crash, a lost context,
    // the end of a session - is built again, because there is nothing there to keep.
    try {
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

  /**
   * The options every `stepPlayer` call is handed.
   *
   * **Kept, not built.** This used to return a fresh nine-key object per simulation step - sixty a
   * second, for a value that only changes when the level is rebuilt - and a step is the one place
   * in the game that is supposed to allocate nothing. The cache is dropped by `resetSimulation`,
   * which is the only thing that can change what is in it.
   */
  private stepOptions(): MutableStepOptions {
    const cached = this.stepOptionsCache;
    if (cached) return cached;

    const options: MutableStepOptions = {
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
    this.stepOptionsCache = options;
    return options;
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
    const strength = Math.min(1, Math.max(0, (impact - safeImpactSpeed) / span));
    this.effects.land(strength, this.config.cameraEffects);
    // ...and so does the ground: a ring of dust from the feet, scaled by the same number, so what
    // the eye sees and what the camera feels are the same event. Only above a threshold, so a step
    // off a kerb is silent rather than puffy.
    if (strength > 0.12) {
      const feet = this.player.position;
      this.view?.burstDust?.(
        feet.x,
        feet.y,
        feet.z,
        strength,
        // A harder landing throws its dust further, but not without limit: a spread past a couple
        // of metres reads as an explosion rather than a footfall.
        0.8 + strength * 1.6,
      );
    }
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

      const secret = pickup.id.startsWith('secret-');
      if (!this.run.collect(pickup.id, { secret })) continue;
      if (secret) this.beginSecretCall();
      else this.options.ui.flash('#57e0ff');
      this.view?.setCollectibleVisible(pickup.id, false);
      this.audioDirector.push({ kind: 'pickup', index: this.run.snapshot().collected });
      // With a cat in the level, having them all is the *middle* of the quest rather than the end of
      // it: the last shard is the point at which the player has to go back, and the HUD says so.
      if (this.run.allCollected) {
        this.options.ui.toast(
          this.definition.npc ? 'All of them. The cat is waiting.' : 'ALL PICKUPS COLLECTED',
        );
      }
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
      // Where the nearest one is that nobody has taken: eight shards on a kilometre of rooftops
      // are findable by accident and unfindable on purpose, and the map is four times the size
      // they were placed for.
      hint: this.nearestShard(),
      trial: this.currentTrial,
      calling: this.calling,
    });
  }

  private handleRespawn(): void {
    this.log?.info('game', 'player respawned', { deaths: this.player.deaths });
    this.options.ui.hideDeath();
  }

  /** Returns the player to the spawn point without going through death. */
  respawn(): void {
    respawnPlayer(this.player, this.config);
    this.eyeSpring = Number.NaN;
    this.accumulator.reset();
    // The dust from the landing that killed them is left behind where they died, not carried to
    // the spawn point.
    this.view?.clearDust?.();
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
    // **The level is not rebuilt.** It is built once in the constructor and kept: the colliders
    // and the collision world never change, so a new run only needs the *movable* state put back
    // where it started - which door is open, where each lift is, which pickups are gone. This
    // used to rebuild the level and both systems, which was ~105 ms per call on a 12,000-prop
    // city and pure waste, because `DoorSystem.reset` and `ElevatorSystem.reset` restore exactly
    // that state without touching the immutable half.
    this.doors.reset();
    this.elevators.reset();
    this.stepOptionsCache = null;
    this.run.begin();
    this.effectsSeconds = 0;
    resetPlayerState(this.player, this.config);
    this.eyeSpring = Number.NaN;
    this.audioDirector.reset();
    this.audioOutput.silence();
    this.accumulator.reset();
    this.stats.reset();
    this.lastHudUpdate = 0;
    this.sprinting = false;
    this.options.input.clear();
    this.motion.reset();
    // A new run starts with clean air: last run's dust has no business hanging over this one.
    this.view?.clearDust?.();
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
    // Everything is being pushed, so nothing has been told anything yet.
    this.elevatorShown.clear();
    for (const car of this.elevators.snapshot()) {
      this.view.setElevator(car.id, car.topY, car.floor, car.doorsOpen);
      this.elevatorShown.set(car.id, {
        topY: car.topY,
        floor: car.floor,
        doorsOpen: car.doorsOpen,
      });
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
    // A new view starts at its preset's resolution, and at a fresh opinion about the machine.
    this.renderScale = 1;
    this.lastAdaptAt = 0;
    this.lastScaleUpAt = 0;
    this.scaleUpCooldownMs = 10_000;
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
    if (this.perfEnabled) this.perfFrameStart = performance.now();
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

    if (this.perfEnabled) this.perfMark();
    this.updateEffects(simulated);
    this.effectsSeconds += simulated;
    this.updateAudio(simulated);
    this.trackMotion();
    const swing = this.doors.update(simulated);
    for (const change of swing) this.view?.setDoorOpen(change.id, change.open);
    this.view?.animate(this.effectsSeconds, simulated);
    this.stats.push(delta);
    // After the statistics, not after the HUD: this is decided by the frame, not by the overlay
    // that reports it.
    this.adaptResolution();
    if (this.perfEnabled) this.perfSection('anim');
    this.renderFrame(delta);
    if (this.perfEnabled) this.perfSection('render');
    this.updateHud();
    if (this.perfEnabled) this.perfSection('hud');

    // Everything this frame cost this thread, from the first line of it to the last - which is the
    // number that says whether the frame is missing on the CPU or on the GPU. See `measureFrame`.
    if (this.perfEnabled) {
      const now = performance.now();
      this.perfWorkMs += (now - this.perfFrameStart - this.perfWorkMs) * 0.15;
    }
  }

  /**
   * Starts timing a section of the frame, for the `?perf` readout.
   *
   * The call sites guard on `perfEnabled` rather than this getting called to do nothing: the
   * readout is off for every player who has not asked for it, and it must not cost them a clock
   * read per section per frame for a number nobody will read.
   */
  private perfMark(): void {
    this.perfMarkAt = performance.now();
  }

  /** Closes a timed section and adds it to the smoothed breakdown. */
  private perfSection(name: 'anim' | 'render' | 'hud'): void {
    if (!this.perfEnabled) return;
    const now = performance.now();
    const elapsed = now - this.perfMarkAt;
    this.perfMarkAt = now;
    this.perfSections[name] += (elapsed - this.perfSections[name]) * 0.15;
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
      // **Only what moved.** This ran for all ninety cars every step - five and a half thousand
      // calls a second, each walking eight gates of a lift that was standing still. A docked car
      // does not change what it looks like, so it is not told again.
      let shown = this.elevatorShown.get(car.id);
      if (!shown) {
        shown = { topY: Number.NaN, floor: -1, doorsOpen: Number.NaN };
        this.elevatorShown.set(car.id, shown);
      }
      if (shown.topY !== car.topY || shown.floor !== car.floor || shown.doorsOpen !== car.doorsOpen) {
        shown.topY = car.topY;
        shown.floor = car.floor;
        shown.doorsOpen = car.doorsOpen;
        this.view?.setElevator(car.id, car.topY, car.floor, car.doorsOpen);
      }
    }
    this.refreshElevatorPrompt();
  }

  /**
   * The nearest pickup still out there, as a bearing and a distance.
   *
   * Straight line rather than a route: the city is a grid, so the straight line *is* the route
   * within a street or two, and a pathfinder whose answer changes shape as buildings are added is
   * a worse guide than an arrow.
   */
  private nearestShard(): { bearing: number; distance: number } | null {
    // **What the pointer should point at, which changes with the quest.** Before the cat has asked,
    // the only useful thing on the HUD is the way to the cat; while the shards are out, it is the
    // nearest one; and once they are all in, it is the way back - which is what stops the last
    // shard being the end of the directions.
    const npc = this.definition.npc;
    if (npc) {
      const quest = this.run.questState;
      const shardsIn = this.run.snapshot().collected >= this.run.snapshot().collectibleCount;
      if (quest === 'none' || shardsIn) {
        const dx = npc.position.x - this.player.position.x;
        const dy = npc.position.y - this.player.position.y;
        const dz = npc.position.z - this.player.position.z;
        // **Three dimensions, not two.** The city is climbed, not walked: a shard on a roof forty
        // metres up is not "twelve metres away" because it is twelve metres horizontally, and a
        // readout that says so while the player stands under it reads as broken. The bearing stays
        // horizontal - an arrow points along the ground whoever the target is above.
        return { bearing: Math.atan2(dx, dz) - this.player.yaw, distance: Math.hypot(dx, dy, dz) };
      }
    }

    let best: { bearing: number; distance: number } | null = null;
    for (const shard of this.collectibles) {
      // **Not the secret.** A phone you are pointed at is not hidden, and the guide is the one thing
      // in the game that knows where everything is.
      if (shard.id.startsWith('secret-')) continue;
      if (this.run.hasCollected(shard.id)) continue;
      const dx = shard.position.x - this.player.position.x;
      const dy = shard.position.y - this.player.position.y;
      const dz = shard.position.z - this.player.position.z;
      // Which one is *nearest* is a 3D question for the same reason the readout is: the shard on the
      // roof above is closer than the one down the street.
      const distance = Math.hypot(dx, dy, dz);
      if (best && distance >= best.distance) continue;
      // Relative to where the player is looking, so "ahead" means ahead.
      best = { bearing: Math.atan2(dx, dz) - this.player.yaw, distance };
    }
    return best;
  }

  /**
   * The cat, if the player is standing in front of it.
   *
   * The quest-giver, and the finish: the goal stands in its courtyard, so the last thing the run
   * asks is that the player come back down and say so. A prompt rather than an automatic trigger,
   * because a quest that completes while you are running past the giver is not a conversation.
   */
  private nearNpc(): boolean {
    const npc = this.definition.npc;
    if (!npc) return false;
    const dx = npc.position.x - this.player.position.x;
    const dz = npc.position.z - this.player.position.z;
    const dy = npc.position.y - this.player.position.y;
    return Math.hypot(dx, dz) <= npc.reach && Math.abs(dy) <= 3;
  }

  /** What the cat has to say, which depends on how far along the quest is. */
  private npcPrompt(): ElevatorPrompt {
    const name = this.definition.npc?.name ?? 'the cat';
    if (this.run.questState === 'none') {
      return { kind: 'enter', title: name.toUpperCase(), detail: 'Press E - it has something to say' };
    }
    if (this.run.allCollected) {
      return { kind: 'enter', title: name.toUpperCase(), detail: 'Press E - you have them all' };
    }
    const left = Math.max(0, this.run.snapshot().collectibleCount - this.run.snapshot().collected);
    return { kind: 'call', title: name.toUpperCase(), detail: `${left} left to find` };
  }

  /**
   * What the player can do with the lift in front of them.
   *
   * Worked out fresh every frame rather than kept as state, because it is a fact about where they
   * are standing: a prompt that has to be cleared is a prompt that gets left on the screen.
   */
  private refreshElevatorPrompt(): void {
    if (this.status !== 'playing') return;
    if (this.nearNpc()) {
      this.elevatorPrompt = this.npcPrompt();
      return;
    }
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
   * Time trials: the gate you walk through, and the gate you have to reach.
   *
   * One at a time, started by walking into a start gate and finished by reaching its end gate. The
   * clock is the run's own, so a trial is a stretch of the run rather than a separate mode - and the
   * stars are thresholds rather than a score, because a route with a pace to it is a route you learn.
   */
  private updateTrials(): void {
    const trials = this.definition.trials;
    if (!trials || this.status !== 'playing' || !this.player.alive) return;

    if (this.activeTrial) {
      const trial = trials.find((entry) => entry.id === this.activeTrial?.id);
      if (!trial) {
        this.activeTrial = null;
        return;
      }
      const elapsed = this.run.snapshot().elapsedSeconds - this.activeTrial.startedAt;
      const reached = withinTrigger(this.player.position, trial.to, trial.reach, 6);
      if (!reached) {
        this.trialElapsed = elapsed;
        return;
      }

      const stars = elapsed <= trial.starTimes[0] ? 3 : elapsed <= trial.starTimes[1] ? 2 : elapsed <= trial.starTimes[2] ? 1 : 0;
      const previous = this.trialBests.get(trial.id) ?? 0;
      this.trialBests.set(trial.id, Math.max(previous, stars));
      this.activeTrial = null;
      this.trialElapsed = 0;
      this.audioDirector.push({ kind: 'checkpoint' });
      this.options.ui.toast(
        stars === 0
          ? `${formatRunTime(elapsed)} - not fast enough for a star`
          : `${'*'.repeat(stars)} in ${formatRunTime(elapsed)}`,
      );
      return;
    }

    for (const trial of trials) {
      if (!withinTrigger(this.player.position, trial.from, trial.reach, 6)) continue;
      this.activeTrial = {
        id: trial.id,
        startedAt: this.run.snapshot().elapsedSeconds,
        starTimes: trial.starTimes,
      };
      this.trialElapsed = 0;
      this.options.ui.toast('Go.');
      this.audioDirector.push({ kind: 'ui-click' });
      break;
    }
  }

  /** The trial in progress, if any: its id, and how long it has been running. */
  get currentTrial(): { readonly id: string; readonly elapsed: number; readonly stars: number } | null {
    const trial = this.activeTrial;
    if (!trial) return null;
    const stars = this.trialElapsed <= trial.starTimes[0] ? 3 : this.trialElapsed <= trial.starTimes[1] ? 2 : 1;
    return { id: trial.id, elapsed: this.trialElapsed, stars };
  }

  /**
   * The secret: the phone, and what happens when somebody finds it.
   *
   * A three-part performance. The player raises it - `secretCall` counts down, and while it does the
   * pose has the arm up and the camera has a handset in front of it - then the call is answered, and
   * then the announcement. It is the only scripted moment in the game, and it is meant to read as
   * one: everything else here is a mechanic and this is a *thing that happens*.
   */
  private beginSecretCall(): void {
    this.secretCall = SECRET_CALL_SECONDS;
    this.secretAnswered = false;
    this.options.ui.toast('A phone. Still warm.');
    this.audioDirector.push({ kind: 'pickup', index: 4 });
  }

  /** How far into the secret call the player is, for the pose and the overlay. */
  get calling(): boolean {
    return this.secretCall > 0;
  }

  /**
   * Says what there is to say to the cat.
   *
   * Three states, three answers: it asks you to bring the shards back, it tells you how many are
   * left, and it takes them. The count comes from the level rather than from the sentence - the city
   * has ten shards in it and the first version of this said "eight", which is the kind of thing a
   * player notices immediately and a test does not. The last one is the level - the goal stands where the cat does -
   * so the return trip is the finish rather than a separate errand.
   */
  private talkToCat(): boolean {
    const answer = this.run.talkToNpc();
    if (answer === 'accepted') {
      const count = this.questCollectibles.length;
      this.options.ui.toast(
        `The cat wants ${count} ${count === 1 ? 'shard' : 'shards'}, and is not asking politely.`,
      );
      this.audioDirector.push({ kind: 'checkpoint' });
    } else if (answer === 'reported') {
      this.options.ui.toast('The cat has them all. This is where the night started.');
      this.audioDirector.push({ kind: 'checkpoint' });
    } else {
      const left = Math.max(0, this.run.snapshot().collectibleCount - this.run.snapshot().collected);
      this.options.ui.toast(left === 0 ? 'Not yet.' : `${left} still out there.`);
    }
    return true;
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
    // The phone: an arm comes up and stays up. It is the one scripted pose in the game, and it is
    // applied *over* whatever the movement asked for rather than instead of it, so the player can
    // still walk while they are on the call.
    if (this.calling) this.scratchPose.armAction = 'phone';
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
    // The one effect that is not the camera: the vignette is a screen-space overlay, so the number
    // goes to the UI. Pushed here rather than in the render path because it is state, not a
    // transform - and guarded inside the UI, so a frame where it did not move writes nothing.
    this.options.ui.setSpeedVignette(this.effects.current.vignette);

    this.updateTrials();

    // ---- the secret call, if one is happening
    if (this.secretCall > 0) {
      this.secretCall = Math.max(0, this.secretCall - dt);
      const elapsed = SECRET_CALL_SECONDS - this.secretCall;
      if (!this.secretAnswered && elapsed >= 1.6) {
        this.secretAnswered = true;
        this.audioDirector.push({ kind: 'checkpoint' });
        this.options.ui.toast('Somebody picks up. They know your name.');
      }
      if (this.secretCall === 0) {
        // The announcement, and it is the last thing the game has to say.
        this.options.ui.showSecret();
      }
    }
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

    // **The eye's height is sprung, and nothing else is.**
    //
    // Every remaining discontinuity in what the player sees is vertical: a landing kills the fall
    // speed inside one simulation step, a mantle's arc is vertical, and a step up a kerb is vertical.
    // Measured on the eye trace at 240 Hz, a landing after a vault changes speed by ten and a half
    // metres a second between two frames - which is a snap, however correct the physics is.
    //
    // Only Y, deliberately. Springing the horizontal axes is what makes a camera feel like it is on
    // a rubber band, and the horizontal discontinuities are all *real* events - running into a wall
    // stops you, and it should.
    if (!Number.isFinite(this.eyeSpring)) this.eyeSpring = this.scratchEye.y;
    this.eyeSpring = springTowards(this.eyeSpring, this.eyeRate, this.scratchEye.y, dt);
    // **It may lag a fall, and it may not lag a rise.** A camera that trails *below* the height it
    // should be at is a camera inside the floor it is standing on, and the smoothing is only wanted
    // in one direction anyway: a landing snaps the eye's *velocity* to nothing in a single step,
    // which is the case this smooths, and every rise is already a smooth arc.
    this.eyeSpring = Math.min(this.eyeSpring, this.scratchEye.y + 0.001);
    this.eyeSpring = Math.max(this.eyeSpring, this.scratchEye.y - 0.4);
    // **And it is camera motion, so the setting applies to it.** The spring's whole effect is the
    // distance it trails by, so scaling the lag rather than the rate is what makes "no camera motion"
    // mean a rigid camera - which is what the setting promises, and what the test for it caught when
    // this was added without it.
    const motion = MOTION_SCALES[this.settings.motion];
    this.scratchEye.y = this.scratchEye.y + (this.eyeSpring - this.scratchEye.y) * motion;

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

    const renderStarted = this.perfEnabled ? performance.now() : 0;
    this.view.render(this.scratchEye, this.scratchOrientation);
    if (this.perfEnabled) this.measureFrame(performance.now() - renderStarted, dt);
  }

  /**
   * Takes the resolution down when the frame stops fitting, and gives it back when it does.
   *
   * **Because the machine changes under the player.** A 15-watt APU runs this scene at sixty frames
   * a second while it is cool and misses every second refresh once it is heat-soaked - measured on
   * this one at 59 °C and 87 °C, same view, 16.7 ms against 19.6 ms, with the GPU dropping from
   * 2,200 MHz to about 1,800. The player cannot see any of that, and the settings menu has no
   * "cooler" option, so the frame rate is the game's problem to hold. What it costs is resolution:
   * this is the one dial that buys frame time without touching the picture's composition.
   *
   * Deliberately asymmetric. Down is immediate and in 10% steps, because being late is being
   * wrong. Up waits for a long run of easy frames and doubles its own cooldown every time it has to
   * step back, so a machine that is only cool for a moment does not oscillate - a resolution that
   * flaps is worse than one that is slightly low.
   */
  private adaptResolution(): void {
    if (!this.view?.setRenderScale) return;
    const now = performance.now();
    if (now < this.lastAdaptAt) return;
    // A second of frames, and a full window of statistics behind it: the first seconds are shader
    // compiles and a level landing, not a measurement.
    const stats = this.stats.snapshot();
    // **Not the first seconds.** Shader compilation and the level landing are the worst frames the
    // game will ever have, and they say nothing about the machine: without this, every session
    // opened at 90% resolution because of a compile hitch that had already finished.
    if (stats.frames < 120 || stats.elapsedSeconds < 3) return;

    if (stats.worstFrameTimeMs > LATE_FRAME_MS && this.renderScale > MIN_RENDER_SCALE) {
      this.renderScale = Math.max(MIN_RENDER_SCALE, this.renderScale - 0.1);
      this.view.setRenderScale(this.renderScale);
      // Wait for the window to refill before judging again: `worstFrameTimeMs` holds the last two
      // seconds of frames, and stepping twice on the same late ones is how a controller oscillates.
      this.lastAdaptAt = now + 1500;
      this.lastScaleUpAt = now;
      this.scaleUpCooldownMs = Math.min(120_000, this.scaleUpCooldownMs * 2);
      return;
    }

    if (
      stats.worstFrameTimeMs < EASY_FRAME_MS &&
      this.renderScale < 1 &&
      now - this.lastScaleUpAt > this.scaleUpCooldownMs
    ) {
      this.renderScale = Math.min(1, this.renderScale + 0.05);
      this.view.setRenderScale(this.renderScale);
      this.lastScaleUpAt = now;
      this.lastAdaptAt = now + 1500;
      return;
    }

    this.lastAdaptAt = now + 1000;
  }

  /**
   * Keeps a smoothed account of where the frame's time goes, for the `?perf` readout.
   *
   * **Two numbers, because they have opposite fixes.** Time inside `view.render` is the GPU and the
   * draw submission - the part a graphics setting can change. Everything else in the frame is the
   * simulation, the pose, the HUD and the DOM, and no settings menu can touch it. A report of "twenty
   * frames a second" is only actionable once you know which of the two owns the frame.
   *
   * `renderMs` is measured directly; `otherMs` is the frame delta minus it, so it includes the browser's
   * own work and is an upper bound rather than a measurement of the simulation alone.
   */
  private measureFrame(renderMs: number, delta: number): void {
    if (!this.perfEnabled) return;
    const k = 0.15;
    this.perfRenderMs += (renderMs - this.perfRenderMs) * k;
    // **The real frame interval, not the simulation's.** `delta` is clamped by the accumulator, so
    // subtracting from it reports the clamp once a frame runs long - which is exactly when the number
    // matters. This is the wall clock between the end of the last frame and the end of this one.
    const nowMs = performance.now();
    const interval = this.perfLastAt === 0 ? delta * 1000 : nowMs - this.perfLastAt;
    this.perfLastAt = nowMs;
    // **Compared against the work, not subtracted from it.** A frame locked to the display spends
    // most of its interval waiting for the vertical blank, so "interval - render" reports a number
    // that looks like work and is really idle: on a 60 Hz screen it read 12 ms of nothing. The three
    // numbers together say which half is short - work near the interval is this thread, an interval
    // near 33 ms with work of 5 is the GPU - and no single one of them does.
    this.perfIntervalMs += (interval - this.perfIntervalMs) * k;

    // **Formatted four times a second, not every frame.** The readout is a diagnostic, and a
    // diagnostic that allocates a six-hundred-character string per frame is measuring itself: the
    // number it reports for "other" includes the string it is about to write.
    const now = performance.now();
    if (now - this.perfShownAt < 250) return;
    this.perfShownAt = now;

    const stats = this.view?.renderStats;
    this.perfText =
      `${(1000 / Math.max(0.001, this.perfIntervalMs)).toFixed(0)} fps` +
      ` | draw ${stats?.calls ?? 0} calls, ${Math.round((stats?.triangles ?? 0) / 1000)}k tris` +
      ` | ${this.perfWorkMs.toFixed(1)} ms work of ${this.perfIntervalMs.toFixed(1)} ms interval` +
      ` [render ${this.perfRenderMs.toFixed(1)} sim ${this.perfSections.anim.toFixed(1)}` +
      ` hud ${this.perfSections.hud.toFixed(1)}]` +
      ` | ${stats?.objects ?? 0} objects, ${stats?.chunksDrawn ?? 0}/${stats?.chunksTotal ?? 0} chunks` +
      `, ${stats?.movingDrawn ?? 0}/${stats?.movingTotal ?? 0} moving` +
      ` | ${stats?.programs ?? 0} programs | ${this.settings.quality}` +
      (this.renderScale < 1 ? ` (${Math.round(this.renderScale * 100)}% resolution)` : '') +
      ` | ${import.meta.env.DEV ? 'dev build' : 'production build'}` +
      // **What machine is this, and is it even using its graphics card.** A WebGL context that fell
      // back to software is a scene drawn on the CPU, and no amount of batching or culling makes that
      // fast - it needs to be visible in the readout rather than diagnosed over five versions.
      ` | ${(this.view?.rendererInfo ?? 'unknown gpu').slice(0, 48)}` +
      ` | dpr ${globalThis.devicePixelRatio?.toFixed(1) ?? '?'}, ${globalThis.navigator?.hardwareConcurrency ?? '?'} cores`;
    if (!this.perfElement && typeof document !== 'undefined') {
      // Monospace at the top-left, above everything and clickable-through: this is a diagnostic, not
      // part of the HUD, and it should be impossible to mistake for one.
      const element = document.createElement('pre');
      element.style.cssText =
        'position:fixed;top:4px;left:4px;margin:0;padding:4px 6px;z-index:9999;pointer-events:none;' +
        'font:11px ui-monospace,monospace;color:#9ff;background:#000a;border-radius:3px;';
      document.body.append(element);
      this.perfElement = element;
    }
    if (this.perfElement) this.perfElement.textContent = this.perfText;
    this.log?.info('perf', this.perfText);
  }

  /** The play HUD lives next to the health and the checkpoints, not the debug rows. */
  private updateHud(): void {
    // **Twice a frame was once an understatement: this ran every frame, and a frame is not a place
    // to build five objects and write the DOM.** The play HUD's fastest element is a clock that shows
    // tenths, so ten times a second is its natural rate rather than a compromise - and the objects it
    // builds (`run.snapshot()`, a shard lookup, a trial lookup, the snapshot literal itself) stop
    // being two hundred and forty a second of garbage while the player stands still.
    //
    // The timing gate itself reads the cheap `elapsedSeconds` getter, not `snapshot()`: the latter
    // walks the whole sample window and allocates, which is exactly the per-frame work the throttle
    // is there to avoid, so `snapshot()` runs only on the frames that actually draw.
    const elapsed = this.stats.elapsedSeconds;
    if (elapsed - this.lastGameHud >= 0.1) {
      this.lastGameHud = elapsed;
      this.updateGameHud();
    }

    const interval = 1 / Math.max(1, this.config.debug.hudRefreshHz);
    if (elapsed - this.lastHudUpdate < interval) return;
    this.lastHudUpdate = elapsed;
    this.options.hud.update(this.hudSnapshot(this.stats.snapshot()));
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
          if (this.nearNpc() && this.talkToCat()) break;
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

