/**
 * The game: owns the loop, the simulation, the view and the UI state machine.
 *
 * Status transitions
 *
 *   idle ──start──▶ playing ⇄ paused
 *                     │  ╲
 *                     │   ╲ quit ──▶ ended ──restart──▶ playing
 *                     └── error ──▶ crashed ──restart──▶ playing
 *
 * The frame loop keeps ticking while paused so that the menus stay responsive
 * and key handling lives in exactly one place; simulation, statistics and
 * rendering are all skipped, so a paused frame costs nothing measurable.
 */

import { DEFAULT_CONFIG, fixedStep, type GameConfig } from '../core/config.js';
import { FixedStepAccumulator } from '../core/delta.js';
import { logger, type LogBuffer } from '../core/log.js';
import { AudioDirector, type AudioCue } from '../audio/director.js';
import { SilentAudio, type AudioOutput } from '../audio/engine.js';
import { GameLoop, type FrameScheduler } from '../core/loop.js';
import { vec3, type Vec3 } from '../core/vec3.js';
import type { CrashReporter } from '../diagnostics/crashReporter.js';
import { FrameStats, type StatsSnapshot } from '../diagnostics/stats.js';
import { DomInput } from '../input/domInput.js';
import type { InputState } from '../input/inputState.js';
import { applyLook } from './look.js';
import { buildLevel, type BuiltLevel } from './level/level.js';
import { DEMO_DISTRICT, type LevelDefinition } from './level/levelData.js';
import {
  createPlayerState,
  eyePosition,
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
import type { GameHud } from '../ui/gameHud.js';
import type { DebugHud, HudSnapshot } from '../ui/hud.js';
import type { GameUi } from '../ui/screens.js';

export type GameStatus = 'idle' | 'playing' | 'paused' | 'ended' | 'crashed';

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

  private level: BuiltLevel;
  private player: PlayerState;
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
  /** Whether the player has muted the demo. */
  private muted = false;
  private readonly audioDirector: AudioDirector;
  private readonly audioOutput: AudioOutput;

  // Reused per-frame scratch objects: the render path allocates nothing.
  private readonly scratchFeet: Vec3 = vec3();
  private readonly scratchEye: Vec3 = vec3();

  constructor(options: GameOptions) {
    this.options = options;
    this.config = options.config ?? DEFAULT_CONFIG;
    this.definition = options.level ?? DEMO_DISTRICT;
    this.log = options.logBuffer;

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
    this.climbables = new Set(
      this.level.colliders.filter((collider) => collider.kind === 'climbable').map((c) => c.id),
    );
    this.player = createPlayerState(this.definition.spawn, this.config);

    this.domInput = new DomInput({
      target: options.pointerLockTarget,
      input: options.input,
      onPointerLockChange: (locked) => this.handlePointerLockChange(locked),
    });

    this.audioDirector = new AudioDirector(this.config);
    this.audioOutput = options.audio ?? new SilentAudio();

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
      game: this.config,
      climbableIds: this.climbables,
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
    this.options.ui.toast(`CHECKPOINT ${index + 1} / ${total}`);
    this.updateGameHud();
  }

  private updateGameHud(): void {
    this.options.gameHud.update({
      health: this.player.health,
      maxHealth: this.config.fallDamage.maxHealth,
      checkpoint: this.player.checkpoint,
      checkpointCount: this.definition.checkpoints.length,
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

  private resetSimulation(): void {
    this.level = buildLevel(this.definition, {
      maxSubStep: this.config.world.maxCollisionSubStep,
      player: standingSize(this.config.player),
    });
    resetPlayerState(this.player, this.config);
    this.audioDirector.reset();
    this.audioOutput.silence();
    this.accumulator.reset();
    this.stats.reset();
    this.lastHudUpdate = 0;
    this.sprinting = false;
    this.options.input.clear();
  }

  private ensureView(): void {
    if (this.view) return;

    const canvas = document.createElement('canvas');
    canvas.className = 'game-canvas';
    canvas.setAttribute('aria-label', 'Cyberparkour game viewport');
    this.options.host.append(canvas);

    try {
      this.view = this.options.createView(canvas, this.definition, this.config);
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
        sensitivity: this.config.camera.sensitivity,
        maxPitch: this.config.camera.maxPitch,
      });
    }

    const moveInput = this.options.input.moveInput;
    this.sprinting = moveInput.sprint;

    const steps = this.accumulator.run(delta, (step) => {
      const outcome = stepPlayer(this.player, moveInput, step, this.stepOptions());
      if (outcome.died) this.handleDeath();
      else if (outcome.respawned) this.handleRespawn();
      if (outcome.landing) this.handleLanding(outcome.landing.impact, outcome.landing.damage);
      if (outcome.started) this.audioDirector.maneuverStart(outcome.started);
      if (outcome.ended) this.audioDirector.maneuverEnd(outcome.ended);
      if (outcome.checkpoint !== null) this.handleCheckpoint(outcome.checkpoint);
    });

    this.updateAudio(steps * fixedStep(this.config));
    this.stats.push(delta);
    this.renderFrame();
    this.updateHud();
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

  private renderFrame(): void {
    if (!this.view) return;

    const feet = interpolatePlayerPosition(this.player, this.accumulator.alpha, this.scratchFeet);
    // Eye height follows the stance and the head bob, so crouching visibly drops
    // the camera and running visibly rocks it.
    eyePosition(this.player, this.config, this.scratchEye, feet);

    this.view.render(this.scratchEye, this.player);
  }

  /** The play HUD lives next to the health and the checkpoints, not the debug rows. */
  private updateHud(): void {
    const stats = this.stats.snapshot();
    const interval = 1 / Math.max(1, this.config.debug.hudRefreshHz);
    if (stats.elapsedSeconds - this.lastHudUpdate < interval) return;
    this.lastHudUpdate = stats.elapsedSeconds;

    this.options.hud.update(this.hudSnapshot(stats));
    this.updateGameHud();
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
