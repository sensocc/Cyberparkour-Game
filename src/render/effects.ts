/**
 * Visual effects: the maths behind the things that move for looks alone.
 *
 * Smoke drifts, and a pickup bobs and spins. Neither is part of the simulation
 * and neither touches collision, so both live here rather than in the game: the
 * renderer asks "where is this puff after 12.4 seconds?", and the answer is a
 * pure function of the emitter and the clock.
 *
 * Keeping the poses pure is what makes them testable without a GPU - the scene
 * builder can be handed the same numbers a browser would get - and it means a
 * long frame moves the smoke exactly as far as several short ones would.
 */

export interface Vector3Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** One sprite in a plume. */
export interface SmokeEmitter {
  readonly position: Vector3Like;
  readonly radius: number;
  readonly rise: number;
  readonly drift: number;
  readonly period: number;
  readonly opacity: number;
  /** Where in its cycle this sprite starts, as a fraction of `period`. */
  readonly phase: number;
}

export interface SpritePose {
  x: number;
  y: number;
  z: number;
  /** Diameter of the sprite, in metres. */
  scale: number;
  opacity: number;
}

/** A pose to write into, so a frame does not make one per puff. */
export function emptySpritePose(): SpritePose {
  return { x: 0, y: 0, z: 0, scale: 0, opacity: 0 };
}

/**
 * Where one puff of smoke is, and how big and how solid, at a given moment.
 *
 * The plume is a *cycle*: a puff is born at the base, climbs, spreads and fades out, and the next
 * one starts. Fading on `sin(pi * t)` means a puff is transparent at both ends of its life, which is
 * what stops a plume from popping: nothing ever appears or disappears abruptly.
 *
 * Writes into `out` rather than returning a new one: **forty-four of these run every frame, and a
 * frame is not a place to make garbage.** The old signature returned a fresh object per puff per
 * frame - two and a half thousand a second, standing still - which was a minor garbage collection
 * every few seconds and a visible dip in the frame rate every time one landed.
 */
export function smokePose(emitter: SmokeEmitter, elapsed: number, out: SpritePose): SpritePose {
  const period = Math.max(0.001, emitter.period);
  const t = ((((elapsed / period + emitter.phase) % 1) + 1) % 1);

  const angle = (t * 2 + emitter.phase) * Math.PI * 2;
  const sway = Math.sin(angle) * emitter.drift;
  const roll = Math.cos((t * 1.5 + emitter.phase) * Math.PI * 2) * emitter.drift * 0.6;

  out.x = emitter.position.x + sway;
  out.y = emitter.position.y + t * emitter.rise;
  out.z = emitter.position.z + roll;
  // Grows as it climbs and thins out, like a real plume.
  out.scale = emitter.radius * (0.55 + t * 0.95);
  out.opacity = emitter.opacity * Math.sin(Math.PI * t);
  return out;
}

export interface PickupPose {
  /** Y of the pickup's centre. */
  y: number;
  /** Rotation about Y, in radians. */
  spin: number;
}

/** A pose to write into, so a frame does not make one per pickup. */
export function emptyPickupPose(): PickupPose {
  return { y: 0, spin: 0 };
}

/**
 * Where a pickup sits, and how far round it has turned.
 *
 * The bob is offset by the pickup's own X so a row of them does not rise and
 * fall in unison - which reads as a machine rather than as a row of things.
 *
 * Writes into `out` for the same reason `smokePose` does: one runs per visible pickup per frame,
 * and a fresh object per call is garbage the render path does not need to make.
 */
export function pickupPose(position: Vector3Like, elapsed: number, out: PickupPose): PickupPose {
  out.y = position.y + Math.sin(elapsed * 1.4 + position.x * 0.5) * 0.18;
  out.spin = elapsed * 1.1;
  return out;
}
