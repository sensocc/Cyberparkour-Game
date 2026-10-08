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
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Diameter of the sprite, in metres. */
  readonly scale: number;
  readonly opacity: number;
}

/**
 * Where one puff of smoke is, and how big and how solid, at a given moment.
 *
 * The plume is a *cycle*: a puff is born at the base, climbs, spreads and fades
 * out, and the next one starts. Fading on `sin(pi * t)` means a puff is
 * transparent at both ends of its life, which is what stops a plume from
 * popping: nothing ever appears or disappears abruptly.
 */
export function smokePose(emitter: SmokeEmitter, elapsed: number): SpritePose {
  const period = Math.max(0.001, emitter.period);
  const t = ((((elapsed / period + emitter.phase) % 1) + 1) % 1);

  const angle = (t * 2 + emitter.phase) * Math.PI * 2;
  const sway = Math.sin(angle) * emitter.drift;
  const roll = Math.cos((t * 1.5 + emitter.phase) * Math.PI * 2) * emitter.drift * 0.6;

  return {
    x: emitter.position.x + sway,
    y: emitter.position.y + t * emitter.rise,
    z: emitter.position.z + roll,
    // Grows as it climbs and thins out, like a real plume.
    scale: emitter.radius * (0.55 + t * 0.95),
    opacity: emitter.opacity * Math.sin(Math.PI * t),
  };
}

export interface PickupPose {
  /** Y of the pickup's centre. */
  readonly y: number;
  /** Rotation about Y, in radians. */
  readonly spin: number;
}

/**
 * Where a pickup sits, and how far round it has turned.
 *
 * The bob is offset by the pickup's own X so a row of them does not rise and
 * fall in unison - which reads as a machine rather than as a row of things.
 */
export function pickupPose(position: Vector3Like, elapsed: number): PickupPose {
  return {
    y: position.y + Math.sin(elapsed * 1.4 + position.x * 0.5) * 0.18,
    spin: elapsed * 1.1,
  };
}
