import { describe, expect, it } from 'vitest';

import { vec3, type Vec3 } from '../../../src/core/vec3.js';
import { aabbFromCenterSize, aabbFromFeet, overlaps, type AABB } from '../../../src/game/physics/aabb.js';
import { buildCity } from '../../../src/game/level/city.js';
import { DEMO_DISTRICT } from '../../../src/game/level/levelData.js';
import { buildLevel } from '../../../src/game/level/level.js';
import { standingSize } from '../../../src/game/player.js';
import { DEFAULT_CONFIG } from '../../../src/core/config.js';
import {
  COLLISION_SKIN,
  CollisionWorld,
  applySafetyFloor,
  clampDelta,
  clampSpeed,
  createMoveResult,
  playerBox,
  resetMoveResult,
  type Collider,
  type ColliderKind,
} from '../../../src/game/physics/collision.js';

const PLAYER_RADIUS = 0.35;
const PLAYER_HEIGHT = 1.8;

function collider(
  id: string,
  center: Vec3,
  size: Vec3,
  kind: ColliderKind = 'prop',
): Collider {
  return { id, kind, box: aabbFromCenterSize(center, size) };
}

/** A wide slab whose top surface sits at y = 0. */
const ROOF = collider('roof', vec3(0, -0.5, 0), vec3(40, 1, 40), 'floor');

/** A wall occupying x in [4, 5], reaching well above the player. */
const WALL = collider('wall', vec3(4.5, 2, 0), vec3(1, 4, 20), 'wall');

/** A low step: top surface at y = 1. */
const STEP = collider('step', vec3(0, 0.5, 0), vec3(4, 1, 4), 'prop');

/** A roof: a thin overhead slab whose underside is at y = 3. */
const CEILING = collider('ceiling', vec3(0, 3.5, 20), vec3(20, 1, 5), 'prop');

function feetBox(position: Vec3): AABB {
  return playerBox(position, PLAYER_RADIUS, PLAYER_HEIGHT);
}

interface Settled {
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly grounded: boolean;
  readonly steps: number;
}

/**
 * Drops the box under gravity until it lands, mirroring the real step order
 * (gravity is integrated *before* the sweep).
 */
function settle(world: CollisionWorld, start: Vec3, steps = 240): Settled {
  const box = feetBox(start);
  const velocity = vec3(0, 0, 0);
  let grounded = false;
  let taken = 0;

  for (let index = 0; index < steps; index += 1) {
    velocity.y -= 26 / 60;
    const result = world.move(box, vec3(0, velocity.y / 60, 0), velocity);
    taken = index + 1;
    if (result.grounded) {
      grounded = true;
      break;
    }
  }

  return {
    position: vec3(box.min.x + PLAYER_RADIUS, box.min.y, box.min.z + PLAYER_RADIUS),
    velocity,
    grounded,
    steps: taken,
  };
}

describe('CollisionWorld construction', () => {
  it('snapshots the collider list', () => {
    const source = [ROOF];
    const world = new CollisionWorld(source);
    source.push(WALL);
    expect(world.colliders).toHaveLength(1);
  });

  it('clamps the sub-step to the thinnest collider so nothing tunnels through', () => {
    const thin = collider('thin', vec3(0, 0, 0), vec3(10, 0.05, 10));
    const world = new CollisionWorld([thin], { maxSubStep: 0.5 });
    expect(world.subStep).toBeCloseTo(0.05, 12);
  });

  it('keeps the requested sub-step when every collider is thick enough', () => {
    const world = new CollisionWorld([ROOF, WALL], { maxSubStep: 0.2 });
    expect(world.subStep).toBeCloseTo(0.2, 12);
  });

  it('rejects a non-positive sub-step', () => {
    expect(() => new CollisionWorld([ROOF], { maxSubStep: 0 })).toThrow(RangeError);
    expect(() => new CollisionWorld([ROOF], { maxSubStep: -0.1 })).toThrow(RangeError);
  });

  it('handles an empty world', () => {
    const world = new CollisionWorld([]);
    const box = feetBox(vec3(0, 5, 0));
    const result = world.move(box, vec3(0, -1, 0), vec3(0, -1, 0));
    expect(result.grounded).toBe(false);
    expect(box.min.y).toBeCloseTo(4, 12);
  });
});

describe('landing on a floor', () => {
  it('stops exactly on the surface, leaving only the collision skin', () => {
    const world = new CollisionWorld([ROOF]);
    const landed = settle(world, vec3(0, 5, 0));

    expect(landed.grounded).toBe(true);
    expect(landed.position.y).toBeCloseTo(COLLISION_SKIN, 6);
    expect(landed.velocity.y).toBe(0);
    expect(landed.steps).toBeLessThan(240);
  });

  it('reports the ground collider it landed on', () => {
    const world = new CollisionWorld([ROOF]);
    const box = feetBox(vec3(0, 0.001, 0));
    const result = world.move(box, vec3(0, -0.01, 0), vec3(0, -0.01, 0));

    expect(result.grounded).toBe(true);
    expect(result.groundId).toBe('roof');
    expect(result.blocked.y).toBe(true);
  });

  it('stays grounded while resting, so friction keeps applying', () => {
    const world = new CollisionWorld([ROOF]);
    const box = feetBox(vec3(0, COLLISION_SKIN, 0));
    const velocity = vec3(0, 0, 0);

    for (let step = 0; step < 300; step += 1) {
      // Gravitational nudge each step, exactly as the real loop does it.
      velocity.y -= 26 / 60;
      const result = world.move(box, vec3(0, velocity.y / 60, 0), velocity);
      expect(result.grounded).toBe(true);
      expect(velocity.y).toBe(0);
    }

    // No sinking, no bounce: the resting height is a fixed point.
    expect(box.min.y).toBeCloseTo(COLLISION_SKIN, 6);
  });

  it('isSupported detects ground without moving the box', () => {
    const world = new CollisionWorld([ROOF]);
    const resting = feetBox(vec3(0, COLLISION_SKIN, 0));
    const hovering = feetBox(vec3(0, 2, 0));

    expect(world.isSupported(resting)).toBe(true);
    expect(world.isSupported(hovering)).toBe(false);
    expect(world.isSupported(hovering, 3)).toBe(true);
    // The probe must not have moved anything.
    expect(hovering.min.y).toBe(2);
  });

  it('lands on top of a prop and stands there', () => {
    const world = new CollisionWorld([ROOF, STEP]);
    const landed = settle(world, vec3(0, 6, 0));

    expect(landed.grounded).toBe(true);
    expect(landed.position.y).toBeCloseTo(1 + COLLISION_SKIN, 6);
  });
});

describe('walls', () => {
  it('blocks movement into a wall and zeroes the blocked velocity', () => {
    const world = new CollisionWorld([ROOF, WALL]);
    // Starts 1 m clear of the wall's near face at x = 4.
    const box = feetBox(vec3(3, COLLISION_SKIN, 0));
    const velocity = vec3(10, 0, 0);

    const result = world.move(box, vec3(1, 0, 0), velocity);

    expect(result.hitWall).toBe(true);
    expect(result.blocked.x).toBe(true);
    expect(velocity.x).toBe(0);
    // The wall's near face is x = 4; the player stops one skin short of it.
    expect(box.max.x).toBeCloseTo(4 - COLLISION_SKIN, 6);
  });

  it('slides along a wall, keeping the tangential component', () => {
    const world = new CollisionWorld([ROOF, WALL]);
    const box = feetBox(vec3(3.5, COLLISION_SKIN, 0));
    const velocity = vec3(10, 0, -5);

    // Move diagonally into the wall over several steps.
    for (let step = 0; step < 10; step += 1) {
      world.move(box, vec3(0.1, 0, -0.05), velocity);
    }

    expect(box.max.x).toBeLessThanOrEqual(4);
    // Z movement continued: the player skirted along the wall.
    expect(box.min.z).toBeLessThan(-0.5);
    expect(velocity.x).toBe(0);
    expect(velocity.z).toBe(-5);
  });

  it('does not let a fast mover tunnel through a 1 m wall', () => {
    const world = new CollisionWorld([ROOF, WALL]);
    const box = feetBox(vec3(0, COLLISION_SKIN, 0));
    const velocity = vec3(200, 0, 0);

    // 5 m in a single step, far more than the wall is thick.
    const result = world.move(box, vec3(5, 0, 0), velocity);

    expect(result.blocked.x).toBe(true);
    expect(box.max.x).toBeLessThanOrEqual(4);
  });

  it('does not tunnel through the floor when falling very fast', () => {
    const world = new CollisionWorld([ROOF]);
    const box = feetBox(vec3(0, 40, 0));
    const velocity = vec3(0, -400, 0);

    const result = world.move(box, vec3(0, -80, 0), velocity);

    expect(result.grounded).toBe(true);
    expect(box.min.y).toBeCloseTo(COLLISION_SKIN, 6);
    expect(velocity.y).toBe(0);
  });

  it('is not blocked by a wall it is moving away from', () => {
    const world = new CollisionWorld([ROOF, WALL]);
    const box = feetBox(vec3(0, COLLISION_SKIN, 0));
    const velocity = vec3(-10, 0, 0);

    const result = world.move(box, vec3(-1, 0, 0), velocity);

    expect(result.blocked.x).toBe(false);
    expect(velocity.x).toBe(-10);
    expect(box.max.x).toBeCloseTo(0.35 - 1, 12);
  });
});

describe('ceilings', () => {
  it('stops an upward move and zeroes vertical velocity', () => {
    const world = new CollisionWorld([ROOF, CEILING]);
    const box = feetBox(vec3(0, COLLISION_SKIN, 20));
    const velocity = vec3(0, 10, 0);

    const result = world.move(box, vec3(0, 3, 0), velocity);

    expect(result.hitCeiling).toBe(true);
    expect(result.blocked.y).toBe(true);
    expect(velocity.y).toBe(0);
    // The ceiling's underside is y = 3.
    expect(box.max.y).toBeLessThanOrEqual(3);
  });

  it('does not report a ceiling when falling', () => {
    const world = new CollisionWorld([ROOF, CEILING]);
    const box = feetBox(vec3(0, 1, 20));
    const velocity = vec3(0, -1, 0);

    const result = world.move(box, vec3(0, -0.1, 0), velocity);

    expect(result.hitCeiling).toBe(false);
    expect(result.grounded).toBe(false);
  });
});

describe('result bookkeeping', () => {
  it('createMoveResult starts clean', () => {
    const result = createMoveResult();
    expect(result.grounded).toBe(false);
    expect(result.hitCeiling).toBe(false);
    expect(result.hitWall).toBe(false);
    expect(result.blocked).toEqual({ x: false, y: false, z: false });
    expect(result.groundId).toBeNull();
  });

  it('resetMoveResult clears a reused result exactly like a fresh one', () => {
    const reused = createMoveResult();
    reused.grounded = true;
    reused.hitWall = true;
    reused.hitCeiling = true;
    reused.blocked.x = true;
    reused.blocked.y = true;
    reused.blocked.z = true;
    reused.groundId = 'roof';

    resetMoveResult(reused);
    expect(reused).toEqual(createMoveResult());
  });

  it('a reused result does not leak state between calls', () => {
    const world = new CollisionWorld([ROOF, WALL]);
    const box = feetBox(vec3(3, COLLISION_SKIN, 0));
    const result = createMoveResult();

    world.move(box, vec3(1, 0, 0), vec3(10, 0, 0), result);
    expect(result.blocked.x).toBe(true);

    const free = feetBox(vec3(-5, COLLISION_SKIN, 0));
    world.move(free, vec3(-0.1, 0, 0), vec3(-1, 0, 0), result);
    expect(result.blocked.x).toBe(false);
  });

  it('zero movement is a no-op that still reports support', () => {
    const world = new CollisionWorld([ROOF]);
    const box = feetBox(vec3(0, COLLISION_SKIN, 0));
    const result = world.move(box, vec3(0, 0, 0), vec3(0, 0, 0));

    expect(result.grounded).toBe(true);
    expect(box.min.y).toBeCloseTo(COLLISION_SKIN, 12);
  });

  it('ignores a non-finite delta instead of corrupting the box', () => {
    const world = new CollisionWorld([ROOF]);
    const box = feetBox(vec3(0, COLLISION_SKIN, 0));
    const result = world.move(box, vec3(Number.NaN, 0, 0), vec3(0, 0, 0));

    expect(Number.isNaN(box.min.x)).toBe(false);
    expect(result.blocked.x).toBe(false);
  });
});

describe('diagonal contact', () => {
  it('never leaves the player overlapping geometry', () => {
    const obstacle = collider('block', vec3(2, 1, 2), vec3(2, 2, 2));
    const world = new CollisionWorld([ROOF, obstacle]);
    const box = feetBox(vec3(0, COLLISION_SKIN, 0));
    const velocity = vec3(0, 0, 0);

    // Drive diagonally into the corner of the block.
    for (let step = 0; step < 120; step += 1) {
      velocity.x = 6;
      velocity.z = 6;
      world.move(box, vec3(6 / 60, 0, 6 / 60), velocity);
      expect(overlaps(box, obstacle.box)).toBe(false);
      expect(overlaps(box, ROOF.box)).toBe(false);
    }
  });
});

describe('playerBox', () => {
  it('builds the player AABB from a feet position', () => {
    const box = playerBox(vec3(1, 2, 3), 0.35, 1.8);
    expect(box.min).toEqual({ x: 0.65, y: 2, z: 2.65 });
    expect(box.max.x).toBeCloseTo(1.35, 12);
    expect(box.max.y).toBeCloseTo(3.8, 12);
  });
});

describe('applySafetyFloor', () => {
  const origin = vec3(0, 0.5, 11);

  it('leaves a healthy player alone', () => {
    const position = vec3(1, 2, 3);
    const velocity = vec3(1, -1, 1);
    expect(applySafetyFloor(position, velocity, -250, origin)).toBeNull();
    expect(position).toEqual({ x: 1, y: 2, z: 3 });
    expect(velocity).toEqual({ x: 1, y: -1, z: 1 });
  });

  it('rescues a player below the floor and reports why', () => {
    const position = vec3(50, -900, -50);
    const velocity = vec3(0, -80, 0);

    expect(applySafetyFloor(position, velocity, -250, origin)).toBe('below-floor');
    expect(position).toEqual({ x: 0, y: 0.5, z: 11 });
    expect(velocity).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('rescues a non-finite position', () => {
    const position = vec3(Number.NaN, 2, 3);
    const velocity = vec3(0, 0, 0);

    expect(applySafetyFloor(position, velocity, -250, origin)).toBe('non-finite');
    expect(position).toEqual({ x: 0, y: 0.5, z: 11 });
  });
});

describe('velocity and delta guards', () => {
  it('clampSpeed scales an excessive velocity down', () => {
    const velocity = vec3(300, 0, 400);
    expect(clampSpeed(velocity, 100)).toBe(true);
    expect(Math.hypot(velocity.x, velocity.y, velocity.z)).toBeCloseTo(100, 9);
    // Direction is preserved.
    expect(velocity.x).toBeCloseTo(60, 9);
    expect(velocity.z).toBeCloseTo(80, 9);
  });

  it('clampSpeed leaves a legal velocity untouched', () => {
    const velocity = vec3(1, -2, 3);
    const before = { ...velocity };
    expect(clampSpeed(velocity, 100)).toBe(false);
    expect(velocity).toEqual(before);
  });

  it('clampSpeed stops a non-finite velocity instead of producing NaN', () => {
    const velocity = vec3(Number.POSITIVE_INFINITY, 0, 0);
    expect(clampSpeed(velocity, 100)).toBe(true);
    expect(velocity).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('clampDelta bounds a single step distance', () => {
    const delta = vec3(300, 0, 400);
    clampDelta(delta, 50);
    expect(Math.hypot(delta.x, delta.y, delta.z)).toBeCloseTo(50, 9);
  });

  it('clampDelta leaves a short step untouched', () => {
    const delta = vec3(0.01, -0.02, 0.03);
    const before = { ...delta };
    clampDelta(delta, 50);
    expect(delta).toEqual(before);
  });

  it('clampDelta zeroes a non-finite step', () => {
    const delta = vec3(Number.NaN, 1, 1);
    clampDelta(delta, 50);
    expect(delta).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe('the broadphase the city needs', () => {
  /**
   * Builds the city's collider list and both worlds.
   *
   * V0.7.1 made `CollisionWorld` stop scanning every collider on every sub-step:
   * the city is 5,264 of them, and a falling step tested all of them several times
   * over. `scan` is the V0.1 behaviour, kept precisely so this test can hold the
   * grid to it.
   */
  function worlds(): { grid: CollisionWorld; scan: CollisionWorld; colliders: readonly Collider[] } {
    const city = buildCity(DEMO_DISTRICT);
    const built = buildLevel(city, {
      maxSubStep: DEFAULT_CONFIG.world.maxCollisionSubStep,
      player: standingSize(DEFAULT_CONFIG.player),
    });
    return {
      grid: new CollisionWorld(built.colliders, { broadphase: 'grid' }),
      scan: new CollisionWorld(built.colliders, { broadphase: 'scan' }),
      colliders: built.colliders,
    };
  }

  const size = standingSize(DEFAULT_CONFIG.player);
  const at = { x: 0, y: 0, z: 0 };

  /** Moves one box through `world`, from `from`, by `delta`. */
  function push(
    world: CollisionWorld,
    from: { x: number; y: number; z: number },
    delta: { x: number; y: number; z: number },
  ) {
    const box = aabbFromFeet(from, size.radius, size.height);
    const velocity = { x: delta.x * 6, y: delta.y * 6, z: delta.z * 6 };
    const result = world.move(box, delta, velocity);
    return { result, box };
  }

  it('answers exactly what the scan would, over the whole city', () => {
    // The point of the grid is that it is *not* a rewrite of the solver: it makes
    // the same decision about the same colliders, having found them by cell instead
    // of by walking the level. Anything else would be a physics change wearing an
    // optimisation's clothes, and this is where that would show up.
    //
    // Every mismatch is collected and asserted once, rather than asserted inside the
    // loop: the `scan` half of this is deliberately slow - it is the behaviour being
    // replaced - and three thousand assertions on top of it is a test that times out
    // on a runner slower than the one it was written on.
    const { grid, scan } = worlds();
    let seed = 20271010;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    const mismatches: string[] = [];
    for (let attempt = 0; attempt < 400; attempt += 1) {
      at.x = (random() - 0.5) * 800;
      at.y = -30 + random() * 100;
      at.z = (random() - 0.5) * 800;
      const delta = { x: (random() - 0.5) * 0.6, y: (random() - 0.5) * 0.6, z: (random() - 0.5) * 0.6 };

      const mine = push(grid, at, delta);
      const theirs = push(scan, at, delta);

      const same =
        mine.result.grounded === theirs.result.grounded &&
        mine.result.hitWall === theirs.result.hitWall &&
        mine.result.hitCeiling === theirs.result.hitCeiling &&
        mine.result.groundId === theirs.result.groundId &&
        mine.result.groundSurface === theirs.result.groundSurface &&
        mine.box.min.x === theirs.box.min.x &&
        mine.box.min.y === theirs.box.min.y &&
        mine.box.min.z === theirs.box.min.z &&
        mine.box.max.x === theirs.box.max.x &&
        mine.box.max.y === theirs.box.max.y &&
        mine.box.max.z === theirs.box.max.z;

      if (!same) {
        mismatches.push(
          `at ${JSON.stringify(at)} delta ${JSON.stringify(delta)}: ` +
            `grid ${JSON.stringify(mine.result)} ${JSON.stringify(mine.box.min)} / ` +
            `scan ${JSON.stringify(theirs.result)} ${JSON.stringify(theirs.box.min)}`,
        );
        if (mismatches.length > 4) break;
      }
    }

    expect(mismatches).toEqual([]);
  });

  it('declines to test the whole city to answer a question about one street', () => {
    // A falling step is the worst case: it sub-steps repeatedly, on every axis.
    // 1,200 of them took about a millisecond with the grid and most of a second
    // without it, so the assertion is deliberately loose - it is there to catch the
    // broadphase being dropped, not to measure the machine it runs on.
    const { grid } = worlds();
    const start = performance.now();
    for (let move = 0; move < 1200; move += 1) {
      push(grid, { x: 40, y: 60 - move * 0.05, z: 40 }, { x: 0.05, y: -0.4, z: 0 });
    }
    expect(performance.now() - start).toBeLessThan(400);
  });

  it('finds the same ground when two things both support the player', () => {
    // The one query where the answer depends on *which* collider is found: the
    // first in the level's order. A grid visits candidates cell by cell, so it has
    // to choose by index rather than by whatever it happened to reach first.
    const { grid, scan, colliders } = worlds();
    let checked = 0;

    for (const collider of colliders.slice(0, 400)) {
      const feet = { x: collider.box.max.x - 0.3, y: collider.box.max.y, z: collider.box.max.z - 0.3 };
      const mine = push(grid, feet, { x: 0, y: -0.01, z: 0 });
      const theirs = push(scan, feet, { x: 0, y: -0.01, z: 0 });
      expect(mine.result.groundId, collider.id).toBe(theirs.result.groundId);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(100);
  });
});
