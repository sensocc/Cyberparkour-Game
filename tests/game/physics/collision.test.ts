import { describe, expect, it } from 'vitest';

import { vec3, type Vec3 } from '../../../src/core/vec3.js';
import { aabbFromCenterSize, overlaps, type AABB } from '../../../src/game/physics/aabb.js';
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
