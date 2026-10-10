/**
 * Indoor lifts: cars in shafts, called from a floor and sent to another one.
 *
 * This replaces V0.5's platform lift - a slab that went up and down on a timer, which
 * you could only ride if you happened to be standing on it. A lift in a building is a
 * different thing: it is *called*, it arrives, its gate opens, you walk in, choose a
 * floor, the gate shuts, and it takes you there. That is a small state machine, and
 * this file is it.
 *
 * Three parts of the design are worth knowing before reading:
 *
 *  - **The state machine is per car, and time is the only thing that advances it.**
 *    `update(dt)` is the whole simulation; nothing outside sets a state directly, so
 *    a long frame or a paused game cannot leave a car between states.
 *  - **The car is a collider, and the shaft is geometry.** The car owns one box - its
 *    floor - which it rewrites as it travels, and whoever is standing on that box is
 *    carried (see `carryRider`). The walls, the ceiling and the openings are ordinary
 *    level props, so the physics needs no idea that a lift exists at all.
 *  - **The gates are colliders the lift switches off.** Each floor's opening has a
 *    shutter that is solid unless the car is *docked at that floor*, which is what
 *    stops a player walking into an empty shaft - and what makes "the doors close and
 *    it drives up" a thing you can feel rather than a thing you are told.
 */

import type { AABB } from '../physics/aabb.js';
import type { CollisionWorld } from '../physics/collision.js';
import type { ElevatorDefinition } from './levelData.js';

/** What a car is doing. */
export type ElevatorState = 'idle' | 'closing' | 'moving' | 'opening';

/** One car's state this tick. */
export interface ElevatorUpdate {
  readonly id: string;
  /** The car's footprint, so a caller can ask where the car *is*, not just how high. */
  readonly at: readonly [number, number];
  readonly size: readonly [number, number];
  /** How far the car floor moved this tick (m). Signed. */
  readonly deltaY: number;
  /** The car floor's Y after the move (m). */
  readonly topY: number;
  readonly state: ElevatorState;
  /** The floor the car is docked at, or the one it is heading for. */
  readonly floor: number;
  /** How far the gate is open at the car's floor: 0 shut, 1 open. */
  readonly doorsOpen: number;
}

export interface ElevatorOptions {
  /** Seconds a gate takes to open or close (s). */
  readonly doorSeconds?: number;
  /** Travel speed between floors (m/s). */
  readonly speed?: number;
}

const DEFAULT_DOORS = 0.55;
const DEFAULT_SPEED = 2.6;

interface Car {
  readonly definition: ElevatorDefinition;
  /** The car's own collider box, rewritten as it travels. */
  readonly box: AABB;
  /** The gate colliders, one *group* per floor: a floor may open on two sides. */
  readonly gates: readonly (readonly AABB[])[];
  topY: number;
  /** Index into `definition.floors` the car is at, or heading for. */
  floor: number;
  state: ElevatorState;
  /** Counts up while a gate is opening, closing or dwelling. */
  timer: number;
}

/** Where a player is standing relative to a shaft. */
export interface ElevatorApproach {
  readonly id: string;
  /** The floor whose doorway they are standing in. */
  readonly floor: number;
  /** Whether the car is docked at that floor with its gate open. */
  readonly docked: boolean;
  /** Whether the car is at their floor *and* they are inside it. */
  readonly inside: boolean;
}

export class ElevatorSystem {
  private readonly cars: Car[] = [];
  private readonly doorSeconds: number;
  private readonly speed: number;

  constructor(
    definitions: readonly ElevatorDefinition[],
    world: CollisionWorld,
    options: ElevatorOptions = {},
  ) {
    this.doorSeconds = Math.max(0.05, options.doorSeconds ?? DEFAULT_DOORS);
    this.speed = Math.max(0.05, options.speed ?? DEFAULT_SPEED);

    const colliders = new Map(world.colliders.map((collider) => [collider.id, collider] as const));

    for (const definition of definitions) {
      const car = colliders.get(definition.id);
      if (!car) continue;

      // One *set* of gates per floor: a floor can open on two sides, and both shutters
      // are the same opening seen from two directions.
      const gates: AABB[][] = definition.floors.map((_floor, index) => {
        const found: AABB[] = [];
        for (const suffix of ['', '-back']) {
          const gate = colliders.get(`${definition.id}-gate-${index}${suffix}`);
          if (gate) found.push(gate.box);
        }
        return found;
      });

      const floor = clampIndex(definition.start ?? 0, definition.floors.length);
      const topY = definition.floors[floor] ?? 0;
      const entry: Car = {
        definition,
        box: car.box,
        gates,
        topY,
        floor,
        state: 'idle',
        timer: 0,
      };
      this.cars.push(entry);
      this.place(entry);
      this.applyGates(entry, 1);
    }
  }

  get ids(): readonly string[] {
    return this.cars.map((car) => car.definition.id);
  }

  /** Where every car is right now, for handing to a freshly created view. */
  snapshot(): ElevatorUpdate[] {
    return this.cars.map((car) => this.describe(car));
  }

  /** Returns every car to the floor it starts on, with its gate open. */
  reset(): void {
    for (const car of this.cars) {
      car.floor = clampIndex(car.definition.start ?? 0, car.definition.floors.length);
      car.state = 'idle';
      car.timer = 0;
      car.topY = car.definition.floors[car.floor] ?? 0;
      this.place(car);
      this.applyGates(car, 1);
    }
  }

  /**
   * Sends a car to a floor.
   *
   * Refused while the car is already moving: a lift is not a keyboard, and a player
   * who changes their mind mid-ride is asking the machinery to do something it cannot.
   * (The gate has to shut, and the car has to arrive, first.)
   *
   * @returns whether the car is on its way.
   */
  call(id: string, floor: number): boolean {
    const car = this.cars.find((entry) => entry.definition.id === id);
    if (!car) return false;
    const target = clampIndex(floor, car.definition.floors.length);
    if (car.state === 'moving' || car.state === 'closing') return false;
    if (target === car.floor) return false;

    car.floor = target;
    car.state = 'closing';
    car.timer = 0;
    return true;
  }

  /**
   * What the shaft under a player's feet is doing.
   *
   * One call answers both "can I call this?" and "am I in it?", because the answers
   * come from the same test: which floor is my feet closest to, and is the car there.
   */
  approach(position: { x: number; y: number; z: number }, reach = 2.2): ElevatorApproach | null {
    let best: ElevatorApproach | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const car of this.cars) {
      const { at, size } = car.definition;
      const dx = Math.max(0, Math.abs(position.x - at[0]) - size[0] / 2 - reach);
      const dz = Math.max(0, Math.abs(position.z - at[1]) - size[1] / 2 - reach);
      const horizontal = Math.hypot(dx, dz);
      if (horizontal > 0) continue;

      const floor = nearestFloor(car.definition.floors, position.y);
      if (floor < 0) continue;

      const surfaceY = car.definition.floors[floor] as number;
      const vertical = Math.abs(position.y - surfaceY);
      if (vertical > 2.6) continue;

      const docked = car.state === 'idle' && car.floor === floor;
      const inside =
        docked &&
        Math.abs(position.x - at[0]) <= size[0] / 2 &&
        Math.abs(position.z - at[1]) <= size[1] / 2;

      if (vertical < bestDistance) {
        bestDistance = vertical;
        best = { id: car.definition.id, floor, docked, inside };
      }
    }

    return best;
  }

  /**
   * The car a player is standing *in*, if any.
   *
   * Stricter than `approach`: being inside means being over the car's own footprint
   * and within its travel, which is what the floor-selection UI keys off.
   */
  riding(position: { x: number; y: number; z: number }): string | null {
    for (const car of this.cars) {
      // A car docked at a floor is *flush* with the floor it serves - its roof and the
      // deck's top are the same height - so "inside the footprint, on the roof" is the
      // only test that works at every floor, including the street.
      if (Math.abs(position.x - car.definition.at[0]) > car.definition.size[0] / 2 + 0.2) continue;
      if (Math.abs(position.z - car.definition.at[1]) > car.definition.size[1] / 2 + 0.2) continue;
      if (Math.abs(position.y - car.topY) > 0.4) continue;
      return car.definition.id;
    }
    return null;
  }

  /** The floors a car serves, lowest first, with their names. */
  floors(id: string): { index: number; y: number; name: string }[] {
    const car = this.cars.find((entry) => entry.definition.id === id);
    if (!car) return [];
    return car.definition.floors.map((y, index) => ({
      index,
      y,
      name: car.definition.names?.[index] ?? `Floor ${index + 1}`,
    }));
  }

  /** The floor a car is at, or heading for. */
  floorOf(id: string): number | null {
    return this.cars.find((entry) => entry.definition.id === id)?.floor ?? null;
  }

  /**
   * Advances every car, moving its collider and its gates with it.
   *
   * @returns one entry per car per tick, so a caller only has to carry a rider when
   * there is a car to carry them.
   */
  update(dt: number): ElevatorUpdate[] {
    const updates: ElevatorUpdate[] = [];
    const step = Math.max(0, dt);
    if (step <= 0) return updates;

    for (const car of this.cars) {
      const before = car.topY;
      this.advance(car, step);
      updates.push({ ...this.describe(car), deltaY: car.topY - before });
    }
    return updates;
  }

  // ------------------------------------------------------------------ private

  private advance(car: Car, dt: number): void {
    const target = car.definition.floors[car.floor] ?? car.topY;

    switch (car.state) {
      case 'idle': {
        car.timer += dt;
        // Docked, gate open, waiting to be sent. Nothing closes it on a timer: the
        // player sends it, or it waits for them.
        this.applyGates(car, 1);
        break;
      }
      case 'closing': {
        car.timer += dt;
        this.applyGates(car, this.doorFraction(car));
        if (car.timer >= this.doorSeconds) {
          car.state = 'moving';
          car.timer = 0;
        }
        break;
      }
      case 'moving': {
        const distance = target - car.topY;
        const travel = this.speed * dt;
        if (Math.abs(distance) <= travel) {
          car.topY = target;
          car.state = 'opening';
          car.timer = 0;
        } else {
          car.topY += Math.sign(distance) * travel;
        }
        // Shut the whole way up: a gap between floors is a gap you could fall into.
        this.applyGates(car, 0);
        this.place(car);
        break;
      }
      case 'opening': {
        car.timer += dt;
        this.applyGates(car, this.doorFraction(car));
        if (car.timer >= this.doorSeconds) {
          car.state = 'idle';
          car.timer = 0;
        }
        break;
      }
    }
  }

  /** How far open the gate at the car's current floor is: 0 shut, 1 open. */
  private doorFraction(car: Car): number {
    switch (car.state) {
      case 'idle':
        return 1;
      case 'opening':
        return clamp01(car.timer / this.doorSeconds);
      case 'closing':
        return 1 - clamp01(car.timer / this.doorSeconds);
      case 'moving':
        // Shut the whole way: a gap between floors is a gap you could fall into.
        return 0;
    }
  }

  private describe(car: Car): ElevatorUpdate {
    return {
      id: car.definition.id,
      at: car.definition.at,
      size: car.definition.size,
      deltaY: 0,
      topY: car.topY,
      state: car.state,
      floor: car.floor,
      doorsOpen: this.doorFraction(car),
    };
  }

  /** Writes the car's footprint and height into its collider box. */
  private place(car: Car): void {
    const { at, size, thickness } = car.definition;
    const box = car.box;
    box.min.x = at[0] - size[0] / 2;
    box.max.x = at[0] + size[0] / 2;
    box.min.z = at[1] - size[1] / 2;
    box.max.z = at[1] + size[1] / 2;
    box.min.y = car.topY - thickness;
    box.max.y = car.topY;
  }

  /**
   * Shuts a gate by sliding it *up* into the wall above the opening.
   *
   * The gate collider is the opening's own box moved by its own height, so a closed
   * gate is solid exactly where a player would try to walk, and an open one is out of
   * the way entirely - which is cheaper and far more robust than shrinking the box.
   */
  private applyGates(car: Car, open: number): void {
    for (let index = 0; index < car.gates.length; index += 1) {
      const group = car.gates[index];
      if (!group) continue;
      for (const gate of group) {
        const height = gate.max.y - gate.min.y;
        // **Only the floor the car is docked at opens.** Lifting them all together is the
        // bug that makes a shaft a hole: every floor's opening would be walkable whether
        // or not there was a car behind it.
        const lift = index === car.floor ? open * height : 0;
        gate.min.y = (car.definition.floors[index] as number) + lift;
        gate.max.y = gate.min.y + height;
      }
    }
  }
}

/**
 * Carries a rider: translates a feet position, and its interpolated twin, by the
 * platform's movement.
 *
 * Both have to move. The renderer interpolates between `previousPosition` and
 * `position`, so shifting only the current one would smear the rider across the whole
 * travel for a frame - a visible jolt on the frame a lift starts moving.
 */
export interface RiderPosition {
  readonly position: { y: number };
  readonly previousPosition: { y: number };
}

export function carryRider(rider: RiderPosition, deltaY: number): void {
  rider.position.y += deltaY;
  rider.previousPosition.y += deltaY;
}

function clampIndex(index: number, length: number): number {
  if (!Number.isFinite(index) || length <= 0) return 0;
  return Math.min(length - 1, Math.max(0, Math.round(index)));
}

/** The floor nearest a height, or -1 when none is within a storey. */
function nearestFloor(floors: readonly number[], y: number): number {
  let best = -1;
  let bestDistance = 2.6;
  for (let index = 0; index < floors.length; index += 1) {
    const distance = Math.abs((floors[index] as number) - y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
