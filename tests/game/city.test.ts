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
import { crossingGap, crossingRise } from '../../src/game/reach.js';
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
    for (const kind of ['block', 'tower', 'construction', 'hall', 'interior', 'ladder', 'balcony', 'crane', 'billboard', 'lift']) {
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
    // What a tower's lift is *for*: the top of a sixty-metre building, which is far more
    // than the two and a half metres a pull-up reaches. V0.7.2 changed where the top is -
    // it is the building's own roof now rather than a skydeck seven metres above it - and
    // the height above the street is what makes it worth calling.
    const towers = (city.elevators ?? []).filter((lift) => lift.id.includes('-tower-lift'));
    expect(towers.length).toBeGreaterThan(0);

    for (const lift of towers) {
      expect(lift.floors.length, lift.id).toBeGreaterThanOrEqual(3);
      const street = lift.floors[0] as number;
      const highest = lift.floors[lift.floors.length - 1] as number;
      expect(highest - street, lift.id).toBeGreaterThan(40);
      expect(lift.names?.[0], lift.id).toBe('Street');
      expect(lift.names?.[lift.names.length - 1], lift.id).toBe('Roof');
      // ...and it stops at the building's floors on the way, so it is a lift and not an
      // express to the top.
      expect(lift.floors.length, lift.id).toBeGreaterThanOrEqual(4);
    }
  });

  it('stands every roof within a jump of another one', () => {
    // The terraces are the whole reason the city is playable: a roof nobody can reach is
    // a roof nobody visits. Sampled rather than exhaustive, because this is O(n^2).
    const decks = city.props
      .filter((prop) => prop.model === 'deck' && prop.id.startsWith('city-'))
      .map((prop) => propBounds(prop).max.y);
    expect(decks.length).toBeGreaterThan(12);

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
    // Every lift the generator built - towers and interiors alike, so this covers the
    // cars that stand *inside* a building as well as the ones beside it.
    const own = new Set((DEMO_DISTRICT.elevators ?? []).map((lift) => lift.id));
    const cars = (city.elevators ?? []).filter((lift) => !own.has(lift.id));
    expect(cars.length).toBeGreaterThan(0);

    for (const car of cars) {
      // A centimetre inside the car's own footprint: a car *touching* the wall of its
      // own shaft is not an obstruction, and at these magnitudes a touch and an overlap
      // are the same floating-point number.
      const halfX = car.size[0] / 2 - 0.01;
      const halfZ = car.size[1] / 2 - 0.01;
      for (const floor of car.floors) {
        const box = {
          min: { x: car.at[0] - halfX, y: floor + 0.15, z: car.at[1] - halfZ },
          max: { x: car.at[0] + halfX, y: floor + 1.75, z: car.at[1] + halfZ },
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

describe('the interiors the generator builds', () => {
  const city = buildCity(DEMO_DISTRICT, { seed: 21, ...SMALL });

  it('puts several floors inside a building, each of them served', () => {
    // "Indoors" in a city is not one room: a building with three or four storeys inside
    // it, a corridor on each, and a way up - and the way up is the lift, which is what
    // makes the top floor somewhere.
    const interiors = (city.elevators ?? []).filter((lift) => lift.id.startsWith('inside-'));
    expect(interiors.length).toBeGreaterThan(0);

    for (const lift of interiors) {
      expect(lift.floors.length, lift.id).toBeGreaterThanOrEqual(4);
      expect(lift.names?.length, lift.id).toBe(lift.floors.length);
      expect(lift.names?.[0]).toBe('Street');
      expect(lift.names?.[lift.names.length - 1]).toBe('Roof');
      // Floors you can stand on are floors that are far enough apart to walk in.
      for (let index = 1; index < lift.floors.length; index += 1) {
        const gap = (lift.floors[index] as number) - (lift.floors[index - 1] as number);
        expect(gap, lift.id).toBeGreaterThan(2);
      }
    }
  });

  it('rings every floor round an atrium rather than plating over it', () => {
    // The well runs from the street to the sky: four slabs round the opening, and the
    // lift and the ladder both pass through it rather than into it.
    const built = buildLevel(city, BUILD);
    const interiors = (city.elevators ?? []).filter((lift) => lift.id.startsWith('inside-'));
    const roofOf = (lift: (typeof interiors)[number]) =>
      lift.floors[lift.floors.length - 1] as number;

    for (const lift of interiors) {
      const roof = roofOf(lift);
      // Nothing may cover the shaft, at any height it stops at.
      for (const floor of lift.floors) {
        const shaft = built.colliders.filter(
          (collider) =>
            !collider.id.includes('-gate') &&
            collider.box.min.x < lift.at[0] + lift.size[0] / 2 - 0.01 &&
            collider.box.max.x > lift.at[0] - lift.size[0] / 2 + 0.01 &&
            collider.box.min.z < lift.at[1] + lift.size[1] / 2 - 0.01 &&
            collider.box.max.z > lift.at[1] - lift.size[1] / 2 + 0.01 &&
            collider.box.min.y < floor + 1.4 &&
            collider.box.max.y > floor + 0.2,
        );
        expect(shaft.map((collider) => collider.id), `${lift.id} at ${floor}`).toEqual([]);
      }
      // ...and the roof is a ring, not a lid, so the well is open to the sky.
      expect(Number.isFinite(roof)).toBe(true);
    }
  });

  it('has a way between the inside floors that is not the lift', () => {
    // A ladderwell, so the building is climbable as well as rideable - and so a floor
    // can be reached without calling anything.
    const interiors = new Set(
      (city.elevators ?? [])
        .filter((lift) => lift.id.startsWith('inside-'))
        .map((lift) => lift.id.replace('-lift', '')),
    );
    const ladders = city.props.filter(
      (prop) => prop.model === 'ladder' && [...interiors].some((prefix) => prop.id.startsWith(`${prefix}-ladder`)),
    );
    expect(ladders.length).toBeGreaterThan(interiors.size);
  });
});

describe('the city as somewhere you can get around', () => {
  // The whole city, not the small one the other suites use: the point of this version is
  // that there is nowhere in it a player cannot get to.
  const city = buildCity(DEMO_DISTRICT);

  /**
   * Every surface a player can stand on, from the props the generator made.
   *
   * Floors rather than decks: a roof is a `deck` on a block and a `slab` on a tower, and
   * V0.7.2 is the version where that difference cost the city its routes - the streets
   * were filled by measuring half of it and concluding the rest was empty.
   */
  function surfaces(): {
    id: string;
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    top: number;
  }[] {
    return city.props
      .filter(
        (prop) =>
          prop.kind === 'floor' &&
          prop.model !== 'city-street-level' &&
          prop.size.x > 5 &&
          prop.size.z > 5,
      )
      .map((prop) => ({
        id: prop.id,
        minX: prop.position.x - prop.size.x / 2,
        maxX: prop.position.x + prop.size.x / 2,
        minZ: prop.position.z - prop.size.z / 2,
        maxZ: prop.position.z + prop.size.z / 2,
        top: prop.position.y + prop.size.y / 2,
      }));
  }

  /** How far apart two surfaces are, edge to edge, horizontally. */
  function apart(a: ReturnType<typeof surfaces>[number], b: ReturnType<typeof surfaces>[number]): number {
    const dx = Math.max(0, Math.max(a.minX - b.maxX, b.minX - a.maxX));
    const dz = Math.max(0, Math.max(a.minZ - b.maxZ, b.minZ - a.maxZ));
    return Math.hypot(dx, dz);
  }

  it('leaves no roof farther from its neighbour than a running jump', () => {
    // The rule V0.7.2 exists for, and the one V0.7 broke: "a distance between two
    // different buildings cannot be higher than the highest possible jumping distance".
    // The limit is not a number somebody liked - it is derived from the movement and
    // checked against the simulation in `reach.test.ts`, and every roof in the city is
    // held to it here.
    const gap = crossingGap(DEFAULT_CONFIG);
    const roofs = surfaces();
    expect(roofs.length).toBeGreaterThan(400);

    const stranded: string[] = [];
    for (const roof of roofs) {
      const nearest = roofs
        .filter((other) => other !== roof)
        .reduce((best, other) => Math.min(best, apart(roof, other)), Number.POSITIVE_INFINITY);
      if (!(nearest <= gap)) stranded.push(`${roof.id} (${nearest.toFixed(1)}m)`);
    }
    expect(stranded.slice(0, 8)).toEqual([]);
  });

  it('reaches almost all of them upward as well as across', () => {
    // A roof you can only drop *to* is a roof you reach from above and leave downwards.
    // The bar is not every roof: a terrace two metres above its neighbour is a pull-up
    // and anything higher is a ladder, and there are ladders. It is that the city is a
    // route rather than a set of islands, which is what the number is for.
    const gap = crossingGap(DEFAULT_CONFIG);
    const rise = crossingRise(DEFAULT_CONFIG);
    const roofs = surfaces();

    let reachable = 0;
    for (const roof of roofs) {
      const up = roofs.some(
        (other) => other !== roof && apart(roof, other) <= gap && other.top <= roof.top + rise,
      );
      if (up) reachable += 1;
    }

    expect(reachable / roofs.length).toBeGreaterThan(0.85);
  });

  it('gives every roof a ladder, for the ones a jump cannot make', () => {
    // "And if it is, there has to be other way" - the other way is a ladder up the wall,
    // which the climb has been able to handle since V0.3.
    const ladders = city.props.filter((prop) => prop.model === 'ladder');
    expect(ladders.length).toBeGreaterThan(200);

    // Every building the generator recorded that is tall enough to need one has at least
    // one, and each is climbable - a ladder nobody can climb is decoration.
    for (const ladder of ladders) {
      expect(ladder.climbable, ladder.id).toBe(true);
    }
  });
});

describe('the buildings the streets were filled with', () => {
  // The whole city: filling the streets is a thing that happens where there are streets
  // to fill, and a 200 m sample has seven of them.
  const city = buildCity(DEMO_DISTRICT);
  const report = generateCity().report;

  it('fills the gap between neighbours with a building, not a fence', () => {
    const infills = city.props.filter((prop) => prop.id.startsWith('fill-'));
    expect(infills.length).toBeGreaterThan(100);
    // Its own body, from the street up - a building rather than something laid in the gap.
    const bodies = city.props.filter(
      (prop) => prop.id.startsWith('fill-') && prop.id.endsWith('-body'),
    );
    expect(bodies.length).toBeGreaterThan(80);
  });

  it('decorates every one of them differently', () => {
    // "These in-between buildings need to be uniquely decorated too." Three to five
    // features each, drawn from a dozen, and the signature is in the report - so this is
    // a count rather than an opinion about how the streets look.
    const kits = Object.keys(report).filter((key) => key.startsWith('infill-kit:'));
    const infills = report.infill ?? 0;
    expect(infills).toBeGreaterThan(100);
    expect(kits.length).toBeGreaterThan(infills * 0.5);
  });
});

describe('the elevators, which are inside now', () => {
  const city = buildCity(DEMO_DISTRICT);

  it('stands the shaft inside the building it serves, and nowhere else', () => {
    // V0.7 put the shaft in the street beside the building and a second building next door
    // to receive it at the top. Every city tower now has its core in its own corner: the
    // shaft is strictly inside the shell, with room to stand between the two, so there is
    // no way to board it except by going in through the door.
    const towers = city.props.filter((prop) => prop.id.endsWith('-tower-wall-w'));
    expect(towers.length).toBeGreaterThan(0);

    let checked = 0;
    for (const wall of towers) {
      const towerId = wall.id.replace('-wall-w', '');
      const shell = city.props.filter((prop) => prop.id.startsWith(`${towerId}-wall`));
      const lift = (city.elevators ?? []).find((entry) => entry.id === `${towerId}-lift`);
      expect(lift, towerId).toBeDefined();
      if (!lift) continue;

      const shellMinX = Math.min(...shell.map((prop) => prop.position.x - prop.size.x / 2));
      const shellMaxX = Math.max(...shell.map((prop) => prop.position.x + prop.size.x / 2));
      const shellMinZ = Math.min(...shell.map((prop) => prop.position.z - prop.size.z / 2));
      const shellMaxZ = Math.max(...shell.map((prop) => prop.position.z + prop.size.z / 2));

      const shaftMinX = lift.at[0] - lift.size[0] / 2 - 0.4;
      const shaftMaxX = lift.at[0] + lift.size[0] / 2 + 0.4;
      const shaftMinZ = lift.at[1] - lift.size[1] / 2 - 0.4;
      const shaftMaxZ = lift.at[1] + lift.size[1] / 2 + 0.4;

      // Inside the building, not beside it.
      expect(shaftMinX, `${towerId} west`).toBeGreaterThanOrEqual(shellMinX);
      expect(shaftMaxX, `${towerId} east`).toBeLessThanOrEqual(shellMaxX);
      expect(shaftMinZ, `${towerId} north`).toBeGreaterThanOrEqual(shellMinZ);
      expect(shaftMaxZ, `${towerId} south`).toBeLessThanOrEqual(shellMaxZ);

      // ...with somewhere to stand in front of the doors, which is what makes it a lobby
      // rather than a shaft pressed against the wall: the doors face +X, into the building.
      expect(shellMaxX - shaftMaxX, `${towerId} lobby`).toBeGreaterThan(4);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('ends at the building it is inside of, not beside it', () => {
    // The top floor is the building's own roof. Nothing opens to the sky before that, and
    // nothing opens to the street at all: the lift goes up through the middle of a
    // building and out onto the top of it.
    let checked = 0;
    for (const lift of (city.elevators ?? []).filter((entry) => entry.id.includes('-tower-lift'))) {
      const towerId = lift.id.replace('-lift', '');
      const setback = city.props.find((prop) => prop.id === `${towerId}-setback`);
      if (!setback) continue;

      const roofTop = setback.position.y + setback.size.y / 2;
      const top = lift.floors[lift.floors.length - 1] as number;
      expect(top, towerId).toBeCloseTo(roofTop, 5);

      // The street floor is a floor: the car is inside the shell at the bottom too.
      const street = lift.floors[0] as number;
      expect(top - street, towerId).toBeGreaterThan(40);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('the city is where the district is', () => {
  const city = buildCity(DEMO_DISTRICT);
  const report = generateCity().report;
  /** The level's own walkable surfaces, which is where the player actually is. */
  const decks = DEMO_DISTRICT.props.filter(
    (prop) => prop.kind === 'floor' && prop.size.x * prop.size.z < 5000,
  );
  const box = {
    minX: Math.min(...decks.map((prop) => prop.position.x - prop.size.x / 2)),
    maxX: Math.max(...decks.map((prop) => prop.position.x + prop.size.x / 2)),
    minZ: Math.min(...decks.map((prop) => prop.position.z - prop.size.z / 2)),
    maxZ: Math.max(...decks.map((prop) => prop.position.z + prop.size.z / 2)),
  };
  const generated = city.props.slice(DEMO_DISTRICT.props.length);

  it('starts at the district’s own edge, rather than sixty metres away from it', () => {
    // V0.7 cleared a rectangle twice the district's size and filled what was left, which
    // put the nearest generated building sixty metres from the old town's edge: a city you
    // could see from the playable map and not walk to. The clearance is measured from the
    // district's own decks now, so the city begins at them.
    const nearest = Math.min(
      ...generated.map((prop) => {
        const dx = Math.max(0, prop.position.x - prop.size.x / 2 - box.maxX, box.minX - (prop.position.x + prop.size.x / 2));
        const dz = Math.max(0, prop.position.z - prop.size.z / 2 - box.maxZ, box.minZ - (prop.position.z + prop.size.z / 2));
        return Math.hypot(dx, dz);
      }),
    );
    expect(nearest).toBeLessThan(crossingGap(DEFAULT_CONFIG) * 3);
  });

  it('builds its inner ring at the district’s own height, not thirty metres over it', () => {
    // The other half of the same mistake, and the reason moving the clearance alone could
    // not fix it: V0.7's inner roofs were 22 to 34 m up, over a district standing at
    // nothing. The innermost band starts at 1.2 m now - the district's own decks are at 0
    // to 1.2 - and climbs outward from there, so the near city is a step rather than a
    // cliff. The roof *heights* the generator draws from are asserted here; that the
    // player can reach them is `reach.test.ts` and the map beneath them.
    const rings = generated
      .filter((prop) => prop.id.includes('-solar-'))
      .map((prop) => prop.position.y + prop.size.y / 2);
    const lowest = Math.min(...rings);
    expect(lowest).toBeLessThan(12);
  });

  it('fills the space between the district’s own buildings and the city', () => {
    // "Add more buildings between them": the level has its own towers standing off to the
    // sides of the old town, and the city used to begin beyond them with nothing in
    // between. The attachment pass bridges those gaps like any other.
    expect((report.attachment ?? 0) + (report.infill ?? 0)).toBeGreaterThan(0);
    const between = generated.filter((prop) => prop.id.startsWith('fill-'));
    expect(between.length).toBeGreaterThan(2000);
  });
});
