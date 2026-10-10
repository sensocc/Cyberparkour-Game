/**
 * Elevators: cars in shafts, called and sent.
 *
 * The whole of this is a state machine, so the tests are about *time*: that a call is
 * refused while a car is already moving, that a gate is shut the whole way between
 * floors, and that an interrupted ride is impossible rather than merely unlikely.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '../../src/core/config.js';
import { collider, world } from '../helpers/player.js';
import { ElevatorSystem, carryRider } from '../../src/game/level/elevators.js';
import type { ElevatorDefinition } from '../../src/game/level/levelData.js';
import { vec3 } from '../../src/core/vec3.js';

const OPTIONS = { speed: 4, doorSeconds: 0.5 };
const STEP = 1 / 60;

/** A three-floor shaft: works, roof, skydeck. */
const SHAFT: ElevatorDefinition = {
  id: 'lift-test',
  at: [0, 0],
  size: [2, 2],
  thickness: 0.6,
  floors: [-5, 0, 20],
  names: ['Service', 'Roof', 'Skydeck'],
  start: 1,
};

/** The car and one gate per floor, as the level would declare them. */
function buildShaft(shaft: ElevatorDefinition = SHAFT): ReturnType<typeof world> {
  const colliders = [
    collider(shaft.id, vec3(shaft.at[0], (shaft.floors[shaft.start ?? 0] as number) - 0.3, shaft.at[1]), vec3(2, 0.6, 2), 'floor'),
  ];
  for (let index = 0; index < shaft.floors.length; index += 1) {
    colliders.push(
      collider(
        `${shaft.id}-gate-${index}`,
        vec3(shaft.at[0], (shaft.floors[index] as number) + 1.25, shaft.at[1] + 1),
        vec3(2.1, 2.5, 0.22),
        'wall',
      ),
    );
  }
  return world(...colliders);
}

function system(shaft: ElevatorDefinition = SHAFT): ElevatorSystem {
  return new ElevatorSystem([shaft], buildShaft(shaft), OPTIONS);
}

/** Runs the system for `seconds`, collecting the states it passed through. */
function run(lift: ElevatorSystem, seconds: number): string[] {
  const states: string[] = [];
  const steps = Math.round(seconds / STEP);
  for (let step = 0; step < steps; step += 1) {
    for (const car of lift.update(STEP)) {
      if (states[states.length - 1] !== car.state) states.push(car.state);
    }
  }
  return states;
}

describe('a car at rest', () => {
  it('starts on the floor it was told to, with its gate open', () => {
    const lift = system();
    const [car] = lift.update(STEP);
    expect(car?.topY).toBe(0);
    expect(car?.state).toBe('idle');
    expect(car?.doorsOpen).toBe(1);
  });

  it('serves its floors in order, with names', () => {
    const floors = system().floors('lift-test');
    expect(floors.map((floor) => floor.y)).toEqual([-5, 0, 20]);
    expect(floors[0]?.name).toBe('Service');
    expect(floors[2]?.name).toBe('Skydeck');
  });

  it('shuts the gate that is not the car', () => {
    // A shaft with every gate open is a shaft you can walk into from any floor, at any
    // time, including when the car is somewhere else - which is how you fall down one.
    const lift = system();
    const car = lift.update(STEP)[0];
    expect(car?.doorsOpen).toBe(1);
  });

  it('has no car for a shaft it does not know', () => {
    expect(system().call('nope', 0)).toBe(false);
    expect(system().floors('nope')).toEqual([]);
    expect(system().floorOf('nope')).toBeNull();
  });
});

describe('being sent somewhere', () => {
  it('closes, moves, opens, and arrives at the right height', () => {
    const lift = system();
    expect(lift.call('lift-test', 2)).toBe(true);

    const states = run(lift, 8);
    expect(states[0]).toBe('closing');
    expect(states).toContain('moving');
    expect(states[states.length - 1]).toBe('idle');

    const [car] = lift.update(STEP);
    expect(car?.topY).toBe(20);
    expect(car?.doorsOpen).toBe(1);
    expect(car?.floor).toBe(2);
  });

  it('shuts the gates the whole way between floors', () => {
    // A gap in a shaft wall at the wrong height is a hole to fall through.
    const lift = system();
    lift.call('lift-test', 2);

    let sawMoving = false;
    for (let step = 0; step < 600; step += 1) {
      const [car] = lift.update(STEP);
      if (car?.state === 'moving') {
        sawMoving = true;
        expect(car.doorsOpen).toBe(0);
      }
    }
    expect(sawMoving).toBe(true);
  });

  it('refuses a second destination while it is already moving', () => {
    const lift = system();
    lift.call('lift-test', 2);
    run(lift, 1);
    expect(lift.call('lift-test', 0)).toBe(false);
    // ...and it still arrives where it was first sent.
    run(lift, 8);
    expect(lift.update(STEP)[0]?.topY).toBe(20);
  });

  it('refuses the floor it is already on', () => {
    expect(system().call('lift-test', 1)).toBe(false);
  });

  it('clamps a floor index it could not have', () => {
    const lift = system();
    expect(lift.call('lift-test', 99)).toBe(true);
    run(lift, 10);
    expect(lift.update(STEP)[0]?.floor).toBe(2);
  });

  it('comes back down, and the carry is signed', () => {
    const lift = system();
    lift.call('lift-test', 0);
    let descended = false;
    for (let step = 0; step < 600; step += 1) {
      const [car] = lift.update(STEP);
      if (car && car.deltaY < 0) descended = true;
    }
    expect(descended).toBe(true);
    expect(lift.update(STEP)[0]?.topY).toBe(-5);
  });
});

describe('where a player is, relative to a shaft', () => {
  it('finds the shaft they are standing in front of', () => {
    const lift = system();
    const near = lift.approach({ x: 0, y: 0.1, z: 2.5 });
    expect(near?.id).toBe('lift-test');
    expect(near?.floor).toBe(1);
    expect(near?.docked).toBe(true);
    expect(near?.inside).toBe(false);
  });

  it('knows when they are inside the car', () => {
    const lift = system();
    expect(lift.approach({ x: 0, y: 0.1, z: 0 })?.inside).toBe(true);
    expect(lift.riding({ x: 0, y: 0.1, z: 0 })).toBe('lift-test');
    expect(lift.riding({ x: 6, y: 0.1, z: 0 })).toBeNull();
  });

  it('is out of reach from across the roof, and from another floor', () => {
    const lift = system();
    expect(lift.approach({ x: 30, y: 0, z: 0 })).toBeNull();
    expect(lift.approach({ x: 0, y: 9, z: 2 })).toBeNull();
  });

  it('reports the car as away once it has been sent elsewhere', () => {
    const lift = system();
    lift.call('lift-test', 2);
    run(lift, 8);
    expect(lift.approach({ x: 0, y: 0.1, z: 2.5 })?.docked).toBe(false);
    expect(lift.approach({ x: 0, y: 20.1, z: 2.5 })?.docked).toBe(true);
  });
});

describe('carrying a rider', () => {
  it('moves both the position and its interpolated twin', () => {
    // Shifting only the current position smears the rider across the whole travel for
    // a frame, which is a jolt on the frame the car starts moving.
    const rider = { position: { y: 3 }, previousPosition: { y: 3 } };
    carryRider(rider, 0.4);
    expect(rider.position.y).toBeCloseTo(3.4, 6);
    expect(rider.previousPosition.y).toBeCloseTo(3.4, 6);
  });

  it('is a no-op for a car that did not move', () => {
    const rider = { position: { y: 3 }, previousPosition: { y: 3 } };
    carryRider(rider, 0);
    expect(rider.position.y).toBe(3);
  });
});

describe('resetting', () => {
  it('puts the car back where it started, gate open', () => {
    const lift = system();
    lift.call('lift-test', 2);
    run(lift, 8);
    lift.reset();

    const [car] = lift.update(STEP);
    expect(car?.topY).toBe(0);
    expect(car?.state).toBe('idle');
    expect(car?.doorsOpen).toBe(1);
  });

  it('survives a shaft with no colliders to drive', () => {
    const lift = new ElevatorSystem([SHAFT], world(), OPTIONS);
    expect(lift.ids).toEqual([]);
    expect(() => lift.update(STEP)).not.toThrow();
  });
});

describe('time', () => {
  it('ignores a zero or backwards step', () => {
    const lift = system();
    lift.call('lift-test', 2);
    expect(lift.update(0)).toEqual([]);
    expect(() => lift.update(-1)).not.toThrow();
  });

  it('travels the same distance whether it is stepped finely or coarsely', () => {
    // The ride is a function of time, not of frame count, so a long frame cannot move
    // a car further than the time it had.
    const fine = system();
    const coarse = system();
    fine.call('lift-test', 2);
    coarse.call('lift-test', 2);
    run(fine, 2);
    for (let step = 0; step < 20; step += 1) coarse.update(0.1);
    // Within a step's worth of travel: whether the gate finishes closing *on* a step
    // boundary is a floating-point accident, and one step of travel is the most that
    // can cost.
    expect(Math.abs((fine.update(STEP)[0]?.topY ?? 0) - (coarse.update(STEP)[0]?.topY ?? 0))).toBeLessThan(0.2);
  });
});

describe('the shipped district', () => {
  it('builds its elevators from the definitions the level declares', async () => {
    const { DEMO_DISTRICT } = await import('../../src/game/level/levelData.js');
    const { buildLevel } = await import('../../src/game/level/level.js');
    const built = buildLevel(DEMO_DISTRICT, {
      maxSubStep: DEFAULT_CONFIG.world.maxCollisionSubStep,
      player: { radius: 0.35, height: 1.8 },
    });
    const lift = new ElevatorSystem(DEMO_DISTRICT.elevators ?? [], built.world, OPTIONS);

    expect(lift.ids.length).toBeGreaterThanOrEqual(2);
    for (const id of lift.ids) {
      const floors = lift.floors(id);
      expect(floors.length).toBeGreaterThanOrEqual(3);
      // The top floor of every tower is a skydeck, which is the whole point of it.
      expect(floors[floors.length - 1]?.name).toMatch(/skydeck/i);
    }
  });
});
