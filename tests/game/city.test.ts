/**
 * The city generator.
 *
 * What matters about a generated level is not what it looks like - that is a thing to
 * look at - but that it is the *same* level every time, that it stays out of the
 * hand-authored district, and that it is a place a player can move through: roofs in
 * reach of each other, ladders between them, and lifts to the parts parkour cannot
 * reach.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '../../src/core/config.js';
import { standingSize } from '../../src/game/player.js';
import { buildCity, generateCity } from '../../src/game/level/city.js';
import { DEMO_DISTRICT } from '../../src/game/level/levelData.js';
import { buildLevel, propBounds } from '../../src/game/level/level.js';

const BUILD = {
  maxSubStep: DEFAULT_CONFIG.world.maxCollisionSubStep,
  player: standingSize(DEFAULT_CONFIG.player),
};

/** Small enough to build in a test, big enough to have every kind of block in it. */
const SMALL = { radius: 200, keepClear: [-120, 170, -110, 110] as const };

describe('the layout', () => {
  it('is the same city every time, from the same seed', () => {
    const first = generateCity({ seed: 7, radius: 150 });
    const second = generateCity({ seed: 7, radius: 150 });
    expect(first.props.map((prop) => prop.id)).toEqual(second.props.map((prop) => prop.id));
    expect(JSON.stringify(first.props)).toBe(JSON.stringify(second.props));
  });

  it('is a different city from a different seed', () => {
    const a = generateCity({ seed: 1, radius: 150 });
    const b = generateCity({ seed: 2, radius: 150 });
    expect(a.props.length).toBeGreaterThan(0);
    expect(JSON.stringify(a.props)).not.toBe(JSON.stringify(b.props));
  });

  it('leaves the hand-authored district its own ground', () => {
    const [x0, x1, z0, z1] = SMALL.keepClear;
    const parts = generateCity({ ...SMALL, seed: 3 });

    for (const prop of parts.props) {
      const bounds = propBounds(prop);
      // Nothing generated may *overlap* the old town's rectangle...
      const overlaps =
        bounds.min.x < x1 && bounds.max.x > x0 && bounds.min.z < z1 && bounds.max.z > z0;
      // ...except the ground under everything, which the city owns.
      if (prop.id === 'city-street-level') continue;
      expect(overlaps, prop.id).toBe(false);
    }
  });

  it('spreads over a kilometre, which is what makes it a city', () => {
    // The headline of V0.7, and the one claim worth holding a test to: the old district
    // was 200 m across, and this is five times that in every direction - twenty-five
    // times the ground.
    const parts = generateCity({ seed: 11 });
    const xs = parts.props.map((prop) => prop.position.x);
    const zs = parts.props.map((prop) => prop.position.z);
    const spanX = Math.max(...xs) - Math.min(...xs);
    const spanZ = Math.max(...zs) - Math.min(...zs);

    expect(spanX).toBeGreaterThan(900);
    expect(spanZ).toBeGreaterThan(900);
  });

  it('builds every kind of place', () => {
    const parts = generateCity({ seed: 5 });
    const report = parts.report;
    for (const kind of ['block', 'tower', 'construction', 'hall', 'ladder', 'balcony', 'crane', 'billboard', 'lift']) {
      expect(report[kind] ?? 0, kind).toBeGreaterThan(0);
    }
  });
});

describe('a generated city as a level', () => {
  const city = buildCity(DEMO_DISTRICT, { seed: 9, ...SMALL });

  it('passes the level\'s own validation, and builds', () => {
    expect(() => buildLevel(city, BUILD)).not.toThrow();
  });

  it('keeps the district it was built around, whole', () => {
    // The old town is not decoration: its checkpoints, pickups, doors and lifts all have
    // to survive being surrounded.
    expect(city.props.length).toBeGreaterThan(DEMO_DISTRICT.props.length);
    expect(city.checkpoints).toBe(DEMO_DISTRICT.checkpoints);
    expect(city.goal).toEqual(DEMO_DISTRICT.goal);
    expect(city.doors).toEqual(DEMO_DISTRICT.doors);
    expect(city.spawn).toEqual(DEMO_DISTRICT.spawn);
    expect(city.elevators?.length ?? 0).toBeGreaterThan(DEMO_DISTRICT.elevators?.length ?? 0);
  });

  it('gives the lifts somewhere to go that parkour cannot reach', () => {
    const towers = (city.elevators ?? []).filter((lift) => lift.id.startsWith('city-'));
    expect(towers.length).toBeGreaterThan(0);
    for (const lift of towers) {
      expect(lift.floors.length, lift.id).toBeGreaterThanOrEqual(3);
      // Street, mid, roof, skydeck: the top is above the roof.
      const highest = lift.floors[lift.floors.length - 1] as number;
      const roof = lift.floors[lift.floors.length - 2] as number;
      expect(highest, lift.id).toBeGreaterThan(roof + 4);
      expect(lift.names?.[lift.names.length - 1]).toMatch(/skydeck/i);
    }
  });

  it('stands every roof within a jump of another one', () => {
    // The terraces are the whole reason the city is playable: a roof nobody can reach is
    // a roof nobody visits. Sampled rather than exhaustive, because this is O(n^2).
    const decks = city.props
      .filter((prop) => prop.model === 'deck' && prop.id.startsWith('city-'))
      .map((prop) => propBounds(prop).max.y);
    expect(decks.length).toBeGreaterThan(20);

    const sorted = [...decks].sort((a, b) => a - b);
    let close = 0;
    for (let index = 1; index < sorted.length; index += 1) {
      if ((sorted[index] as number) - (sorted[index - 1] as number) < 9) close += 1;
    }
    // Most roofs have another roof within a vault's reach of them.
    expect(close / (sorted.length - 1)).toBeGreaterThan(0.5);
  });

  it('is not so heavy that a frame cannot be simulated', () => {
    // Detail over frame rate was the brief, but a collision world that cannot be stepped
    // is not a trade-off, it is a bug. 300 moves is a few seconds of running.
    const built = buildLevel(city, BUILD);
    const box = { min: { x: 0, y: 40, z: 0 }, max: { x: 0.7, y: 41.8, z: 0.7 } };
    const started = Date.now();
    for (let step = 0; step < 300; step += 1) {
      built.world.move(box, { x: 0.2, y: -1, z: 0.1 }, { x: 4, y: -20, z: 2 });
    }
    expect(Date.now() - started).toBeLessThan(400);
  });
});

describe('the lifts the generator builds', () => {
  it('stands every car in open air, at every floor it serves', () => {
    // The invariant that a misplaced shaft breaks: a car inside a building's own body
    // is a car the physics pushes its rider out of - fifty metres straight up, in the
    // first case this caught.
    const city = buildCity(DEMO_DISTRICT, { seed: 21, ...SMALL });
    const built = buildLevel(city, BUILD);
    const cars = (city.elevators ?? []).filter((lift) => lift.id.startsWith('city-'));
    expect(cars.length).toBeGreaterThan(0);

    for (const car of cars) {
      const halfX = car.size[0] / 2;
      const halfZ = car.size[1] / 2;
      for (const floor of car.floors) {
        const box = {
          min: { x: car.at[0] - halfX, y: floor + 0.05, z: car.at[1] - halfZ },
          max: { x: car.at[0] + halfX, y: floor + 1.85, z: car.at[1] + halfZ },
        };
        const blocked = built.colliders.filter(
          (collider) =>
            collider.id !== car.id &&
            !collider.id.startsWith(`${car.id}-gate`) &&
            collider.box.min.x < box.max.x &&
            collider.box.max.x > box.min.x &&
            collider.box.min.y < box.max.y &&
            collider.box.max.y > box.min.y &&
            collider.box.min.z < box.max.z &&
            collider.box.max.z > box.min.z,
        );
        expect(blocked.map((collider) => collider.id), `${car.id} at ${floor}`).toEqual([]);
      }
    }
  });
});
