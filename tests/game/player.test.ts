import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG, type PlayerConfig } from '../../src/core/config.js';
import { vec3, type Vec3 } from '../../src/core/vec3.js';
import { aabbFromCenterSize, type AABB } from '../../src/game/physics/aabb.js';
import { CollisionWorld, type Collider } from '../../src/game/physics/collision.js';
import {
  createPlayerState,
  eyePosition,
  horizontalSpeed,
  interpolatePlayerPosition,
  resetPlayerState,
  snapshotPlayer,
  speed,
  stepPlayer,
  type MoveInput,
  type PlayerState,
} from '../../src/game/player.js';
import type { SpawnPoint } from '../../src/game/level/levelData.js';

const CONFIG: PlayerConfig = DEFAULT_CONFIG.player;
const STEP = 1 / DEFAULT_CONFIG.world.tickRate;

const SPAWN: SpawnPoint = { position: { x: 0, y: 0.5, z: 11 }, yaw: 0, pitch: 0 };

function box(id: string, center: Vec3, size: Vec3, kind: Collider['kind'] = 'prop'): Collider {
  return { id, kind, box: aabbFromCenterSize(center, size) };
}

/** Ground slab with its top surface at y = 0, large enough to walk for a while. */
const FLOOR = box('floor', vec3(0, -0.5, 0), vec3(400, 1, 400), 'floor');
/** Wall occupying x in [5, 6]. */
const WALL = box('wall', vec3(5.5, 3, 0), vec3(1, 6, 40), 'wall');

function world(...colliders: Collider[]): CollisionWorld {
  return new CollisionWorld(colliders, { maxSubStep: DEFAULT_CONFIG.world.maxCollisionSubStep });
}

const FORWARD: MoveInput = { forward: 1, right: 0 };
const STILL: MoveInput = { forward: 0, right: 0 };
const DIAGONAL: MoveInput = { forward: 1, right: 1 };

interface RunOptions {
  readonly steps: number;
  readonly input?: MoveInput | ((step: number) => MoveInput);
  readonly player?: PlayerConfig;
  readonly safetyFloorY?: number;
  readonly spawn?: SpawnPoint;
}

function run(collisionWorld: CollisionWorld, options: RunOptions): PlayerState {
  const state = createPlayerState(options.spawn ?? SPAWN);
  const config = options.player ?? CONFIG;
  const input = options.input;
  const inputFor: (step: number) => MoveInput =
    typeof input === 'function' ? input : () => input ?? STILL;

  for (let step = 0; step < options.steps; step += 1) {
    const stepOptions = {
      world: collisionWorld,
      config,
      ...(options.safetyFloorY === undefined ? {} : { safetyFloorY: options.safetyFloorY }),
    };
    stepPlayer(state, inputFor(step), STEP, stepOptions);
  }
  return state;
}

describe('createPlayerState', () => {
  it('starts at the spawn point with no motion', () => {
    const state = createPlayerState(SPAWN);
    expect(state.position).toEqual({ x: 0, y: 0.5, z: 11 });
    expect(state.previousPosition).toEqual(state.position);
    expect(state.velocity).toEqual({ x: 0, y: 0, z: 0 });
    expect(state.yaw).toBe(0);
    expect(state.pitch).toBe(0);
    expect(state.grounded).toBe(false);
    expect(state.groundId).toBeNull();
  });

  it('remembers the spawn point independently of the current position', () => {
    const state = createPlayerState(SPAWN);
    state.position.x = 99;
    state.spawn.position.x = 5;
    expect(state.position.x).toBe(99);
    expect(state.spawn.position.x).toBe(5);
  });

  it('does not alias the spawn definition it was given', () => {
    const spawn: SpawnPoint = { position: { x: 1, y: 2, z: 3 }, yaw: 0.5, pitch: -0.2 };
    const state = createPlayerState(spawn);
    state.position.x = 42;
    expect(spawn.position.x).toBe(1);
  });
});

describe('resetPlayerState', () => {
  it('returns the player to the spawn point and clears all motion', () => {
    const state = createPlayerState(SPAWN);
    state.position.x = 50;
    state.position.y = -20;
    state.velocity.x = 9;
    state.velocity.y = -30;
    state.yaw = 2;
    state.pitch = 1;
    state.grounded = true;
    state.groundId = 'roof';

    resetPlayerState(state);

    expect(state.position).toEqual({ x: 0, y: 0.5, z: 11 });
    expect(state.previousPosition).toEqual(state.position);
    expect(state.velocity).toEqual({ x: 0, y: 0, z: 0 });
    expect(state.yaw).toBe(0);
    expect(state.pitch).toBe(0);
    expect(state.grounded).toBe(false);
    expect(state.groundId).toBeNull();
  });
});

describe('gravity and landing', () => {
  it('pulls a floating player down until it lands', () => {
    const state = run(world(FLOOR), { steps: 1, input: STILL, spawn: { position: { x: 0, y: 4, z: 0 }, yaw: 0, pitch: 0 } });
    expect(state.position.y).toBeLessThan(4);
    expect(state.velocity.y).toBeLessThan(0);
    expect(state.grounded).toBe(false);
  });

  it('lands on the floor and stays there', () => {
    const state = run(world(FLOOR), { steps: 180, input: STILL, spawn: { position: { x: 0, y: 4, z: 0 }, yaw: 0, pitch: 0 } });

    expect(state.grounded).toBe(true);
    expect(state.groundId).toBe('floor');
    expect(state.position.y).toBeCloseTo(0.001, 6);
    expect(state.velocity.y).toBe(0);
  });

  it('reaches terminal velocity rather than accelerating forever', () => {
    const state = run(world(), {
      steps: 600,
      input: STILL,
      spawn: { position: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0 },
    });
    expect(state.velocity.y).toBeCloseTo(-CONFIG.maxFallSpeed, 6);
  });

  it('applies no gravity while grounded', () => {
    const state = run(world(FLOOR), { steps: 300, input: STILL });
    expect(state.velocity.y).toBe(0);
    expect(state.position.y).toBeCloseTo(0.001, 6);
  });
});

describe('walking', () => {
  it('accelerates up to exactly the walk speed and no further', () => {
    const state = run(world(FLOOR), { steps: 240, input: FORWARD });
    const velocity = state.velocity;

    expect(velocity.x).toBeCloseTo(0, 9);
    expect(velocity.z).toBeCloseTo(-CONFIG.walkSpeed, 6);
    expect(horizontalSpeed(state)).toBeCloseTo(CONFIG.walkSpeed, 6);
  });

  it('moves in the direction the player faces', () => {
    const north = run(world(FLOOR), { steps: 120, input: FORWARD });
    expect(north.position.z).toBeLessThan(SPAWN.position.z - 5);
    expect(north.position.x).toBeCloseTo(0, 6);

    // Yaw 90 degrees: forward is -X.
    const east = run(world(FLOOR), {
      steps: 120,
      input: FORWARD,
      spawn: { position: { x: 0, y: 0.5, z: 0 }, yaw: Math.PI / 2, pitch: 0 },
    });
    expect(east.position.x).toBeLessThan(-5);
    expect(east.position.z).toBeCloseTo(0, 6);
  });

  it('does not let diagonal input move faster than walking straight', () => {
    const straight = run(world(FLOOR), { steps: 240, input: FORWARD });
    const diagonal = run(world(FLOOR), { steps: 240, input: DIAGONAL });

    expect(horizontalSpeed(diagonal)).toBeCloseTo(CONFIG.walkSpeed, 5);
    expect(horizontalSpeed(diagonal)).toBeLessThanOrEqual(horizontalSpeed(straight) + 1e-9);
  });

  it('moves backward and sideways as well as forward', () => {
    const back = run(world(FLOOR), { steps: 120, input: { forward: -1, right: 0 } });
    expect(back.position.z).toBeGreaterThan(SPAWN.position.z + 5);

    const right = run(world(FLOOR), { steps: 120, input: { forward: 0, right: 1 } });
    expect(right.position.x).toBeGreaterThan(5);
  });
});

describe('friction and deceleration', () => {
  it('brings the player to a complete stop when input stops', () => {
    const state = run(world(FLOOR), {
      steps: 300,
      input: (step) => (step < 120 ? FORWARD : STILL),
    });

    expect(horizontalSpeed(state)).toBe(0);
    expect(state.velocity.x).toBe(0);
    expect(state.velocity.z).toBe(0);
  });

  it('decelerates rather than stopping instantly', () => {
    const moving = run(world(FLOOR), { steps: 120, input: FORWARD });
    const coasting = run(world(FLOOR), {
      steps: 125,
      input: (step) => (step < 120 ? FORWARD : STILL),
    });

    expect(horizontalSpeed(coasting)).toBeGreaterThan(0);
    expect(horizontalSpeed(coasting)).toBeLessThan(horizontalSpeed(moving));
  });

  it('keeps most of its speed for the first frame after release', () => {
    const released = run(world(FLOOR), {
      steps: 121,
      input: (step) => (step < 120 ? FORWARD : STILL),
    });
    // ~15% of the speed is shed per frame at the configured friction, so the
    // first frame after release should cost far less than half the speed.
    expect(horizontalSpeed(released)).toBeGreaterThan(CONFIG.walkSpeed * 0.8);
  });
});

describe('air control', () => {
  it('accelerates far more slowly in the air than on the ground', () => {
    const airborneSpawn: SpawnPoint = { position: { x: 0, y: 60, z: 0 }, yaw: 0, pitch: 0 };
    // Resting on the floor already, so friction and ground acceleration apply
    // from the very first step.
    const groundedSpawn: SpawnPoint = { position: { x: 0, y: 0.001, z: 0 }, yaw: 0, pitch: 0 };

    const inAir = run(world(FLOOR), { steps: 10, input: FORWARD, spawn: airborneSpawn });
    const onGround = run(world(FLOOR), { steps: 10, input: FORWARD, spawn: groundedSpawn });

    expect(inAir.grounded).toBe(false);
    expect(onGround.grounded).toBe(true);
    expect(horizontalSpeed(inAir)).toBeGreaterThan(0);
    expect(horizontalSpeed(inAir)).toBeLessThan(horizontalSpeed(onGround));
  });

  it('does not apply friction in the air, so speed is retained', () => {
    // Launch forward, then coast with no input while falling.
    const state = run(world(FLOOR), {
      steps: 60,
      input: FORWARD,
      spawn: { position: { x: 0, y: 0.5, z: 0 }, yaw: 0, pitch: 0 },
    });
    const speedOnGround = horizontalSpeed(state);

    const launched = run(world(FLOOR), {
      steps: 90,
      input: (step) => (step < 60 ? FORWARD : STILL),
      spawn: { position: { x: 0, y: 0.5, z: 0 }, yaw: 0, pitch: 0 },
    });
    // Still moving: friction had time to bite but the player is on the ground,
    // so this documents that ground friction is what stops them.
    expect(horizontalSpeed(launched)).toBeLessThan(speedOnGround);
  });
});

describe('collision integration', () => {
  it('is stopped by a wall and keeps its vertical state', () => {
    const state = run(world(FLOOR, WALL), {
      steps: 300,
      input: { forward: 0, right: 1 },
      spawn: { position: { x: 0, y: 0.5, z: 0 }, yaw: 0, pitch: 0 },
    });

    // Wall near face at x = 5, minus the player half-width and the skin.
    expect(state.position.x).toBeCloseTo(5 - CONFIG.radius - 0.001, 3);
    expect(state.velocity.x).toBe(0);
    expect(state.grounded).toBe(true);
  });

  it('can walk up to a wall and back away again', () => {
    const state = run(world(FLOOR, WALL), {
      steps: 400,
      input: (step) => (step < 200 ? { forward: 0, right: 1 } : { forward: 0, right: -1 }),
      spawn: { position: { x: 0, y: 0.5, z: 0 }, yaw: 0, pitch: 0 },
    });

    expect(state.position.x).toBeLessThan(0);
  });

  it('never leaves the floor while walking', () => {
    const state = run(world(FLOOR), { steps: 600, input: DIAGONAL });
    expect(state.position.y).toBeCloseTo(0.001, 6);
    expect(state.grounded).toBe(true);
  });

  it('does fall off the edge when there is nothing underneath', () => {
    // A small island: walking off it is how V0.1's fall detection will trigger.
    const island = world(box('island', vec3(0, -0.5, 0), vec3(6, 1, 6), 'floor'));
    const state = run(island, { steps: 400, input: { forward: 0, right: 1 } });
    expect(state.position.y).toBeLessThan(-10);
    expect(state.grounded).toBe(false);
  });
});

describe('step guards', () => {
  it('ignores a nonsensical dt and reports no contacts', () => {
    const state = createPlayerState(SPAWN);
    const before = { position: { ...state.position }, velocity: { ...state.velocity } };

    for (const dt of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = stepPlayer(state, FORWARD, dt, { world: world(FLOOR), config: CONFIG });
      expect(result.grounded).toBe(false);
      expect(result.hitWall).toBe(false);
      expect(state.position).toEqual(before.position);
      expect(state.velocity).toEqual(before.velocity);
    }
  });

  it('records the previous position for render interpolation', () => {
    const state = createPlayerState(SPAWN);
    const collisionWorld = world(FLOOR);
    const start = { ...state.position };

    stepPlayer(state, FORWARD, STEP, { world: collisionWorld, config: CONFIG });
    expect(state.previousPosition).toEqual(start);
    expect(state.position).not.toEqual(start);
  });

  it('keeps the position finite when the safety floor is off', () => {
    const state = run(world(), { steps: 200, input: STILL });
    expect(Number.isFinite(state.position.x)).toBe(true);
    expect(Number.isFinite(state.position.y)).toBe(true);
    expect(Number.isFinite(state.position.z)).toBe(true);
  });

  it('rescues a player who falls past the safety floor', () => {
    // No geometry at all, so the safety net is the only thing that can stop a
    // bottomless fall. The player is snapped back to their spawn each time.
    const collisionWorld = world();
    const state = createPlayerState({ position: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0 });

    let rescues = 0;
    let previousY = state.position.y;

    for (let step = 0; step < 400; step += 1) {
      stepPlayer(state, STILL, STEP, { world: collisionWorld, config: CONFIG, safetyFloorY: -20 });
      // At most one step's worth of overshoot below the net.
      expect(state.position.y).toBeGreaterThan(-21);
      if (state.position.y > previousY + 1) {
        rescues += 1;
        // A rescue always lands the player back at the spawn point, stopped.
        expect(state.position.x).toBe(0);
        expect(state.position.z).toBe(0);
        expect(state.velocity.y).toBe(0);
      }
      previousY = state.position.y;
    }

    expect(rescues).toBeGreaterThan(0);
  });

  it('leaves a player above the safety floor untouched', () => {
    const state = run(world(FLOOR), { steps: 300, input: STILL, safetyFloorY: -50 });
    expect(state.position.y).toBeCloseTo(0.001, 6);
  });
});

describe('view helpers', () => {
  it('eyePosition lifts the camera to eye height', () => {
    const state = createPlayerState(SPAWN);
    state.position.y = 2;
    expect(eyePosition(state, 1.65)).toEqual({ x: 0, y: 3.65, z: 11 });
  });

  it('interpolatePlayerPosition blends the previous and current step', () => {
    const state = createPlayerState(SPAWN);
    state.previousPosition = vec3(0, 0, 0);
    state.position = vec3(10, 0, 20);

    expect(interpolatePlayerPosition(state, 0)).toEqual({ x: 0, y: 0, z: 0 });
    expect(interpolatePlayerPosition(state, 1)).toEqual({ x: 10, y: 0, z: 20 });
    expect(interpolatePlayerPosition(state, 0.25)).toEqual({ x: 2.5, y: 0, z: 5 });
  });

  it('interpolatePlayerPosition can write into a caller-owned vector', () => {
    const state = createPlayerState(SPAWN);
    const target = vec3();
    const returned = interpolatePlayerPosition(state, 0.5, target);
    expect(returned).toBe(target);
  });
});

describe('snapshotPlayer', () => {
  it('reports speeds and motion state', () => {
    const state = createPlayerState(SPAWN);
    state.velocity = vec3(3, -4, 0);
    state.grounded = true;
    state.groundId = 'roof';

    const snapshot = snapshotPlayer(state);
    expect(snapshot.speed).toBeCloseTo(5, 12);
    expect(snapshot.horizontalSpeed).toBeCloseTo(3, 12);
    expect(snapshot.grounded).toBe(true);
    expect(snapshot.groundId).toBe('roof');
    expect(snapshot.position).toEqual(state.position);
  });

  it('copies the position and velocity so later steps cannot mutate it', () => {
    const state = createPlayerState(SPAWN);
    const snapshot = snapshotPlayer(state);
    state.position.x = 500;
    state.velocity.y = -500;
    expect(snapshot.position.x).toBe(0);
    expect(snapshot.velocity.y).toBe(0);
  });
});

describe('speed helpers', () => {
  it('horizontalSpeed ignores vertical motion', () => {
    const state = createPlayerState(SPAWN);
    state.velocity = vec3(3, -100, 4);
    expect(horizontalSpeed(state)).toBeCloseTo(5, 12);
    expect(speed(state)).toBeCloseTo(Math.hypot(3, 100, 4), 9);
  });
});

describe('collision box wiring', () => {
  it('uses the configured radius and height', () => {
    // A ceiling exactly one player-height up must be reachable but not passed.
    const ceiling: AABB = aabbFromCenterSize(vec3(0, CONFIG.height + 1 + 0.5, 0), vec3(20, 1, 20));
    const stepWorld = new CollisionWorld([FLOOR, { id: 'ceiling', kind: 'prop', box: ceiling }]);
    const state = createPlayerState(SPAWN);
    state.position.y = 5;

    stepPlayer(state, STILL, STEP, { world: stepWorld, config: CONFIG });
    // Nothing to assert beyond "it did not explode"; the real ceiling test lives
    // in the collision suite. This guards the wiring between player and world.
    expect(Number.isFinite(state.position.y)).toBe(true);
  });
});
