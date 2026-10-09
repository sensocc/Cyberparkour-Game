/**
 * Camera effects: what the *view* does because of what the body is doing.
 *
 * Separate from the head bob, and deliberately so. The bob is a function of
 * distance travelled - it is the gait, and it runs whenever the player is moving.
 * These are responses: the field of view opening as speed builds, a drop and a
 * shake when a long fall ends, a lean into a wall run. They are all driven by
 * *events and state* rather than by the tick, which is what makes them testable
 * without a renderer and without a clock.
 *
 * Two rules:
 *
 *  - **Everything decays.** No effect is left at a value somebody has to remember
 *    to clear; a paused game, a respawn and a settings change all leave the view
 *    exactly where it should be.
 *  - **Everything is small.** The camera is the player's entire view of the world,
 *    and V0.5.1 had to soften the head bob because the eye was being asked to track
 *    it. These are the numbers that make a landing *land* without making the screen
 *    wobble, and the whole lot is multiplied by the player's Camera motion setting -
 *    which can take it to zero.
 */

import { easeToward } from '../core/math.js';
import type { CameraEffectsConfig } from '../core/config.js';

/** What the body is doing, as far as the camera cares. */
export interface MotionSample {
  /** Horizontal speed as a fraction of a full sprint, 0..1. */
  readonly speedFraction: number;
  readonly crouching: boolean;
  /** How far into a slide, 0..1. */
  readonly slideFraction: number;
  /** How far into a wall run, 0..1. */
  readonly wallRunFraction: number;
  /** Which side the wall is on, for the lean. */
  readonly wallRunSide: -1 | 0 | 1;
}

/**
 * What the view should do this frame.
 *
 * Mutable on purpose: one of these is owned by `CameraEffects` and rewritten every
 * frame, so reading the camera's state allocates nothing. (The render path is one
 * of the few places in the game where that matters.)
 */
export interface CameraFrame {
  /** Degrees to add to the field of view. */
  fov: number;
  /** Degrees of roll, positive being a lean to the player's right. */
  roll: number;
  /** Metres to move the eye. */
  offsetX: number;
  offsetY: number;
  offsetZ: number;
}

const NONE: MotionSample = {
  speedFraction: 0,
  crouching: false,
  slideFraction: 0,
  wallRunFraction: 0,
  wallRunSide: 0,
};

/** Frequency of the landing shake, in radians per second of its own phase. */
const SHAKE_RATE = 34;
/** How fast a landing's field-of-view change and lean follow their target (1/s). */
const ROLL_RATE = 8;

export class CameraEffects {
  private fovOffset = 0;
  /** Metres the eye is currently pushed down by a landing. Negative is down. */
  private dip = 0;
  /** 0..1, the strength of the landing shake still ringing. */
  private shake = 0;
  private shakePhase = 0;
  private roll = 0;
  private enabled = true;
  private readonly frame: CameraFrame = { fov: 0, roll: 0, offsetX: 0, offsetY: 0, offsetZ: 0 };

  /**
   * Sets how much of the whole effect to apply.
   *
   * Zero puts everything back where it started rather than freezing it, so a player
   * who turns camera motion off mid-fall does not end up with a permanently dipped
   * camera.
   */
  setScale(scale: number): void {
    this.enabled = scale > 0;
    if (!this.enabled) this.reset();
  }

  /** Clears every effect, for a restart, a respawn or a settings change. */
  reset(): void {
    this.fovOffset = 0;
    this.dip = 0;
    this.shake = 0;
    this.shakePhase = 0;
    this.roll = 0;
    this.frame.fov = 0;
    this.frame.roll = 0;
    this.frame.offsetX = 0;
    this.frame.offsetY = 0;
    this.frame.offsetZ = 0;
  }

  /**
   * A landing.
   *
   * `strength` is 0..1 of the speed that would kill, so the camera answers the same
   * way the health bar does - a landing that hurts is a landing that shows.
   */
  land(strength: number, config: CameraEffectsConfig): void {
    if (!this.enabled) return;
    const amount = clamp01(strength);
    // Not scaled here: the scale is applied once, where the frame is built, so
    // there is one place that decides how much of the effect the player sees.
    this.dip = Math.min(this.dip, -config.landingDip * amount);
    this.shake = Math.max(this.shake, config.landingShake * amount);
  }

  /** This frame's values, for a caller that renders before the next update. */
  get current(): CameraFrame {
    return this.frame;
  }

  /**
   * Advances every effect.
   *
   * @returns the same object every time, holding this frame's values.
   */
  update(
    dt: number,
    sample: MotionSample = NONE,
    config: CameraEffectsConfig,
    scale = 1,
  ): CameraFrame {
    const frame = this.frame;
    if (!this.enabled || scale <= 0) {
      frame.fov = 0;
      frame.roll = 0;
      frame.offsetX = 0;
      frame.offsetY = 0;
      frame.offsetZ = 0;
      return frame;
    }

    const step = Math.max(0, dt);

    // ---------------------------------------------------------- field of view
    // Speed opens the view; crouching closes it. Both are *approached* rather than
    // set, so running and stopping is a swell rather than a jump cut.
    const fovTarget =
      (clamp01(sample.speedFraction) * config.speedFov + (sample.crouching ? config.crouchFov : 0)) *
      scale;
    this.fovOffset = easeToward(this.fovOffset, fovTarget, config.fovApproach, step);
    frame.fov = this.fovOffset;

    // ------------------------------------------------------------------- lean
    const rollTarget =
      (clamp01(sample.slideFraction) * config.slideRoll +
        clamp01(sample.wallRunFraction) * config.wallRunRoll * sample.wallRunSide) *
      scale;
    this.roll = easeToward(this.roll, rollTarget, ROLL_RATE, step);
    frame.roll = this.roll;

    // ------------------------------------------------------------------- dip
    // Back to level, always: the dip is a push that the ground gives back.
    this.dip = easeToward(this.dip, 0, config.landingRecover, step);

    // ----------------------------------------------------------------- shake
    // A decaying oscillation on two axes at different rates, which reads as an
    // impact rather than as a repeating wobble.
    this.shakePhase += step * SHAKE_RATE;
    this.shake = this.shake * Math.exp(-config.shakeDecay * step);
    if (this.shake < 1e-4) this.shake = 0;

    const reach = this.shake * config.shakeReach * scale;
    frame.offsetX = Math.sin(this.shakePhase) * reach;
    frame.offsetY = this.dip * scale + Math.sin(this.shakePhase * 1.7) * reach * 0.6;
    frame.offsetZ = Math.cos(this.shakePhase * 0.8) * reach * 0.5;

    // A decayed effect can come out as negative zero - `sin(x) * 0` is signed - and
    // a `-0` camera offset is the kind of thing that makes a later equality check
    // surprising. Zero is zero.
    if (frame.offsetX === 0) frame.offsetX = 0;
    if (frame.offsetY === 0) frame.offsetY = 0;
    if (frame.offsetZ === 0) frame.offsetZ = 0;
    return frame;
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
