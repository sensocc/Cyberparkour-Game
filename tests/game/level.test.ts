import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '../../src/core/config.js';
import { overlaps } from '../../src/game/physics/aabb.js';
import {
  DEFAULT_PLAYER_SIZE,
  buildLevel,
  groundHeightAt,
  propBounds,
  spawnBounds,
  toColliders,
  validateLevel,
  type BuildLevelOptions,
} from '../../src/game/level/level.js';
import {
  DEMO_ROOF,
  type LevelDefinition,
  type PropDefinition,
} from '../../src/game/level/levelData.js';

const SUB_STEP = DEFAULT_CONFIG.world.maxCollisionSubStep;
const PLAYER = DEFAULT_CONFIG.player;

const BUILD_OPTIONS: BuildLevelOptions = { maxSubStep: SUB_STEP, player: PLAYER };

function prop(overrides: Partial<PropDefinition> & { id: string }): PropDefinition {
  return {
    kind: 'prop',
    position: { x: 0, y: 0, z: 0 },
    size: { x: 1, y: 1, z: 1 },
    color: '#ffffff',
    ...overrides,
  };
}

function level(overrides: Partial<LevelDefinition> = {}): LevelDefinition {
  return { ...DEMO_ROOF, ...overrides };
}

describe('the shipped demo roof', () => {
  it('is named and identified', () => {
    expect(DEMO_ROOF.id).toBe('demo-roof');
    expect(DEMO_ROOF.name).toMatch(/rooftop/i);
  });

  it('passes validation', () => {
    expect(validateLevel(DEMO_ROOF, BUILD_OPTIONS)).toEqual([]);
  });

  it('builds into a collision world', () => {
    const built = buildLevel(DEMO_ROOF, BUILD_OPTIONS);
    expect(built.colliders).toHaveLength(DEMO_ROOF.props.length);
    expect(built.world.colliders).toHaveLength(built.colliders.length);
    expect(built.definition).toBe(DEMO_ROOF);
  });

  it('has unique prop ids', () => {
    const ids = DEMO_ROOF.props.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses only positive extents', () => {
    for (const entry of DEMO_ROOF.props) {
      expect(entry.size.x).toBeGreaterThan(0);
      expect(entry.size.y).toBeGreaterThan(0);
      expect(entry.size.z).toBeGreaterThan(0);
    }
  });

  it('has no collider thinner than the collision sub-step', () => {
    // The solver clamps itself, but the level should not rely on that.
    for (const entry of DEMO_ROOF.props) {
      const bounds = propBounds(entry);
      const thinnest = Math.min(
        bounds.max.x - bounds.min.x,
        bounds.max.y - bounds.min.y,
        bounds.max.z - bounds.min.z,
      );
      expect(thinnest, `${entry.id} is too thin`).toBeGreaterThanOrEqual(SUB_STEP);
    }
  });

  it('spawns the player on top of the roof deck, clear of all geometry', () => {
    const box = spawnBounds(DEMO_ROOF, PLAYER);
    for (const entry of DEMO_ROOF.props) {
      expect(overlaps(box, propBounds(entry)), `spawn intersects ${entry.id}`).toBe(false);
    }
  });

  it('spawns the player above a solid surface', () => {
    const { x, z } = DEMO_ROOF.spawn.position;
    const surface = groundHeightAt(DEMO_ROOF, { x, z });
    expect(surface).not.toBeNull();
    expect(surface).toBeCloseTo(0, 9);
    // Feet start just above that surface so gravity has something to prove.
    expect(DEMO_ROOF.spawn.position.y).toBeGreaterThan(surface ?? 0);
    expect(DEMO_ROOF.spawn.position.y).toBeLessThan((surface ?? 0) + 1);
  });

  it('spawns inside the roof footprint', () => {
    const roof = DEMO_ROOF.props.find((entry) => entry.id === 'roof-deck');
    expect(roof).toBeDefined();
    const bounds = propBounds(roof as PropDefinition);
    expect(DEMO_ROOF.spawn.position.x).toBeGreaterThan(bounds.min.x);
    expect(DEMO_ROOF.spawn.position.x).toBeLessThan(bounds.max.x);
    expect(DEMO_ROOF.spawn.position.z).toBeGreaterThan(bounds.min.z);
    expect(DEMO_ROOF.spawn.position.z).toBeLessThan(bounds.max.z);
  });

  it('has a walkable deck as its highest surface at the spawn', () => {
    // Nothing above head height at the spawn point, so the camera is clear.
    const { x, z } = DEMO_ROOF.spawn.position;
    const surface = groundHeightAt(DEMO_ROOF, { x, z }, PLAYER.height) ?? 0;
    expect(surface).toBeCloseTo(0, 9);
  });

  it('rings the roof with a parapet on all four sides', () => {
    const ids = DEMO_ROOF.props.map((entry) => entry.id);
    expect(ids).toContain('parapet-north');
    expect(ids).toContain('parapet-south');
    expect(ids).toContain('parapet-east');
    expect(ids).toContain('parapet-west');
  });

  it('keeps every parapet inside the roof footprint', () => {
    const roof = propBounds(
      DEMO_ROOF.props.find((entry) => entry.id === 'roof-deck') as PropDefinition,
    );
    for (const id of ['parapet-north', 'parapet-south', 'parapet-east', 'parapet-west']) {
      const bounds = propBounds(DEMO_ROOF.props.find((entry) => entry.id === id) as PropDefinition);
      expect(bounds.min.x).toBeGreaterThanOrEqual(roof.min.x - 1e-9);
      expect(bounds.max.x).toBeLessThanOrEqual(roof.max.x + 1e-9);
      expect(bounds.min.z).toBeGreaterThanOrEqual(roof.min.z - 1e-9);
      expect(bounds.max.z).toBeLessThanOrEqual(roof.max.z + 1e-9);
    }
  });

  it('describes an environment with a fog range and a key light', () => {
    const environment = DEMO_ROOF.environment;
    expect(environment.fogFar).toBeGreaterThan(environment.fogNear);
    expect(environment.sunIntensity).toBeGreaterThan(0);
    expect(environment.ambientIntensity).toBeGreaterThan(0);
    for (const color of [environment.skyColor, environment.fogColor, environment.sunColor]) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('colours every prop with a valid hex string', () => {
    for (const entry of DEMO_ROOF.props) {
      expect(entry.color, entry.id).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('supports every prop on the deck or on another prop', () => {
    // Nothing may float: each prop's underside must coincide with the top of a
    // prop it overlaps in plan. The single lowest prop is the world floor and
    // is allowed to rest on nothing.
    const boundsById = new Map(DEMO_ROOF.props.map((entry) => [entry.id, propBounds(entry)]));
    const lowest = DEMO_ROOF.props.reduce((best, entry) =>
      (boundsById.get(entry.id)?.min.y ?? 0) < (boundsById.get(best.id)?.min.y ?? 0) ? entry : best,
    );

    const unsupported: string[] = [];
    for (const entry of DEMO_ROOF.props) {
      if (entry.id === lowest.id) continue;

      const bounds = boundsById.get(entry.id) as ReturnType<typeof propBounds>;
      const restsOnSomething = DEMO_ROOF.props.some((other) => {
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
});

describe('propBounds', () => {
  it('converts a centred prop into min/max bounds', () => {
    const bounds = propBounds(prop({ id: 'p', position: { x: 2, y: 3, z: 4 }, size: { x: 10, y: 2, z: 6 } }));
    expect(bounds.min).toEqual({ x: -3, y: 2, z: 1 });
    expect(bounds.max).toEqual({ x: 7, y: 4, z: 7 });
  });
});

describe('spawnBounds', () => {
  it('builds a player-sized box at the spawn point', () => {
    const box = spawnBounds(DEMO_ROOF, { radius: 0.5, height: 2 });
    const { x, y, z } = DEMO_ROOF.spawn.position;
    expect(box.min).toEqual({ x: x - 0.5, y, z: z - 0.5 });
    expect(box.max).toEqual({ x: x + 0.5, y: y + 2, z: z + 0.5 });
  });
});

describe('toColliders', () => {
  it('preserves ids and kinds', () => {
    const colliders = toColliders(DEMO_ROOF);
    expect(colliders.map((entry) => entry.id)).toEqual(DEMO_ROOF.props.map((entry) => entry.id));
    expect(colliders.find((entry) => entry.id === 'roof-deck')?.kind).toBe('floor');
    expect(colliders.find((entry) => entry.id === 'parapet-north')?.kind).toBe('wall');
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
    expect(problems).toHaveLength(1);
    expect(problems[0]?.prop).toBe('dup');
    expect(problems[0]?.message).toMatch(/duplicate prop id/);
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
    expect(problems).toHaveLength(1);
    expect(problems[0]?.prop).toBe('wafer');
    expect(problems[0]?.message).toMatch(/below the 0\.2m collision sub-step/);
  });

  it('flags a spawn point buried inside geometry', () => {
    const problems = validateLevel(
      level({
        spawn: { position: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0 },
        props: [prop({ id: 'block', position: { x: 0, y: 1, z: 0 }, size: { x: 4, y: 4, z: 4 } })],
      }),
      BUILD_OPTIONS,
    );
    expect(problems.map((problem) => problem.message).join()).toMatch(/spawn point intersects prop "block"/);
  });

  it('reports the level id on every problem', () => {
    const problems = validateLevel(level({ props: [] }), BUILD_OPTIONS);
    expect(problems.every((problem) => problem.level === DEMO_ROOF.id)).toBe(true);
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
      buildLevel(
        level({
          id: 'broken',
          props: [prop({ id: 'dup' }), prop({ id: 'dup' })],
        }),
        BUILD_OPTIONS,
      ),
    ).toThrow(/Invalid level "broken"/);
  });

  it('names the offending prop in the error message', () => {
    expect(() =>
      buildLevel(level({ props: [prop({ id: 'wafer', size: { x: 1, y: 0.01, z: 1 } })] }), BUILD_OPTIONS),
    ).toThrow(/\[wafer\]/);
  });

  it('produces a world whose sub-step respects the level thickness', () => {
    const built = buildLevel(DEMO_ROOF, BUILD_OPTIONS);
    expect(built.world.subStep).toBeCloseTo(SUB_STEP, 12);
  });

  it('produces a world that catches a falling player', () => {
    const built = buildLevel(DEMO_ROOF, BUILD_OPTIONS);
    const box = spawnBounds(DEMO_ROOF, PLAYER);
    box.min.y = 20;
    box.max.y = 20 + PLAYER.height;

    const velocity = { x: 0, y: -20, z: 0 };
    const result = built.world.move(box, { x: 0, y: -20, z: 0 }, velocity);

    expect(result.grounded).toBe(true);
    expect(result.groundId).toBe('roof-deck');
    expect(velocity.y).toBe(0);
    // Either left exactly flush or pushed out by one collision skin - never
    // inside the deck.
    expect(box.min.y).toBeGreaterThanOrEqual(-0.001);
    expect(box.min.y).toBeLessThanOrEqual(0.001);
  });
});

describe('groundHeightAt', () => {
  it('finds the roof deck under the spawn point', () => {
    expect(groundHeightAt(DEMO_ROOF, { x: 0, z: 11 })).toBeCloseTo(0, 9);
  });

  it('respects an upper limit so overhead geometry is ignored', () => {
    // The stacked crate tops out at 2.8 m.
    expect(groundHeightAt(DEMO_ROOF, { x: -5, z: 4.5 })).toBeCloseTo(2.8, 9);
    expect(groundHeightAt(DEMO_ROOF, { x: -5, z: 4.5 }, 2.0)).toBeCloseTo(1.4, 9);
  });

  it('returns null for a point outside every collider footprint', () => {
    expect(groundHeightAt(DEMO_ROOF, { x: 500, z: 500 })).toBeNull();
  });

  it('ignores geometry that does not span the point in both axes', () => {
    // The vent stack sits at (7.5, -2.5); a point at its X but far in Z misses it.
    const under = groundHeightAt(DEMO_ROOF, { x: 7.5, z: -2.5 });
    expect(under).toBeCloseTo(2.6, 9);

    const beside = groundHeightAt(DEMO_ROOF, { x: 7.5, z: 11 });
    expect(beside).toBeCloseTo(0, 9);
  });
});
