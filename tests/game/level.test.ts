import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '../../src/core/config.js';
import { aabbFromCenterSize, overlaps } from '../../src/game/physics/aabb.js';
import {
  DEFAULT_PLAYER_SIZE,
  buildLevel,
  groundHeightAt,
  propBounds,
  spawnBounds,
  toColliders,
  resolvePropParts,
  validateLevel,
  type BuildLevelOptions,
} from '../../src/game/level/level.js';
import {
  DEMO_DISTRICT,
  type LevelDefinition,
  type PropDefinition,
} from '../../src/game/level/levelData.js';
import { standingSize } from '../../src/game/player.js';
import { modelById } from '../../src/game/level/models.js';
import { surfaceById, ACOUSTIC_MATERIALS } from '../../src/game/level/surfaces.js';

/** The manoeuvre bands, as the level design reasons about them. */
const PLAYER_MANEUVER = DEFAULT_CONFIG.maneuver;

const SUB_STEP = DEFAULT_CONFIG.world.maxCollisionSubStep;
const PLAYER = DEFAULT_CONFIG.player;
/** Validation always uses the player's largest footprint. */
const STANDING = standingSize(PLAYER);

const BUILD_OPTIONS: BuildLevelOptions = { maxSubStep: SUB_STEP, player: STANDING };

function prop(overrides: Partial<PropDefinition> & { id: string }): PropDefinition {
  return {
    model: 'slab',
    kind: 'prop',
    position: { x: 0, y: 0, z: 0 },
    size: { x: 1, y: 1, z: 1 },
    ...overrides,
  };
}

function level(overrides: Partial<LevelDefinition> = {}): LevelDefinition {
  return { ...DEMO_DISTRICT, ...overrides };
}

function boundsOf(id: string): ReturnType<typeof propBounds> {
  const found = DEMO_DISTRICT.props.find((entry) => entry.id === id);
  expect(found, `expected a prop named ${id}`).toBeDefined();
  return propBounds(found as PropDefinition);
}

describe('the shipped demo roof', () => {
  it('is named and identified', () => {
    expect(DEMO_DISTRICT.id).toBe('demo-district');
    expect(DEMO_DISTRICT.name).toMatch(/rooftop/i);
  });

  it('passes validation', () => {
    expect(validateLevel(DEMO_DISTRICT, BUILD_OPTIONS)).toEqual([]);
  });

  it('builds into a collision world', () => {
    const built = buildLevel(DEMO_DISTRICT, BUILD_OPTIONS);
    // One collider per prop, plus one per door and one per lift: a door and a
    // lift are colliders that are not props.
    expect(built.colliders).toHaveLength(
      DEMO_DISTRICT.props.length +
        (DEMO_DISTRICT.doors?.length ?? 0) +
        (DEMO_DISTRICT.elevators?.length ?? 0),
    );
    expect(built.world.colliders).toHaveLength(built.colliders.length);
    expect(built.definition).toBe(DEMO_DISTRICT);
  });

  it('has unique prop ids', () => {
    const ids = DEMO_DISTRICT.props.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses only positive extents', () => {
    for (const entry of DEMO_DISTRICT.props) {
      expect(entry.size.x).toBeGreaterThan(0);
      expect(entry.size.y).toBeGreaterThan(0);
      expect(entry.size.z).toBeGreaterThan(0);
    }
  });

  it('has no collider thinner than the collision sub-step', () => {
    // The solver clamps itself, but the level should not rely on that.
    for (const entry of DEMO_DISTRICT.props) {
      const bounds = propBounds(entry);
      const thinnest = Math.min(
        bounds.max.x - bounds.min.x,
        bounds.max.y - bounds.min.y,
        bounds.max.z - bounds.min.z,
      );
      expect(thinnest, `${entry.id} is too thin`).toBeGreaterThanOrEqual(SUB_STEP);
    }
  });

  it('spawns the player on top of the deck, clear of all geometry', () => {
    const box = spawnBounds(DEMO_DISTRICT, STANDING);
    for (const entry of DEMO_DISTRICT.props) {
      expect(overlaps(box, propBounds(entry)), `spawn intersects ${entry.id}`).toBe(false);
    }
  });

  it('spawns the player above a solid surface', () => {
    const { x, z } = DEMO_DISTRICT.spawn.position;
    const surface = groundHeightAt(DEMO_DISTRICT, { x, z });
    expect(surface).not.toBeNull();
    expect(surface).toBeCloseTo(0, 9);
    // Feet start just above that surface so gravity has something to prove.
    expect(DEMO_DISTRICT.spawn.position.y).toBeGreaterThan(surface ?? 0);
    expect(DEMO_DISTRICT.spawn.position.y).toBeLessThan((surface ?? 0) + 1);
  });

  it('spawns well inside the deck footprint, away from the edges', () => {
    const deck = boundsOf('deck');
    const margin = 5;
    expect(DEMO_DISTRICT.spawn.position.x).toBeGreaterThan(deck.min.x + margin);
    expect(DEMO_DISTRICT.spawn.position.x).toBeLessThan(deck.max.x - margin);
    expect(DEMO_DISTRICT.spawn.position.z).toBeGreaterThan(deck.min.z + margin);
    expect(DEMO_DISTRICT.spawn.position.z).toBeLessThan(deck.max.z - margin);
  });

  it('has a walkable deck as its highest surface at the spawn', () => {
    // Nothing above head height at the spawn point, so the camera is clear.
    const { x, z } = DEMO_DISTRICT.spawn.position;
    const surface = groundHeightAt(DEMO_DISTRICT, { x, z }, STANDING.height) ?? 0;
    expect(surface).toBeCloseTo(0, 9);
  });

  it('leaves the edges of every roof open', () => {
    // V0.0 walled the roof in because a fall had no consequence. Fall detection,
    // respawn and checkpoints all exist now, so every roof is bare at its edges -
    // which is what makes the gaps between the buildings the real obstacles.
    const decks = DEMO_DISTRICT.props.filter((entry) => entry.id.endsWith('-deck') || entry.id === 'deck');
    expect(decks.length).toBeGreaterThan(1);

    for (const deck of decks) {
      const deckBounds = propBounds(deck);
      const margin = 1;
      for (const wall of DEMO_DISTRICT.props) {
        if (wall.kind !== 'wall') continue;
        const bounds = propBounds(wall);
        // A building's own body is under its deck, so only what rises above the
        // walking surface can be a parapet.
        if (bounds.max.y <= deckBounds.max.y) continue;
        const insideBorderRing =
          bounds.min.x < deckBounds.max.x - margin &&
          bounds.max.x > deckBounds.min.x + margin &&
          bounds.min.z < deckBounds.max.z - margin &&
          bounds.max.z > deckBounds.min.z + margin;
        const touchesEdge =
          bounds.min.x < deckBounds.max.x &&
          bounds.max.x > deckBounds.min.x &&
          bounds.min.z < deckBounds.max.z &&
          bounds.max.z > deckBounds.min.z;
        if (touchesEdge) {
          expect(insideBorderRing, `${wall.id} walls off the edge of ${deck.id}`).toBe(true);
        }
      }
    }
  });

  it('supports every prop on the deck or on another prop', () => {
    // Nothing may float: each prop's underside must coincide with the top of a
    // prop it overlaps in plan. The single lowest prop is the world floor and is
    // allowed to rest on nothing.
    const boundsById = new Map(DEMO_DISTRICT.props.map((entry) => [entry.id, propBounds(entry)]));
    const lowest = DEMO_DISTRICT.props.reduce((best, entry) =>
      (boundsById.get(entry.id)?.min.y ?? 0) < (boundsById.get(best.id)?.min.y ?? 0) ? entry : best,
    );

    // Structures that deliberately span a gap have nothing under them by design,
    // and are checked separately below.
    const spanning = new Set(['canyon-beam', 'facade-canyon']);
    // Signage is bolted to a wall face and neon tube is laid along an edge, so
    // neither is stacked on anything. The flush-underside rule cannot see a wall:
    // a sign shares no *top* face with what holds it up.
    const mounted = new Set(
      DEMO_DISTRICT.props
        .filter((entry) => entry.model === 'neon-sign' || entry.model === 'neon-strip')
        .map((entry) => entry.id),
    );

    const unsupported: string[] = [];
    for (const entry of DEMO_DISTRICT.props) {
      if (entry.id === lowest.id || spanning.has(entry.id) || mounted.has(entry.id)) continue;

      const bounds = boundsById.get(entry.id) as ReturnType<typeof propBounds>;
      const restsOnSomething = DEMO_DISTRICT.props.some((other) => {
        if (other.id === entry.id) return false;
        const otherBounds = boundsById.get(other.id) as ReturnType<typeof propBounds>;
        const flush = Math.abs(otherBounds.max.y - bounds.min.y) < 1e-6;
        const overlapsInPlan =
          bounds.min.x < otherBounds.max.x &&
          bounds.max.x > otherBounds.min.x &&
          bounds.min.z < otherBounds.max.z &&
          bounds.max.z > otherBounds.min.z;
        return flush && overlapsInPlan;
      });

      if (!restsOnSomething) unsupported.push(entry.id);
    }

    expect(unsupported).toEqual([]);
  });

  it('spans the canyon with structures that bridge two different roofs', () => {
    // The beam and the facade are the only props that carry nothing: one is the
    // slow route across the 12 m gap, the other is the wall the fast route runs
    // along. Both have to reach from one roof to the other, or neither works.
    const decks = DEMO_DISTRICT.props.filter((entry) => entry.id.endsWith('-deck') || entry.id === 'deck');

    for (const id of ['canyon-beam', 'facade-canyon']) {
      const bounds = boundsOf(id);
      const reach = 0.6;
      const neighbours = decks.filter((deck) => {
        const deckBounds = propBounds(deck);
        return (
          bounds.min.x < deckBounds.max.x + reach &&
          bounds.max.x > deckBounds.min.x - reach &&
          bounds.min.z < deckBounds.max.z + reach &&
          bounds.max.z > deckBounds.min.z - reach
        );
      });
      expect(neighbours.length, `${id} must bridge two roofs`).toBeGreaterThanOrEqual(2);
    }
  });

  it('has a canyon wider than a sprint jump can clear', () => {
    // The gaps that a jump can cross are the easy ones. The canyon is the one
    // that needs a wall run, so it has to be genuinely out of jumping range.
    const high = boundsOf('high-deck');
    const far = boundsOf('far-deck');
    const gap = far.min.x - high.max.x;
    const apex = (PLAYER.jumpSpeed * PLAYER.jumpSpeed) / (2 * PLAYER.gravity);
    const airtime = (2 * PLAYER.jumpSpeed) / PLAYER.gravity;
    const jumpReach = PLAYER.sprintSpeed * airtime;

    expect(gap).toBeGreaterThan(jumpReach);
    expect(gap).toBeGreaterThan(10);
    // ...and close enough that a wall run, which is a slow fall rather than a
    // glide, still gets across it.
    expect(gap).toBeLessThan(PLAYER.sprintSpeed * PLAYER_MANEUVER.wallRun.maxSeconds);
    expect(apex).toBeGreaterThan(0);
  });

  it('gives every prop a valid model and valid tints', () => {
    for (const entry of DEMO_DISTRICT.props) {
      expect(modelById(entry.model), `${entry.id} references ${entry.model}`).toBeDefined();
      for (const [surfaceId, tint] of Object.entries(entry.tints ?? {})) {
        expect(surfaceById(surfaceId), `${entry.id} tint ${surfaceId}`).toBeDefined();
        expect(tint, `${entry.id} tint ${surfaceId}`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it('resolves every prop into model parts', () => {
    for (const entry of DEMO_DISTRICT.props) {
      const parts = resolvePropParts(entry);
      expect(parts.length, entry.id).toBeGreaterThan(0);
      for (const part of parts) {
        // Parts are normalised against the prop's box, so they must land inside
        // it - or just outside it, for deliberate overhangs.
        expect(part.max.x, entry.id).toBeGreaterThan(part.min.x);
        expect(part.max.y, entry.id).toBeGreaterThan(part.min.y);
        expect(part.max.z, entry.id).toBeGreaterThan(part.min.z);
      }
    }
  });

  it('uses a surface the surface table defines', () => {
    for (const entry of DEMO_DISTRICT.props) {
      for (const part of resolvePropParts(entry)) {
        expect(surfaceById(part.surface), `${entry.id} -> ${part.surface}`).toBeDefined();
      }
    }
  });

  it('describes an environment with a fog range, a key light and a backdrop', () => {
    const environment = DEMO_DISTRICT.environment;
    expect(environment.fogFar).toBeGreaterThan(environment.fogNear);
    expect(environment.sunIntensity).toBeGreaterThan(0);
    expect(environment.ambientIntensity).toBeGreaterThan(0);
    expect(environment.backdrop.radius).toBeGreaterThan(0);
    expect(environment.backdrop.height).toBeGreaterThan(0);
    for (const color of [
      environment.skyColor,
      environment.fogColor,
      environment.sunColor,
      environment.ambientSkyColor,
      environment.ambientGroundColor,
    ]) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('places the skyline ground line at or below the city ground', () => {
    // The backdrop's base must not float above the ground plane, or the city
    // would appear to hover.
    expect(DEMO_DISTRICT.environment.backdrop.baseY).toBeLessThanOrEqual(-34.8);
  });
});

describe('the demo roof supports the V0.1 abilities', () => {
  it('steps every riser of the roof access inside the mantle band', () => {
    // Which is what makes a staircase walkable without a single keypress.
    const { minHeight, maxHeight } = PLAYER_MANEUVER.mantle;
    const flight = DEMO_DISTRICT.props.filter((entry) => entry.id.startsWith('penthouse-step-'));
    expect(flight.length).toBeGreaterThan(1);

    const risers = flight
      .map((entry) => propBounds(entry).max.y)
      .sort((a, b) => a - b);
    // Each step is one riser above the one before it.
    for (let index = 1; index < risers.length; index += 1) {
      const rise = (risers[index] as number) - (risers[index - 1] as number);
      expect(rise).toBeGreaterThanOrEqual(minHeight);
      expect(rise).toBeLessThanOrEqual(maxHeight);
    }
    expect(risers[0] as number).toBeGreaterThanOrEqual(minHeight);
  });

  it('has a roof only a pull-up can reach from the deck', () => {
    // The annex is 2 m above the home deck: too high to step onto, low enough to
    // catch - which is the band the grab exists for.
    const mantle = PLAYER_MANEUVER.mantle;
    const pullUp = PLAYER_MANEUVER.pullUp;
    const rise = boundsOf('annex-deck').max.y - boundsOf('deck').max.y;

    expect(rise).toBeGreaterThan(mantle.maxHeight);
    expect(rise).toBeLessThanOrEqual(pullUp.maxHeight);
  });

  it('has a climbable route taller than any grab can reach', () => {
    const pullUp = PLAYER_MANEUVER.pullUp;
    const climbable = DEMO_DISTRICT.props.filter((entry) => entry.climbable === true);
    expect(climbable.length).toBeGreaterThan(0);

    // Climbing is what gets you somewhere a pull-up cannot.
    const tallest = Math.max(...climbable.map((entry) => propBounds(entry).max.y));
    expect(tallest).toBeGreaterThan(pullUp.maxHeight);
  });

  it('keeps every roof within reach of the one before it', () => {
    // The chain the route follows: home, annex, east, high. Each gap is crossable
    // by a jump plus a grab, which is the ability the gaps are sized around.
    const pullUp = PLAYER_MANEUVER.pullUp;
    const chain = ['deck', 'annex-deck', 'east-deck', 'high-deck'];
    const apex = (PLAYER.jumpSpeed * PLAYER.jumpSpeed) / (2 * PLAYER.gravity);

    for (let index = 1; index < chain.length; index += 1) {
      const rise = boundsOf(chain[index] as string).max.y - boundsOf(chain[index - 1] as string).max.y;
      expect(rise, `${chain[index]} is too far above ${chain[index - 1]}`).toBeLessThanOrEqual(
        apex + pullUp.maxHeight,
      );
    }
  });

  it('has a duct that can only be passed while crouched', () => {
    const clearance = boundsOf('duct').min.y;
    expect(clearance).toBeLessThan(PLAYER.standHeight);
    expect(clearance).toBeGreaterThan(PLAYER.crouchHeight);
  });

  it('gives the duct supports that reach exactly up to it', () => {
    const duct = boundsOf('duct');
    for (const id of ['duct-support-north', 'duct-support-south']) {
      expect(boundsOf(id).max.y).toBeCloseTo(duct.min.y, 9);
    }
  });

  it('places the duct supports clear of the passage through it', () => {
    // The gap between the supports is what the player crawls through.
    const north = boundsOf('duct-support-north');
    const south = boundsOf('duct-support-south');
    expect(north.min.z - south.max.z).toBeGreaterThan(2 * STANDING.radius + 1);
  });

  it('sets the kill plane far below the deck but above the city ground', () => {
    expect(DEMO_DISTRICT.killPlaneY).toBeLessThan(0);
    expect(DEMO_DISTRICT.killPlaneY).toBeGreaterThan(boundsOf('city-ground').max.y);
  });

  it('has room to sprint: more than 30 m of diagonal deck', () => {
    const deck = boundsOf('deck');
    const diagonal = Math.hypot(deck.max.x - deck.min.x, deck.max.z - deck.min.z);
    expect(diagonal).toBeGreaterThan(30);
  });
});

describe('propBounds', () => {
  it('converts a centred prop into min/max bounds', () => {
    const bounds = propBounds(
      prop({ id: 'p', position: { x: 2, y: 3, z: 4 }, size: { x: 10, y: 2, z: 6 } }),
    );
    expect(bounds.min).toEqual({ x: -3, y: 2, z: 1 });
    expect(bounds.max).toEqual({ x: 7, y: 4, z: 7 });
  });
});

describe('spawnBounds', () => {
  it('builds a player-sized box at the spawn point', () => {
    const box = spawnBounds(DEMO_DISTRICT, { radius: 0.5, height: 2 });
    const { x, y, z } = DEMO_DISTRICT.spawn.position;
    expect(box.min).toEqual({ x: x - 0.5, y, z: z - 0.5 });
    expect(box.max).toEqual({ x: x + 0.5, y: y + 2, z: z + 0.5 });
  });
});

describe('toColliders', () => {
  it('preserves ids and kinds', () => {
    const colliders = toColliders(DEMO_DISTRICT);
    expect(colliders.slice(0, DEMO_DISTRICT.props.length).map((entry) => entry.id)).toEqual(
      DEMO_DISTRICT.props.map((entry) => entry.id),
    );
    expect(colliders.find((entry) => entry.id === 'deck')?.kind).toBe('floor');
    expect(colliders.find((entry) => entry.id === 'penthouse')?.kind).toBe('wall');
    expect(colliders.find((entry) => entry.id === 'duct')?.kind).toBe('prop');
    // V0.4 kinds: a pipe is a two-way climbable, and every door is a collider the
    // game may switch off.
    expect(colliders.find((entry) => entry.id === 'pipe-east')?.kind).toBe('pipe');
    for (const door of DEMO_DISTRICT.doors ?? []) {
      expect(colliders.find((entry) => entry.id === door.id)?.kind).toBe('door');
    }
  });

  it('gives every collider a footstep surface to walk on', () => {
    // V0.4: the sound of a step follows from what the prop is made of, so every
    // collider carries an acoustic material.
    for (const collider of toColliders(DEMO_DISTRICT)) {
      expect(collider.surface, collider.id).toBeDefined();
      expect(ACOUSTIC_MATERIALS).toContain(collider.surface);
    }
  });
});

describe('validateLevel', () => {
  it('accepts a sound level', () => {
    expect(validateLevel(level(), BUILD_OPTIONS)).toEqual([]);
  });

  it('flags a level with no props', () => {
    const problems = validateLevel(level({ props: [] }), BUILD_OPTIONS);
    expect(problems.map((problem) => problem.message)).toContain('level has no props');
  });

  it('flags duplicate prop ids', () => {
    const problems = validateLevel(
      level({ props: [prop({ id: 'dup' }), prop({ id: 'dup', position: { x: 50, y: 0, z: 50 } })] }),
      BUILD_OPTIONS,
    );
    const duplicates = problems.filter((problem) => /duplicate prop id/.test(problem.message));
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]?.prop).toBe('dup');
  });

  it('flags a non-positive extent on any axis', () => {
    const problems = validateLevel(
      level({ props: [prop({ id: 'flat', size: { x: 1, y: 0, z: 1 } })] }),
      BUILD_OPTIONS,
    );
    expect(problems.map((problem) => problem.message)).toContain('size.y must be > 0');
  });

  it('flags colliders thinner than the collision sub-step', () => {
    const problems = validateLevel(
      level({ props: [prop({ id: 'wafer', size: { x: 10, y: 0.05, z: 10 } })] }),
      BUILD_OPTIONS,
    );
    const thin = problems.filter((problem) => /collision sub-step/.test(problem.message));
    expect(thin).toHaveLength(1);
    expect(thin[0]?.prop).toBe('wafer');
  });

  it('flags a spawn point buried inside geometry', () => {
    const problems = validateLevel(
      level({
        spawn: { position: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0 },
        props: [prop({ id: 'block', position: { x: 0, y: 1, z: 0 }, size: { x: 4, y: 4, z: 4 } })],
      }),
      BUILD_OPTIONS,
    );
    expect(problems.map((problem) => problem.message).join()).toMatch(
      /spawn point intersects prop "block"/,
    );
  });

  it('flags a spawn point with nothing underneath it', () => {
    const problems = validateLevel(
      level({
        spawn: { position: { x: 900, y: 0.5, z: 900 }, yaw: 0, pitch: 0 },
        props: [
          prop({
            id: 'deck',
            kind: 'floor',
            position: { x: 0, y: -0.4, z: 0 },
            size: { x: 20, y: 0.8, z: 20 },
          }),
        ],
      }),
      BUILD_OPTIONS,
    );
    expect(problems.map((problem) => problem.message)).toContain(
      'spawn point has no surface beneath it',
    );
  });

  it('flags a spawn point left hanging far above the surface', () => {
    const problems = validateLevel(
      level({
        spawn: { position: { x: 0, y: 40, z: 0 }, yaw: 0, pitch: 0 },
        props: [
          prop({
            id: 'deck',
            kind: 'floor',
            position: { x: 0, y: -0.4, z: 0 },
            size: { x: 20, y: 0.8, z: 20 },
          }),
        ],
      }),
      BUILD_OPTIONS,
    );
    expect(problems.map((problem) => problem.message).join()).toMatch(
      /spawn point is 40\.00m above the surface/,
    );
  });

  it('flags a kill plane that is not a finite number', () => {
    const problems = validateLevel(level({ killPlaneY: Number.NaN }), BUILD_OPTIONS);
    expect(problems.map((problem) => problem.message)).toContain(
      'killPlaneY must be a finite number',
    );
  });

  it('flags a kill plane at or above the spawn point', () => {
    const problems = validateLevel(level({ killPlaneY: 5 }), BUILD_OPTIONS);
    expect(problems.map((problem) => problem.message).join()).toMatch(
      /killPlaneY \(5\) is not below the spawn point/,
    );
  });

  it('flags a kill plane too close to the walkable surface', () => {
    const problems = validateLevel(level({ killPlaneY: -0.5 }), BUILD_OPTIONS);
    expect(problems.map((problem) => problem.message).join()).toMatch(
      /within 1m of the walkable surface/,
    );
  });

  it('flags an environment with an inverted fog range', () => {
    const definitions = level();
    const problems = validateLevel(
      { ...definitions, environment: { ...definitions.environment, fogNear: 500, fogFar: 100 } },
      BUILD_OPTIONS,
    );
    expect(problems.map((problem) => problem.message)).toContain(
      'environment.fogFar must be greater than fogNear',
    );
  });

  it('flags a backdrop that sits inside the fog, where it would be invisible', () => {
    const definitions = level();
    const problems = validateLevel(
      {
        ...definitions,
        environment: {
          ...definitions.environment,
          backdrop: { ...definitions.environment.backdrop, radius: 10 },
        },
      },
      BUILD_OPTIONS,
    );
    expect(problems.map((problem) => problem.message)).toContain(
      'environment.backdrop.radius should be beyond fogNear, or the skyline is invisible',
    );
  });

  it('flags a prop that names a model which does not exist', () => {
    const problems = validateLevel(
      level({ props: [prop({ id: 'ghost', model: 'not-a-model', kind: 'floor', position: { x: 0, y: -0.5, z: 0 }, size: { x: 20, y: 1, z: 20 } })] }),
      BUILD_OPTIONS,
    );
    expect(problems.map((problem) => problem.message)).toContain('unknown model "not-a-model"');
  });

  it('flags a tint that names a surface which does not exist', () => {
    const problems = validateLevel(
      level({
        props: [
          prop({
            id: 'decked',
            kind: 'floor',
            position: { x: 0, y: -0.5, z: 0 },
            size: { x: 20, y: 1, z: 20 },
            tints: { 'not-a-surface': '#ffffff' },
          }),
        ],
      }),
      BUILD_OPTIONS,
    );
    expect(problems.map((problem) => problem.message)).toContain(
      'tint references unknown surface "not-a-surface"',
    );
  });

  it('flags an unparseable environment colour', () => {
    const definitions = level();
    const problems = validateLevel(
      { ...definitions, environment: { ...definitions.environment, skyColor: 'blue' } },
      BUILD_OPTIONS,
    );
    expect(problems.map((problem) => problem.message)).toContain(
      'environment.skyColor must be a #rrggbb colour',
    );
  });

  it('reports the level id on every problem', () => {
    const problems = validateLevel(level({ props: [] }), BUILD_OPTIONS);
    expect(problems.every((problem) => problem.level === DEMO_DISTRICT.id)).toBe(true);
  });

  it('falls back to default player dimensions when none are given', () => {
    const buried = level({
      spawn: { position: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0 },
      props: [prop({ id: 'block', position: { x: 0, y: 0.9, z: 0 }, size: { x: 2, y: 1.8, z: 2 } })],
    });
    // The default box is 0.35 x 1.8; that still intersects the block.
    expect(validateLevel(buried).map((problem) => problem.prop)).toContain('block');
    expect(DEFAULT_PLAYER_SIZE.radius).toBeCloseTo(0.35, 12);
  });
});

describe('buildLevel', () => {
  it('throws with a readable report when the level is invalid', () => {
    expect(() =>
      buildLevel(level({ id: 'broken', props: [prop({ id: 'dup' }), prop({ id: 'dup' })] }), BUILD_OPTIONS),
    ).toThrow(/Invalid level "broken"/);
  });

  it('names the offending prop in the error message', () => {
    expect(() =>
      buildLevel(level({ props: [prop({ id: 'wafer', size: { x: 1, y: 0.01, z: 1 } })] }), BUILD_OPTIONS),
    ).toThrow(/\[wafer\]/);
  });

  it('produces a world whose sub-step respects the level thickness', () => {
    const built = buildLevel(DEMO_DISTRICT, BUILD_OPTIONS);
    expect(built.world.subStep).toBeCloseTo(SUB_STEP, 12);
  });

  it('produces a world that catches a falling player', () => {
    const built = buildLevel(DEMO_DISTRICT, BUILD_OPTIONS);
    const box = spawnBounds(DEMO_DISTRICT, STANDING);
    box.min.y = 20;
    box.max.y = 20 + STANDING.height;

    const velocity = { x: 0, y: -20, z: 0 };
    const result = built.world.move(box, { x: 0, y: -20, z: 0 }, velocity);

    expect(result.grounded).toBe(true);
    expect(result.groundId).toBe('deck');
    expect(velocity.y).toBe(0);
    // Either left exactly flush or pushed out by one collision skin - never
    // inside the deck.
    expect(box.min.y).toBeGreaterThanOrEqual(-0.001);
    expect(box.min.y).toBeLessThanOrEqual(0.001);
  });
});

describe('groundHeightAt', () => {
  it('finds the deck under the spawn point', () => {
    const spawn = DEMO_DISTRICT.spawn.position;
    expect(groundHeightAt(DEMO_DISTRICT, { x: spawn.x, z: spawn.z })).toBeCloseTo(0, 9);
  });

  it('respects an upper limit so overhead geometry is ignored', () => {
    // The stacked crates top out at 2.8 m.
    const stack = DEMO_DISTRICT.props.find((entry) => entry.id === 'crate-home-c');
    const at = { x: stack?.position.x ?? 0, z: stack?.position.z ?? 0 };
    expect(groundHeightAt(DEMO_DISTRICT, at)).toBeCloseTo(2.8, 9);
    expect(groundHeightAt(DEMO_DISTRICT, at, 2)).toBeCloseTo(1.4, 9);
  });

  it('finds the duct overhead, not the deck, when the limit allows', () => {
    expect(groundHeightAt(DEMO_DISTRICT, { x: 4, z: 6 })).toBeCloseTo(2.6, 9);
  });

  it('returns null for a point outside every collider footprint', () => {
    expect(groundHeightAt(DEMO_DISTRICT, { x: 900, z: 900 })).toBeNull();
  });

  it('ignores geometry that does not span the point in both axes', () => {
    expect(groundHeightAt(DEMO_DISTRICT, { x: 4, z: 6 })).toBeCloseTo(2.6, 9);
    expect(groundHeightAt(DEMO_DISTRICT, { x: 4, z: -8 })).toBeCloseTo(0, 9);
  });
});

describe('the V0.4 interiors, doors, signage and pipes', () => {
  const doors = DEMO_DISTRICT.doors ?? [];

  it('gives every room a door, a roof and a full set of walls', () => {
    expect(doors.length).toBeGreaterThanOrEqual(2);
    const ids = new Set(DEMO_DISTRICT.props.map((entry) => entry.id));
    for (const door of doors) {
      const prefix = door.id.replace(/-door$/, '');
      for (const part of ['wall-w', 'wall-e', 'wall-back', 'wall-front-l', 'wall-front-r', 'lintel', 'roof']) {
        expect(ids.has(`${prefix}-${part}`), `${prefix}-${part}`).toBe(true);
      }
    }
  });

  it('stands every room on a roof rather than over the void', () => {
    for (const door of doors) {
      const floor = door.position.y - door.size.y / 2;
      const surface = groundHeightAt(DEMO_DISTRICT, { x: door.position.x, z: door.position.z }, floor + 0.01);
      expect(surface, door.id).not.toBeNull();
      // The room's floor is the deck it stands on, so the doorway has no lip.
      expect(surface ?? 0, door.id).toBeCloseTo(floor, 3);
    }
  });

  it('keeps the doorway clear, so an open door is actually passable', () => {
    // Nothing but the door itself may occupy the doorway's volume. The jambs and
    // the lintel share its faces without overlapping it, which is the difference
    // between a doorway and a blocked one.
    const margin = 1e-6;
    for (const door of doors) {
      const doorway = aabbFromCenterSize(door.position, door.size);
      for (const prop of DEMO_DISTRICT.props) {
        const box = propBounds(prop);
        const blocks =
          box.min.x < doorway.max.x - margin &&
          box.max.x > doorway.min.x + margin &&
          box.min.y < doorway.max.y - margin &&
          box.max.y > doorway.min.y + margin &&
          box.min.z < doorway.max.z - margin &&
          box.max.z > doorway.min.z + margin;
        expect(blocks, `${prop.id} blocks ${door.id}`).toBe(false);
      }
    }
  });

  it('lights every room from the inside', () => {
    for (const door of doors) {
      const light = (DEMO_DISTRICT.lights ?? []).find(
        (entry) =>
          Math.abs(entry.position.x - door.position.x) < 5 &&
          Math.abs(entry.position.z - door.position.z) < 5 &&
          entry.position.y > door.position.y - 2,
      );
      expect(light, door.id).toBeDefined();
    }
  });

  it('hangs every sign on a surface that lights itself', () => {
    const signs = DEMO_DISTRICT.props.filter((entry) => entry.model === 'neon-sign');
    expect(signs.length).toBeGreaterThanOrEqual(3);
    for (const entry of signs) {
      const model = modelById(entry.model);
      const lit = (model?.parts ?? []).filter((part) => surfaceById(part.surface)?.emissive === true);
      expect(lit.length, entry.id).toBeGreaterThan(0);
    }
  });

  it('gives the pipe a roof to top out onto', () => {
    const pipe = DEMO_DISTRICT.props.find((entry) => entry.pipe === true);
    expect(pipe).toBeDefined();
    if (!pipe) throw new Error('expected a climbable pipe');

    const top = propBounds(pipe).max.y;
    // Just inside the pipe, the room's roof is at the same height as the pipe's
    // head - so the climb ends on a surface rather than in the air.
    const beside = groundHeightAt(DEMO_DISTRICT, { x: pipe.position.x - 0.6, z: pipe.position.z }, top + 1);
    expect(beside).not.toBeNull();
    expect(Math.abs((beside ?? 0) - top)).toBeLessThan(0.05);
  });
});

describe('the V0.5 works level, lifts and the run', () => {
  const decks = (): readonly PropDefinition[] =>
    DEMO_DISTRICT.props.filter((entry) => entry.id.endsWith('-deck') || entry.id === 'deck');

  const topOf = (id: string): number => {
    const prop = DEMO_DISTRICT.props.find((entry) => entry.id === id);
    expect(prop, `expected a prop named ${id}`).toBeDefined();
    return propBounds(prop as PropDefinition).max.y;
  };

  const liftById = (id: string) => {
    const found = (DEMO_DISTRICT.elevators ?? []).find((entry) => entry.id === id);
    expect(found, `expected a lift named ${id}`).toBeDefined();
    return found as NonNullable<(typeof DEMO_DISTRICT.elevators)>[number];
  };

  it('adds a lower level of four roofs, reached by lift', () => {
    const works = DEMO_DISTRICT.props.filter(
      (entry) => entry.id.startsWith('works-') && entry.id.endsWith('-deck'),
    );
    expect(works).toHaveLength(4);
    // Every one of them is below the roof line, so the district has a basement
    // rather than being one flat plane.
    for (const deck of works) {
      expect(propBounds(deck).max.y, deck.id).toBeLessThan(0);
    }
  });

  it('keeps the works roofs within a jump of each other', () => {
    const runs = DEMO_DISTRICT.props
      .filter((entry) => entry.id.startsWith('works-') && entry.id.endsWith('-deck'))
      .map((entry) => propBounds(entry))
      .sort((a, b) => a.min.x - b.min.x);

    for (let index = 1; index < runs.length; index += 1) {
      const left = runs[index - 1] as ReturnType<typeof propBounds>;
      const right = runs[index] as ReturnType<typeof propBounds>;
      expect(right.min.x - left.max.x, `${index}`).toBeLessThanOrEqual(5);
      expect(Math.abs(right.max.y - left.max.y), `${index}`).toBeLessThan(1.5);
    }
  });

  it('keeps every walkable deck well above the kill plane', () => {
    const lowest = Math.min(...decks().map((deck) => propBounds(deck).max.y));
    expect(lowest).toBeGreaterThan(DEMO_DISTRICT.killPlaneY + 5);
  });

  it('connects the route with lifts that arrive exactly at the floors they serve', () => {
    // This is the whole contract of a lift: it starts and ends *flush*, so getting
    // on and off is a step and not a climb - and a fraction out either way would
    // be an invisible lip the mantle band will not take.
    const down = liftById('lift-down');
    expect(down.highTop).toBeCloseTo(topOf('far-deck'), 9);
    expect(down.lowTop).toBeCloseTo(topOf('works-1-deck'), 9);

    const up = liftById('lift-up');
    expect(up.lowTop).toBeCloseTo(topOf('works-4-deck'), 9);
    expect(up.highTop).toBeCloseTo(topOf('deck'), 9);
  });

  it('gives a lift enough travel to be worth riding', () => {
    for (const lift of DEMO_DISTRICT.elevators ?? []) {
      expect(lift.highTop - lift.lowTop, lift.id).toBeGreaterThan(1);
      // Thin platforms are what the sub-step exists to catch.
      expect(lift.thickness, lift.id).toBeGreaterThanOrEqual(SUB_STEP);
    }
  });

  it('hangs every pickup within reach of something you can stand on', () => {
    const pickups = DEMO_DISTRICT.collectibles ?? [];
    expect(pickups.length).toBeGreaterThanOrEqual(6);

    for (const pickup of pickups) {
      const surface = groundHeightAt(
        DEMO_DISTRICT,
        { x: pickup.position.x, z: pickup.position.z },
        pickup.position.y,
      );
      expect(surface, pickup.id).not.toBeNull();
      // Close enough to be taken by walking under it or standing on the thing it
      // is above, rather than only by a perfectly-timed jump.
      expect(pickup.position.y - (surface ?? 0), pickup.id).toBeLessThan(1.6);
    }
  });

  it('puts the finish on a roof', () => {
    const goal = DEMO_DISTRICT.goal;
    expect(goal).toBeDefined();
    if (!goal) throw new Error('expected a goal');

    const surface = groundHeightAt(
      DEMO_DISTRICT,
      { x: goal.position.x, z: goal.position.z },
      goal.position.y + 0.01,
    );
    expect(surface).not.toBeNull();
    expect(surface ?? 0).toBeCloseTo(goal.position.y, 6);
  });

  it('ends the route in the works, which is what arms the finish', () => {
    const checkpoints = DEMO_DISTRICT.checkpoints;
    const last = checkpoints[checkpoints.length - 1];
    expect(last).toBeDefined();
    expect((last?.position.y ?? 0) < 0, 'the last checkpoint is on the lower level').toBe(true);
  });

  it('anchors every smoke plume above ground, with sane numbers', () => {
    const plumes = DEMO_DISTRICT.smoke ?? [];
    expect(plumes.length).toBeGreaterThanOrEqual(4);

    for (const plume of plumes) {
      expect(groundHeightAt(DEMO_DISTRICT, { x: plume.position.x, z: plume.position.z }), plume.id).not.toBeNull();
      expect(plume.count, plume.id).toBeGreaterThan(0);
      expect(plume.period, plume.id).toBeGreaterThan(0);
      expect(plume.opacity, plume.id).toBeGreaterThan(0);
      expect(plume.opacity, plume.id).toBeLessThanOrEqual(1);
      expect(plume.rise, plume.id).toBeGreaterThan(0);
    }
  });

  it('lights the district with bands and signs, not only the rooms', () => {
    const lit = DEMO_DISTRICT.props.filter(
      (entry) => entry.model === 'neon-sign' || entry.model === 'neon-strip',
    );
    expect(lit.length).toBeGreaterThanOrEqual(8);

    for (const entry of lit) {
      const model = modelById(entry.model);
      const emissive = (model?.parts ?? []).filter((part) => surfaceById(part.surface)?.emissive === true);
      expect(emissive.length, entry.id).toBeGreaterThan(0);
    }
  });

  it('lights the lifts and the finish, so they read as somewhere to go', () => {
    const ids = new Set((DEMO_DISTRICT.lights ?? []).map((light) => light.id));
    expect(ids.has('lamp-lift-down')).toBe(true);
    expect(ids.has('lamp-lift-up')).toBe(true);
    expect(ids.has('glow-goal')).toBe(true);
  });
});

describe('the mounted neon', () => {
  /**
   * Two lit faces at the same depth and covering the same pixels are the one
   * arrangement a depth buffer cannot resolve: the test is a tie, so which surface
   * wins is decided by rounding, and the pair speckles and crawls as the camera
   * moves. Every mounted plate therefore needs a standoff of its own.
   *
   * (A plate a few millimetres in front of the wall behind it is *not* a problem -
   * its rear face points away from the camera and is culled - so the gap to the
   * wall is a look decision. The gap to another plate is a bug.)
   */
  const PLANE_TOLERANCE = 0.02;

  const spans = (a: number, b: number): readonly [number, number] => [a, b];
  const overlap = (a: readonly [number, number], b: readonly [number, number]): boolean =>
    a[0] < b[1] && b[0] < a[1];

  it('hangs no two plates on the same plane', () => {
    const built = buildLevel(DEMO_DISTRICT, BUILD_OPTIONS);
    const plates = built.colliders.filter((collider) => /^(sign|strip)-/.test(collider.id));
    expect(plates.length).toBeGreaterThan(0);

    const clashes: string[] = [];
    for (let i = 0; i < plates.length; i += 1) {
      for (let j = i + 1; j < plates.length; j += 1) {
        const a = plates[i]!;
        const b = plates[j]!;
        if (!overlap(spans(a.box.min.x, a.box.max.x), spans(b.box.min.x, b.box.max.x))) continue;
        if (!overlap(spans(a.box.min.y, a.box.max.y), spans(b.box.min.y, b.box.max.y))) continue;
        if (Math.abs(a.box.max.z - b.box.max.z) < PLANE_TOLERANCE) {
          clashes.push(`${a.id} and ${b.id} both light the plane z=${a.box.max.z.toFixed(3)}`);
        }
      }
    }

    expect(clashes).toEqual([]);
  });
});
