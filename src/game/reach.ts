/**
 * How far the player can actually get.
 *
 * A city that is only *generated* is a city nobody can cross: V0.7 laid its blocks out
 * on a grid and never asked whether the gaps between them were jumpable, and they were
 * not - 44 m between buildings that a jump reaches 6.4 m of. The generator now builds
 * to this envelope, and this file is where the envelope is worked out, so there is one
 * authority on it and it can be checked against the simulation rather than trusted.
 *
 * Three numbers, because the player has three ways across a gap:
 *
 * - **`gap`** - a running jump. The airtime is `2 * jumpSpeed / gravity` for a jump that
 *   lands at the height it started from, and the distance is that times the speed the
 *   player can hold in the air. Air acceleration is weak, so the honest figure is the
 *   *sprint* speed: a jump from a run carries a run's speed.
 * - **`rise`** - the highest ledge that can be got onto. A pull-up ends at
 *   `pullUp.maxHeight`, and anything above that is a ladder or a wall run.
 * - **`step`** - the highest ledge that needs no input at all.
 *
 * The one thing this deliberately does not claim: that every gap the generator leaves is
 * *comfortable*. It builds to the limit, because a city of comfortable gaps is a city of
 * streets with nothing in them.
 */

import type { GameConfig } from '../core/config.js';

export interface Reach {
  /** Farthest a running jump crosses, edge to edge (m). */
  readonly gap: number;
  /** Highest ledge a pull-up can reach (m). */
  readonly rise: number;
  /** Highest ledge that is stepped onto without a jump (m). */
  readonly step: number;
}

/** The envelope implied by a physics configuration. */
export function reachOf(config: GameConfig): Reach {
  const { sprintSpeed, jumpSpeed, gravity } = config.player;
  return {
    gap: sprintSpeed * ((2 * jumpSpeed) / gravity),
    rise: config.maneuver.pullUp.maxHeight,
    step: config.maneuver.mantle.maxHeight,
  };
}

/**
 * How far apart two rooftops may be and still be one route.
 *
 * Rounded down, and by a margin: a generator that builds exactly to the limit builds
 * gaps that are *just* crossable, and a player who lands one centimetre short is a player
 * who fell forty metres. Nine tenths of the jump is still a six-metre gap.
 */
export function crossingGap(config: GameConfig): number {
  return Math.floor(reachOf(config).gap * 0.9 * 10) / 10;
}

/**
 * How far a rooftop may sit above another and still be one route.
 *
 * A pull-up is the last resort before a ladder, and it is a *grab*: the ledge has to be
 * within `reach` horizontally as well, which is why this is under the pull-up's ceiling
 * rather than at it.
 */
export function crossingRise(config: GameConfig): number {
  return Math.floor(reachOf(config).rise * 0.85 * 10) / 10;
}
