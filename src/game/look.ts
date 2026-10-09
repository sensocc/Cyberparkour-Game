/**
 * Mouse look.
 *
 * Kept separate from the renderer so the exact rotation maths is testable.
 * Conventions match three.js' `YXZ` Euler order: yaw 0 looks down `-Z`,
 * increasing yaw turns left, positive pitch looks up.
 */

import { clamp, wrapAngle } from '../core/math.js';
import { vec3, type Vec3 } from '../core/vec3.js';

export interface Orientation {
  yaw: number;
  pitch: number;
  /**
   * Camera roll, in degrees. Optional, and only the view ever sets it.
   *
   * Roll is a *camera effect* rather than a player input: the player's aim is yaw
   * and pitch, and a lean into a wall run must not change where they are looking.
   */
  roll?: number;
}

export interface LookConfig {
  /** Radians of rotation per pixel of pointer motion. */
  readonly sensitivity: number;
  /** Clamp on |pitch|, in radians. */
  readonly maxPitch: number;
  /** Flip the vertical axis. */
  readonly invertY?: boolean;
}

/**
 * Applies a pointer motion sample (in pixels) to an orientation, in place.
 *
 * @param dx horizontal motion; positive is to the right.
 * @param dy vertical motion; positive is downwards.
 */
export function applyLook(
  orientation: Orientation,
  dx: number,
  dy: number,
  config: LookConfig,
): Orientation {
  if (Number.isFinite(dx)) {
    orientation.yaw = wrapAngle(orientation.yaw - dx * config.sensitivity);
  }
  if (Number.isFinite(dy)) {
    const vertical = config.invertY ? -dy : dy;
    orientation.pitch = clamp(
      orientation.pitch - vertical * config.sensitivity,
      -config.maxPitch,
      config.maxPitch,
    );
  }
  return orientation;
}

/** Unit vector the camera is looking along, including pitch. */
export function lookDirection(orientation: Orientation): Vec3 {
  const cosPitch = Math.cos(orientation.pitch);
  return vec3(
    -Math.sin(orientation.yaw) * cosPitch,
    Math.sin(orientation.pitch),
    -Math.cos(orientation.yaw) * cosPitch,
  );
}

/** Horizontal (yaw-only) facing, useful for movement and later for mantling. */
export function facingDirection(orientation: Orientation): Vec3 {
  return vec3(-Math.sin(orientation.yaw), 0, -Math.cos(orientation.yaw));
}
