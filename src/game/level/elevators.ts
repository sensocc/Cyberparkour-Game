/**
 * Lifts: the one piece of geometry that moves under its own power.
 *
 * Everything else in a level is static, so the collision world can be built once
 * and trusted. A lift breaks that, and it breaks it in the two places that
 * matter:
 *
 *  - its **collider has to move**, so the platform is a real surface at every
 *    point in its travel rather than a mesh that happens to be drawn there
 *  - whoever is **standing on it has to come along**, or the floor slides out
 *    from under them
 *
 * The first is this class's job: it owns the collider boxes and rewrites their
 * `y` range as the lift travels. The second is the game's, because only it has
 * the player - `update` reports how far each platform moved and who was on it is
 * a question the caller can answer with one id comparison.
 *
 * The travel itself is a pure function of elapsed time, not an integrated state
 * machine: a lift that is asked "where are you after 37.2 seconds?" answers the
 * same whether it got there in one step or a thousand, which makes it testable
 * and makes a long frame harmless.
 */

import type { AABB } from '../physics/aabb.js';
import type { CollisionWorld } from '../physics/collision.js';
import type { ElevatorDefinition } from './levelData.js';

/** One lift's movement this tick. */
export interface ElevatorUpdate {
  readonly id: string;
  /** How far the platform's top surface moved this tick (m). Signed. */
  readonly deltaY: number;
  /** The top surface's Y after the move (m). */
  readonly topY: number;
}

export interface ElevatorSystemOptions {
  /** Seconds a lift waits at each end (s). */
  readonly dwellSeconds?: number;
  /** Travel speed (m/s). */
  readonly speed?: number;
}

interface Lift {
  readonly definition: ElevatorDefinition;
  /** The collider's box, mutated in place as the lift travels. */
  readonly box: AABB;
  topY: number;
}

const DEFAULT_DWELL = 2.4;
const DEFAULT_SPEED = 3.2;

export class ElevatorSystem {
  private readonly lifts: Lift[] = [];
  private readonly dwell: number;
  private readonly speed: number;
  private elapsed = 0;

  constructor(
    definitions: readonly ElevatorDefinition[],
    world: CollisionWorld,
    options: ElevatorSystemOptions = {},
  ) {
    this.dwell = Math.max(0, options.dwellSeconds ?? DEFAULT_DWELL);
    this.speed = Math.max(0.01, options.speed ?? DEFAULT_SPEED);

    const byId = new Map(world.colliders.map((collider) => [collider.id, collider] as const));
    for (const definition of definitions) {
      const collider = byId.get(definition.id);
      if (!collider) continue;
      const topY = this.topAt(0, definition);
      this.lifts.push({ definition, box: collider.box, topY });
      this.place(collider.box, definition, topY);
    }
  }

  get ids(): readonly string[] {
    return this.lifts.map((lift) => lift.definition.id);
  }

  /** Where every lift is right now, for handing to a freshly created view. */
  snapshot(): ElevatorUpdate[] {
    return this.lifts.map((lift) => ({ id: lift.definition.id, deltaY: 0, topY: lift.topY }));
  }

  /** The top surface of one lift, or `null` for an unknown id. */
  topOf(id: string): number | null {
    const lift = this.lifts.find((entry) => entry.definition.id === id);
    return lift ? lift.topY : null;
  }

  /** Returns every lift to the start of its cycle. */
  reset(): void {
    this.elapsed = 0;
    for (const lift of this.lifts) {
      const topY = this.topAt(0, lift.definition);
      lift.topY = topY;
      this.place(lift.box, lift.definition, topY);
    }
  }

  /**
   * Advances every lift, moving its collider with it.
   *
   * @returns one entry per lift that actually moved, so a caller only has to
   * carry a rider when there is a rider to carry.
   */
  update(dt: number): ElevatorUpdate[] {
    const updates: ElevatorUpdate[] = [];
    if (!(dt > 0)) return updates;

    this.elapsed += dt;
    for (const lift of this.lifts) {
      const topY = this.topAt(this.elapsed, lift.definition);
      const deltaY = topY - lift.topY;
      if (deltaY === 0) continue;
      lift.topY = topY;
      this.place(lift.box, lift.definition, topY);
      updates.push({ id: lift.definition.id, deltaY, topY });
    }
    return updates;
  }

  /**
   * The heart of it: where a lift's top surface is `elapsed` seconds into its
   * cycle.
   *
   * Down-wait-up-wait, forever, with the travel time derived from the distance
   * and the speed rather than configured - so changing a lift's height does not
   * change how fast it feels.
   */
  private topAt(elapsed: number, definition: ElevatorDefinition): number {
    const span = definition.highTop - definition.lowTop;
    const travel = Math.abs(span) / this.speed;
    const cycle = 2 * (travel + this.dwell);
    if (cycle <= 0) return definition.lowTop;

    let t = (((elapsed + (definition.phase ?? 0)) % cycle) + cycle) % cycle;
    // Starting at the top is just a half-cycle offset, which keeps one formula
    // for both directions.
    if (definition.start === 'high') t = (t + travel + this.dwell) % cycle;

    if (t < this.dwell) return definition.lowTop;
    t -= this.dwell;
    if (t < travel) return definition.lowTop + (t / travel) * span;
    t -= travel;
    if (t < this.dwell) return definition.highTop;
    // The falling leg: `t` now runs from 0 to `travel` measured from the end of
    // the high dwell, so the *dwell* comes off here. Subtracting the travel was
    // what used to send the platform up past its own ceiling on the way down.
    t -= this.dwell;
    return definition.highTop - (t / travel) * span;
  }

  /** Writes a lift's footprint and height into its collider box. */
  private place(box: AABB, definition: ElevatorDefinition, topY: number): void {
    const [x, z] = definition.at;
    const [width, depth] = definition.size;
    box.min.x = x - width / 2;
    box.max.x = x + width / 2;
    box.min.z = z - depth / 2;
    box.max.z = z + depth / 2;
    box.min.y = topY - definition.thickness;
    box.max.y = topY;
  }
}

/**
 * Carries a rider: translates a feet position, and its interpolated twin, by the
 * platform's movement.
 *
 * Both have to move. The renderer interpolates between `previousPosition` and
 * `position`, so shifting only the current one would smear the rider across the
 * whole travel for a frame - a visible jolt on the frame a lift starts moving.
 */
export interface RiderPosition {
  readonly position: { y: number };
  readonly previousPosition: { y: number };
}

export function carryRider(rider: RiderPosition, deltaY: number): void {
  rider.position.y += deltaY;
  rider.previousPosition.y += deltaY;
}
