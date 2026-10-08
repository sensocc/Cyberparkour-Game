/**
 * Deciding what to play.
 *
 * The director is pure: it watches the player state and emits *cues*, with no
 * knowledge of Web Audio. That keeps the interesting part - a walking cadence
 * that tracks distance rather than time, wind that scales with falling speed - in
 * a place where it can be tested exactly, and leaves the engine with nothing to
 * do but turn cues into sound.
 */

import { clamp, clamp01 } from '../core/math.js';
import type { GameConfig } from '../core/config.js';
import { lengthXZ } from '../core/vec3.js';
import type { ManeuverKind, PlayerState } from '../game/player.js';

export type Gait = 'walk' | 'sprint' | 'crouch' | 'slide';

export type AudioCue =
  | { readonly kind: 'footstep'; readonly gait: Gait; readonly variant: number }
  | { readonly kind: 'scrape'; readonly variant: number }
  | { readonly kind: 'climb-tick'; readonly variant: number }
  | { readonly kind: 'land'; readonly intensity: 0 | 1 | 2 }
  | { readonly kind: 'grab' }
  | { readonly kind: 'mantle' }
  | { readonly kind: 'pull-up' }
  | { readonly kind: 'slide-start' }
  | { readonly kind: 'slide-stop' }
  | { readonly kind: 'hurt'; readonly damage: number }
  | { readonly kind: 'death' }
  | { readonly kind: 'gust' };

export interface AudioFrame {
  readonly cues: readonly AudioCue[];
  /** 0..1 wind level, which the engine crossfades rather than retriggers. */
  readonly windIntensity: number;
}

/** How often a slide scrapes, and a climb ticks, in seconds. */
const SCRAPE_INTERVAL = 0.24;
const CLIMB_INTERVAL = 0.42;

/** Falling speed at which the wind starts, in m/s. */
const WIND_FLOOR = 9;

/** Footstep variants, so a run does not repeat one sample. */
const FOOTSTEP_VARIANTS = 4;

export class AudioDirector {
  private pending: AudioCue[] = [];
  private distanceSinceStep = 0;
  private stepVariant = 0;
  private scrapeTimer = 0;
  private climbTimer = 0;
  private playedDeath = false;

  constructor(private readonly config: GameConfig) {}

  /** Records a discrete event, played on the next frame. */
  push(cue: AudioCue): void {
    this.pending.push(cue);
  }

  /**
   * Reacts to a landing.
   *
   * The intensity band is what the engine uses to pick a heavier sample, so a
   * hop off a kerb and a drop off the penthouse do not sound identical.
   */
  landing(impact: number, damage: number): void {
    const fall = this.config.fallDamage;
    const fraction = clamp01((impact - fall.safeImpactSpeed) / (fall.fatalImpactSpeed - fall.safeImpactSpeed));
    const intensity: 0 | 1 | 2 = fraction > 0.55 ? 2 : fraction > 0.15 || damage > 0 ? 1 : 0;
    this.push({ kind: 'land', intensity });
    if (damage > 0) this.push({ kind: 'hurt', damage });
  }

  maneuverStart(kind: ManeuverKind): void {
    if (kind === 'hang') this.push({ kind: 'grab' });
    else if (kind === 'slide') this.push({ kind: 'slide-start' });
    else if (kind === 'climb') return;
    else this.push({ kind: kind });
  }

  maneuverEnd(kind: ManeuverKind): void {
    if (kind === 'slide') this.push({ kind: 'slide-stop' });
  }

  /**
   * Advances the cadence timers and returns everything to play this frame.
   *
   * `dt` should be the *simulated* time the frame covered, so the cadence stays
   * in step with the movement whatever the frame rate is doing.
   */
  update(state: PlayerState, dt: number): AudioFrame {
    const cues: AudioCue[] = this.pending;
    this.pending = [];

    if (!state.alive) {
      // One death sound per death, not one per frame of the fall.
      if (!this.playedDeath) {
        cues.push({ kind: 'death' });
        this.playedDeath = true;
      }
      return { cues, windIntensity: 0 };
    }
    this.playedDeath = false;

    const speed = lengthXZ(state.velocity);
    const travelled = speed * dt;

    if (state.grounded && !state.sliding && state.hangId === null && state.climbId === null && state.maneuver === null) {
      const gait: Gait = state.crouching ? 'crouch' : this.sprinting(speed) ? 'sprint' : 'walk';
      const stride = this.strideFor(gait);
      this.distanceSinceStep += travelled;

      // A step is half a stride: one per foot.
      const stepLength = stride / 2;
      if (this.distanceSinceStep >= stepLength) {
        this.distanceSinceStep %= stepLength;
        this.stepVariant = (this.stepVariant + 1) % FOOTSTEP_VARIANTS;
        cues.push({ kind: 'footstep', gait, variant: this.stepVariant });
      }
    } else {
      // Reset so the first step after landing or a manoeuvre is immediate.
      this.distanceSinceStep = this.strideFor('walk') / 2;
    }

    if (state.sliding) {
      this.scrapeTimer -= dt;
      if (this.scrapeTimer <= 0) {
        this.scrapeTimer = SCRAPE_INTERVAL;
        cues.push({ kind: 'scrape', variant: this.stepVariant });
      }
    } else {
      this.scrapeTimer = 0;
    }

    if (state.climbId !== null) {
      this.climbTimer -= dt;
      if (this.climbTimer <= 0) {
        this.climbTimer = CLIMB_INTERVAL;
        cues.push({ kind: 'climb-tick', variant: this.stepVariant });
      }
    } else {
      this.climbTimer = 0;
    }

    // Wind: driven by how fast the player is falling, so it rises as they
    // accelerate and drops away the moment they catch a ledge.
    const fallSpeed = state.grounded || state.hangId !== null ? 0 : Math.max(0, -state.velocity.y);
    const windIntensity = clamp((fallSpeed - WIND_FLOOR) / (this.config.player.maxFallSpeed - WIND_FLOOR), 0, 1);

    if (windIntensity > 0.25) {
      this.gustTimer -= dt;
      if (this.gustTimer <= 0) {
        this.gustTimer = 0.55;
        cues.push({ kind: 'gust' });
      }
    } else {
      this.gustTimer = 0;
    }

    return { cues, windIntensity };
  }

  /** Clears everything, for a respawn or a restart. */
  reset(): void {
    this.pending = [];
    this.distanceSinceStep = 0;
    this.scrapeTimer = 0;
    this.climbTimer = 0;
    this.playedDeath = false;
  }

  private gustTimer = 0;

  private sprinting(speed: number): boolean {
    return speed > this.config.player.walkSpeed * 1.02;
  }

  private strideFor(gait: Gait): number {
    const strides = this.config.headBob.strideLength;
    if (gait === 'crouch') return strides.crouch;
    if (gait === 'sprint' || gait === 'slide') return strides.sprint;
    return strides.walk;
  }
}
