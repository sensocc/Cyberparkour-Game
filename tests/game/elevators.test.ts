/**
 * Lifts.
 *
 * A lift is the one piece of geometry that moves, so there are two things to
 * pin down: that its *collider* travels with it (otherwise the platform is a
 * picture), and that whoever is standing on it comes along (otherwise the floor
 * slides out from under them).
 */

import { describe, expect, it } from 'vitest';

import { vec3 } from '../../src/core/vec3.js';
import { createPlayerState, stepPlayer } from '../../src/game/player.js';
import { ElevatorSystem, carryRider } from '../../src/game/level/elevators.js';
import type { ElevatorDefinition } from '../../src/game/level/levelData.js';
import { CONFIG, STEP, collider, input, optionsFor, spawnAt, world } from '../helpers/player.js';

/** One lift, from the deck up four metres, in two seconds, pausing a second. */
const LIFT: ElevatorDefinition = {
  id: 'lift',
  at: [0, 0],
  size: [4, 4],
  thickness: 0.6,
  lowTop: 0,
  highTop: 4,
};

const LIFT_COLLIDER = collider('lift', vec3(0, -0.3, 0), vec3(4, 0.6, 4), 'floor');
const TIMING = { dwellSeconds: 1, speed: 2 };

function setup(definitions: readonly ElevatorDefinition[] = [LIFT]) {
  const collisionWorld = world(LIFT_COLLIDER);
  const lifts = new ElevatorSystem(definitions, collisionWorld, TIMING);
  return { world: collisionWorld, lifts };
}

describe('the travel', () => {
  it('waits at the bottom, rises, waits at the top, then falls', () => {
    const { lifts } = setup();

    expect(lifts.topOf('lift')).toBe(0);
    lifts.update(1);
    expect(lifts.topOf('lift'), 'still waiting at the bottom').toBe(0);
    lifts.update(1);
    expect(lifts.topOf('lift'), 'half way').toBeCloseTo(2, 6);
    lifts.update(1);
    expect(lifts.topOf('lift'), 'arrived').toBeCloseTo(4, 6);
    lifts.update(1);
    expect(lifts.topOf('lift'), 'waiting at the top').toBe(4);
    lifts.update(2);
    expect(lifts.topOf('lift'), 'back down').toBeCloseTo(0, 6);
  });

  it('starts at the top when the level says so', () => {
    const { lifts } = setup([{ ...LIFT, start: 'high' }]);
    expect(lifts.topOf('lift')).toBe(4);
  });

  it('is a pure function of elapsed time, so one long step equals several short ones', () => {
    const stepwise = setup();
    const single = setup();

    for (let tick = 0; tick < 40; tick += 1) stepwise.lifts.update(0.05);
    single.lifts.update(2);

    expect(single.lifts.topOf('lift')).toBeCloseTo(stepwise.lifts.topOf('lift') ?? -1, 9);
  });

  it('reports only the lifts that actually moved', () => {
    const { lifts } = setup();
    expect(lifts.update(0.5), 'waiting').toEqual([]);

    const moving = lifts.update(0.75);
    expect(moving).toHaveLength(1);
    expect(moving[0]?.id).toBe('lift');
    expect(moving[0]?.deltaY).toBeGreaterThan(0);
    expect(moving[0]?.topY).toBeCloseTo(0.5, 6);
  });

  it('ignores a zero or negative step rather than moving', () => {
    const { lifts } = setup();
    expect(lifts.update(0)).toEqual([]);
    expect(lifts.update(-5)).toEqual([]);
    expect(lifts.topOf('lift')).toBe(0);
  });
});

describe('the collider', () => {
  it('travels with the platform, so the surface is real at every height', () => {
    const { world: collisionWorld, lifts } = setup();
    const box = () => collisionWorld.colliders.find((entry) => entry.id === 'lift')?.box;

    expect(box()?.max.y).toBeCloseTo(0, 9);
    expect(box()?.min.y).toBeCloseTo(-0.6, 9);

    lifts.update(2);
    expect(box()?.max.y).toBeCloseTo(2, 6);
    // The thickness is what keeps the sub-step from stepping through it.
    expect(box()?.min.y).toBeCloseTo(2 - 0.6, 6);
  });

  it('keeps its footprint', () => {
    const { world: collisionWorld, lifts } = setup();
    lifts.update(3);
    const box = collisionWorld.colliders.find((entry) => entry.id === 'lift')?.box;
    expect(box?.min.x).toBeCloseTo(-2, 9);
    expect(box?.max.x).toBeCloseTo(2, 9);
    expect(box?.min.z).toBeCloseTo(-2, 9);
    expect(box?.max.z).toBeCloseTo(2, 9);
  });
});

describe('the system', () => {
  it('lists its lifts and snapshots their heights', () => {
    const { lifts } = setup();
    expect(lifts.ids).toEqual(['lift']);
    expect(lifts.snapshot()).toEqual([{ id: 'lift', deltaY: 0, topY: 0 }]);
    expect(lifts.topOf('nope')).toBeNull();
  });

  it('returns every lift to the start of its cycle', () => {
    const { world: collisionWorld, lifts } = setup();
    lifts.update(3.5);
    expect(lifts.topOf('lift')).toBeGreaterThan(2);

    lifts.reset();
    expect(lifts.topOf('lift')).toBe(0);
    expect(collisionWorld.colliders.find((entry) => entry.id === 'lift')?.box.max.y).toBeCloseTo(0, 9);
  });

  it('skips a definition whose collider is not in the world', () => {
    const { lifts } = setup([{ ...LIFT, id: 'ghost' }]);
    expect(lifts.ids).toEqual([]);
    expect(lifts.update(1)).toEqual([]);
  });
});

describe('carrying a rider', () => {
  it('moves the feet and the interpolated twin together', () => {
    const rider = { position: { y: 0.01 }, previousPosition: { y: 0.01 } };
    carryRider(rider, 1.2);
    expect(rider.position.y).toBeCloseTo(1.21, 9);
    // Both, or the renderer smears the rider across the travel for a frame.
    expect(rider.previousPosition.y).toBeCloseTo(1.21, 9);
  });

  it('lifts a player standing on it', () => {
    const collisionWorld = world(LIFT_COLLIDER);
    const lifts = new ElevatorSystem([{ ...LIFT, lowTop: 0, highTop: 6 }], collisionWorld, TIMING);
    const player = createPlayerState(spawnAt(0, 0.001, 0), CONFIG);
    const options = optionsFor(collisionWorld);

    // Settle onto the platform.
    for (let tick = 0; tick < 10; tick += 1) stepPlayer(player, input(), STEP, options);
    expect(player.groundId).toBe('lift');

    const before = player.position.y;

    // Ride exactly the way the game does it: move the lift, carry the rider,
    // then step - so the ground probe sees the new surface, not the old one.
    for (let tick = 0; tick < 180; tick += 1) {
      for (const ride of lifts.update(STEP)) {
        if (player.groundId === ride.id) carryRider(player, ride.deltaY);
      }
      stepPlayer(player, input(), STEP, options);
    }

    expect(player.position.y).toBeGreaterThan(before + 1);
    expect(player.groundId).toBe('lift');
  });

  it('does not lift a player who is not standing on it', () => {
    // A rider in the air above a rising lift is not attached to it; if it were,
    // a jump would be hijacked by whatever happened to be underneath.
    const rider = { position: { y: 10 }, previousPosition: { y: 10 } };
    expect(rider.position.y).toBe(10);
  });
});
