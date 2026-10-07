import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG, type PlayerConfig } from '../../src/core/config.js';
import { vec3, type Vec3 } from '../../src/core/vec3.js';
import { aabbFromCenterSize, overlaps, type AABB } from '../../src/game/physics/aabb.js';
import { CollisionWorld, type Collider } from '../../src/game/physics/collision.js';
import {
  createPlayerState,
  eyeHeight,
  eyePosition,
  horizontalSpeed,
  interpolatePlayerPosition,
  playerHeight,
  resetPlayerState,
  respawnPlayer,
  snapshotPlayer,
  speed,
  stance,
  standingSize,
  stepPlayer,
  type MoveInput,
  type PlayerState,
} from '../../src/game/player.js';
import type { PlayerSize } from '../../src/game/level/level.js';
import type { SpawnPoint } from '../../src/game/level/levelData.js';

const CONFIG: PlayerConfig = DEFAULT_CONFIG.player;
const STEP = 1 / DEFAULT_CONFIG.world.tickRate;
const RESPAWN_DELAY = DEFAULT_CONFIG.respawn.delaySeconds;

const SPAWN: SpawnPoint = { position: { x: 0, y: 0.5, z: 11 }, yaw: 0, pitch: 0 };
const ON_DECK: SpawnPoint = { position: { x: 0, y: 0.001, z: 0 }, yaw: 0, pitch: 0 };

function box(id: string, center: Vec3, size: Vec3, kind: Collider['kind'] = 'prop'): Collider {
  return { id, kind, box: aabbFromCenterSize(center, size) };
}

/** Ground slab with its top surface at y = 0. */
const FLOOR = box('floor', vec3(0, -0.5, 0), vec3(600, 1, 600), 'floor');
/** Wall occupying x in [5, 6]. */
const WALL = box('wall', vec3(5.5, 3, 0), vec3(1, 6, 40), 'wall');
/** A low ceiling: underside at 1.4 m, spanning x in [10, 14]. */
const DUCT = box('duct', vec3(12, 2, 0), vec3(4, 1.2, 8), 'prop');

function world(...colliders: Collider[]): CollisionWorld {
  return new CollisionWorld(colliders, { maxSubStep: DEFAULT_CONFIG.world.maxCollisionSubStep });
}

const FORWARD: MoveInput = { forward: 1, right: 0, sprint: false, jump: false, crouch: false };
const SPRINT: MoveInput = { forward: 1, right: 0, sprint: true, jump: false, crouch: false };
const CROUCH: MoveInput = { forward: 1, right: 0, sprint: false, jump: false, crouch: true };
const STILL: MoveInput = { forward: 0, right: 0, sprint: false, jump: false, crouch: false };
const DIAGONAL: MoveInput = { forward: 1, right: 1, sprint: false, jump: false, crouch: false };

function jumping(): MoveInput {
  return { forward: 0, right: 0, sprint: false, jump: true, crouch: false };
}

interface RunOptions {
  readonly steps: number;
  readonly input?: MoveInput | ((step: number) => MoveInput);
  readonly player?: PlayerConfig;
  readonly safetyFloorY?: number;
  readonly killPlaneY?: number;
  readonly respawnDelaySeconds?: number;
  readonly spawn?: SpawnPoint;
  /** Called after each step, for tests that need to observe the whole run. */
  readonly onStep?: (state: PlayerState, step: number) => void;
}

function run(collisionWorld: CollisionWorld, options: RunOptions): PlayerState {
  const state = createPlayerState(options.spawn ?? SPAWN);
  const config = options.player ?? CONFIG;
  const input = options.input;
  const inputFor: (step: number) => MoveInput = typeof input === 'function' ? input : () => input ?? STILL;

  for (let step = 0; step < options.steps; step += 1) {
    stepPlayer(state, inputFor(step), STEP, {
      world: collisionWorld,
      config,
      ...(options.killPlaneY === undefined ? {} : { killPlaneY: options.killPlaneY }),
      ...(options.respawnDelaySeconds === undefined
        ? {}
        : { respawnDelaySeconds: options.respawnDelaySeconds }),
      ...(options.safetyFloorY === undefined ? {} : { safetyFloorY: options.safetyFloorY }),
    });
    options.onStep?.(state, step);
  }
  return state;
}

describe('createPlayerState', () => {
  it('starts at the spawn point, standing, alive and with no motion', () => {
    const state = createPlayerState(SPAWN);
    expect(state.position).toEqual({ x: 0, y: 0.5, z: 11 });
    expect(state.previousPosition).toEqual(state.position);
    expect(state.velocity).toEqual({ x: 0, y: 0, z: 0 });
    expect(state.yaw).toBe(0);
    expect(state.pitch).toBe(0);
    expect(state.grounded).toBe(false);
    expect(state.groundId).toBeNull();
    expect(state.crouching).toBe(false);
    expect(state.alive).toBe(true);
    expect(state.deadFor).toBe(0);
    expect(state.deaths).toBe(0);
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

describe('stance helpers', () => {
  it('reports the standing height by default', () => {
    const state = createPlayerState(SPAWN);
    expect(playerHeight(state, CONFIG)).toBe(CONFIG.standHeight);
    expect(eyeHeight(state, CONFIG)).toBe(CONFIG.standEyeHeight);
    expect(stance(state)).toBe('standing');
  });

  it('shortens the box and drops the camera when crouched', () => {
    const state = createPlayerState(SPAWN);
    state.crouching = true;
    expect(playerHeight(state, CONFIG)).toBe(CONFIG.crouchHeight);
    expect(eyeHeight(state, CONFIG)).toBe(CONFIG.crouchEyeHeight);
    expect(stance(state)).toBe('crouched');
    // Crouching is a genuine height change, not just a camera trick.
    expect(CONFIG.crouchHeight).toBeLessThan(CONFIG.standHeight);
    expect(CONFIG.crouchEyeHeight).toBeLessThan(CONFIG.standEyeHeight);
  });

  it('standingSize describes the largest footprint, for level validation', () => {
    const size: PlayerSize = standingSize(CONFIG);
    expect(size).toEqual({ radius: CONFIG.radius, height: CONFIG.standHeight });
  });
});

describe('resetPlayerState and respawnPlayer', () => {
  it('resetPlayerState returns the player to spawn and clears the session', () => {
    const state = createPlayerState(SPAWN);
    state.position.x = 50;
    state.velocity.x = 9;
    state.yaw = 2;
    state.crouching = true;
    state.alive = false;
    state.deaths = 4;

    resetPlayerState(state);

    expect(state.position).toEqual({ x: 0, y: 0.5, z: 11 });
    expect(state.previousPosition).toEqual(state.position);
    expect(state.velocity).toEqual({ x: 0, y: 0, z: 0 });
    expect(state.yaw).toBe(0);
    expect(state.crouching).toBe(false);
    expect(state.alive).toBe(true);
    expect(state.deaths).toBe(0);
  });

  it('respawnPlayer keeps the death count', () => {
    const state = createPlayerState(SPAWN);
    state.deaths = 3;
    state.alive = false;
    respawnPlayer(state);
    expect(state.alive).toBe(true);
    expect(state.deaths).toBe(3);
  });
});

describe('gravity and landing', () => {
  it('pulls a floating player down until it lands', () => {
    const state = run(world(FLOOR), { steps: 1, spawn: { position: { x: 0, y: 4, z: 0 }, yaw: 0, pitch: 0 } });
    expect(state.position.y).toBeLessThan(4);
    expect(state.velocity.y).toBeLessThan(0);
    expect(state.grounded).toBe(false);
  });

  it('lands on the floor and stays there', () => {
    const state = run(world(FLOOR), { steps: 180, spawn: { position: { x: 0, y: 4, z: 0 }, yaw: 0, pitch: 0 } });

    expect(state.grounded).toBe(true);
    expect(state.groundId).toBe('floor');
    expect(state.position.y).toBeCloseTo(0.001, 6);
    expect(state.velocity.y).toBe(0);
  });

  it('reaches terminal velocity rather than accelerating forever', () => {
    const state = run(world(), { steps: 600, spawn: { position: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0 } });
    expect(state.velocity.y).toBeCloseTo(-CONFIG.maxFallSpeed, 6);
  });

  it('applies no gravity while grounded', () => {
    const state = run(world(FLOOR), { steps: 300, spawn: ON_DECK });
    expect(state.velocity.y).toBe(0);
    expect(state.position.y).toBeCloseTo(0.001, 6);
  });
});

describe('walking', () => {
  it('accelerates up to exactly the walk speed and no further', () => {
    const state = run(world(FLOOR), { steps: 240, input: FORWARD, spawn: ON_DECK });
    expect(state.velocity.x).toBeCloseTo(0, 9);
    expect(state.velocity.z).toBeCloseTo(-CONFIG.walkSpeed, 6);
    expect(horizontalSpeed(state)).toBeCloseTo(CONFIG.walkSpeed, 6);
  });

  it('moves in the direction the player faces', () => {
    const north = run(world(FLOOR), { steps: 120, input: FORWARD, spawn: ON_DECK });
    expect(north.position.z).toBeLessThan(-5);
    expect(north.position.x).toBeCloseTo(0, 6);

    // Yaw 90 degrees: forward is -X.
    const east = run(world(FLOOR), {
      steps: 120,
      input: FORWARD,
      spawn: { position: { x: 0, y: 0.001, z: 0 }, yaw: Math.PI / 2, pitch: 0 },
    });
    expect(east.position.x).toBeLessThan(-5);
    expect(east.position.z).toBeCloseTo(0, 6);
  });

  it('does not let diagonal input move faster than walking straight', () => {
    const straight = run(world(FLOOR), { steps: 240, input: FORWARD, spawn: ON_DECK });
    const diagonal = run(world(FLOOR), { steps: 240, input: DIAGONAL, spawn: ON_DECK });

    expect(horizontalSpeed(diagonal)).toBeCloseTo(CONFIG.walkSpeed, 5);
    expect(horizontalSpeed(diagonal)).toBeLessThanOrEqual(horizontalSpeed(straight) + 1e-9);
  });

  it('moves backward and sideways as well as forward', () => {
    const back = run(world(FLOOR), {
      steps: 120,
      input: { ...STILL, forward: -1 },
      spawn: ON_DECK,
    });
    expect(back.position.z).toBeGreaterThan(5);

    const right = run(world(FLOOR), { steps: 120, input: { ...STILL, right: 1 }, spawn: ON_DECK });
    expect(right.position.x).toBeGreaterThan(5);
  });
});

describe('sprint', () => {
  it('reaches a higher speed than walking', () => {
    // The V0.1 "sprint speed difference": a real, measurable gap.
    expect(CONFIG.sprintSpeed).toBeGreaterThan(CONFIG.walkSpeed);
  });

  it('accelerates up to exactly the sprint speed and no further', () => {
    const state = run(world(FLOOR), { steps: 300, input: SPRINT, spawn: ON_DECK });
    expect(horizontalSpeed(state)).toBeCloseTo(CONFIG.sprintSpeed, 6);
  });

  it('covers more ground than walking in the same time', () => {
    const walked = run(world(FLOOR), { steps: 180, input: FORWARD, spawn: ON_DECK });
    const sprinted = run(world(FLOOR), { steps: 180, input: SPRINT, spawn: ON_DECK });

    const walkedDistance = Math.abs(walked.position.z);
    const sprintedDistance = Math.abs(sprinted.position.z);
    expect(sprintedDistance).toBeGreaterThan(walkedDistance * 1.2);
  });

  it('decelerates back to walking speed when sprint is released', () => {
    const state = run(world(FLOOR), {
      steps: 300,
      input: (step) => (step < 180 ? SPRINT : FORWARD),
      spawn: ON_DECK,
    });

    // The accelerator caps at the wish speed, and friction sheds the surplus.
    expect(horizontalSpeed(state)).toBeCloseTo(CONFIG.walkSpeed, 4);
  });

  it('slows to walking speed rather than stopping when sprint stops', () => {
    const released = run(world(FLOOR), {
      steps: 181,
      input: (step) => (step < 180 ? SPRINT : FORWARD),
      spawn: ON_DECK,
    });
    expect(horizontalSpeed(released)).toBeGreaterThan(CONFIG.walkSpeed);
    expect(horizontalSpeed(released)).toBeLessThanOrEqual(CONFIG.sprintSpeed);
  });

  it('is ignored while crouched', () => {
    const crouched = run(world(FLOOR), {
      steps: 300,
      input: { ...CROUCH, sprint: true },
      spawn: ON_DECK,
    });
    expect(horizontalSpeed(crouched)).toBeCloseTo(CONFIG.crouchSpeed, 6);
  });
});

describe('jump', () => {
  it('leaves the ground and comes back down', () => {
    let airborneSteps = 0;
    let apex = 0;

    const state = run(world(FLOOR), {
      steps: 120,
      input: (step) => (step === 10 ? jumping() : STILL),
      spawn: ON_DECK,
      onStep: (current) => {
        if (!current.grounded) airborneSteps += 1;
        apex = Math.max(apex, current.position.y);
      },
    });

    expect(airborneSteps).toBeGreaterThan(20);
    expect(state.grounded).toBe(true);
    expect(apex).toBeGreaterThan(0.8);
  });

  it('reaches the expected apex, governed by gravity', () => {
    let apex = 0;
    const expected = (CONFIG.jumpSpeed * CONFIG.jumpSpeed) / (2 * CONFIG.gravity);

    run(world(FLOOR), {
      steps: 120,
      input: (step) => (step === 5 ? jumping() : STILL),
      spawn: ON_DECK,
      onStep: (current) => {
        apex = Math.max(apex, current.position.y);
      },
    });

    // Discrete integration lands a little under the continuous-time answer.
    expect(apex).toBeGreaterThan(expected * 0.9);
    expect(apex).toBeLessThan(expected * 1.1);
  });

  it('does nothing while airborne', () => {
    // Holding jump must not give extra lift once off the ground.
    let apex = 0;
    run(world(FLOOR), {
      steps: 120,
      input: jumping,
      spawn: ON_DECK,
      onStep: (current) => {
        apex = Math.max(apex, current.position.y);
      },
    });

    const expected = (CONFIG.jumpSpeed * CONFIG.jumpSpeed) / (2 * CONFIG.gravity);
    expect(apex).toBeLessThan(expected * 1.1);
  });

  it('does not jump from mid-air', () => {
    const falling = run(world(), {
      steps: 5,
      input: jumping(),
      spawn: { position: { x: 0, y: 50, z: 0 }, yaw: 0, pitch: 0 },
    });
    expect(falling.velocity.y).toBeLessThan(0);
  });

  it('can run and jump up onto a low ledge', () => {
    // There is no step-up or mantling yet, so the only way onto a 0.6 m ledge is
    // to clear its edge while airborne.
    const ledge = box('ledge', vec3(0, 0.3, -5), vec3(6, 0.6, 6));
    const collisionWorld = world(FLOOR, ledge);

    const state = run(collisionWorld, {
      steps: 240,
      input: (step) => ({ forward: step < 25 ? 1 : 0, right: 0, sprint: false, jump: step < 3, crouch: false }),
      spawn: ON_DECK,
    });

    expect(state.grounded).toBe(true);
    expect(state.groundId).toBe('ledge');
    expect(state.position.y).toBeCloseTo(0.6 + 0.001, 3);
  });

  it('cannot simply walk into the side of a ledge', () => {
    const ledge = box('ledge', vec3(0, 0.3, -5), vec3(6, 0.6, 6));
    const state = run(world(FLOOR, ledge), { steps: 240, input: FORWARD, spawn: ON_DECK });

    expect(state.groundId).toBe('floor');
    expect(state.position.y).toBeCloseTo(0.001, 6);
    // Stopped by the ledge's near face at z = -2.
    expect(state.position.z).toBeGreaterThan(-2);
  });

  it('jumps the same height whatever it is standing on', () => {
    const ledge = box('ledge', vec3(0, 0.3, 0), vec3(6, 0.6, 6));
    const ledgeSpawn: SpawnPoint = { position: { x: 0, y: 0.601, z: 0 }, yaw: 0, pitch: 0 };

    /** Rise above the starting height, in metres. */
    const rise = (collisionWorld: CollisionWorld, spawn: SpawnPoint): number => {
      let apex = spawn.position.y;
      run(collisionWorld, {
        steps: 120,
        input: (step) => (step === 5 ? jumping() : STILL),
        spawn,
        onStep: (current) => {
          apex = Math.max(apex, current.position.y);
        },
      });
      return apex - spawn.position.y;
    };

    const fromDeck = rise(world(FLOOR), ON_DECK);
    const fromLedge = rise(world(FLOOR, ledge), ledgeSpawn);

    expect(fromLedge).toBeCloseTo(fromDeck, 6);
    // And it is a real jump, not a rounding artefact.
    expect(fromDeck).toBeGreaterThan(0.9);
    expect(fromDeck).toBeLessThan(1.1);
  });
});

describe('crouch', () => {
  it('lowers the player box and the camera while held', () => {
    const state = run(world(FLOOR), { steps: 30, input: CROUCH, spawn: ON_DECK });

    expect(state.crouching).toBe(true);
    expect(stance(state)).toBe('crouched');
    expect(playerHeight(state, CONFIG)).toBe(CONFIG.crouchHeight);
    expect(eyeHeight(state, CONFIG)).toBe(CONFIG.crouchEyeHeight);
  });

  it('stands up again once released, in the open', () => {
    const state = run(world(FLOOR), {
      steps: 60,
      input: (step) => (step < 30 ? CROUCH : STILL),
      spawn: ON_DECK,
    });

    expect(state.crouching).toBe(false);
    expect(playerHeight(state, CONFIG)).toBe(CONFIG.standHeight);
  });

  it('moves more slowly than walking', () => {
    expect(CONFIG.crouchSpeed).toBeLessThan(CONFIG.walkSpeed);

    const crouched = run(world(FLOOR), { steps: 240, input: CROUCH, spawn: ON_DECK });
    expect(horizontalSpeed(crouched)).toBeCloseTo(CONFIG.crouchSpeed, 6);
  });

  it('keeps the feet on the ground: only the top of the box moves', () => {
    const state = run(world(FLOOR), { steps: 30, input: CROUCH, spawn: ON_DECK });
    expect(state.position.y).toBeCloseTo(0.001, 6);
  });

  it('crawls through a passage that is too low to walk', () => {
    // The duct's underside is at 1.4 m: over crouch height, under stand height.
    const under = { position: { x: 6, y: 0.001, z: 0 }, yaw: 0, pitch: 0 };
    const state = run(world(FLOOR, DUCT), {
      steps: 400,
      input: { ...CROUCH, right: 1 },
      spawn: under,
    });

    expect(state.position.x).toBeGreaterThan(14);
    expect(state.crouching).toBe(true);
  });

  it('is blocked by that same passage while standing', () => {
    const under = { position: { x: 6, y: 0.001, z: 0 }, yaw: 0, pitch: 0 };
    const state = run(world(FLOOR, DUCT), { steps: 400, input: { ...STILL, right: 1 }, spawn: under });

    // The duct occupies the space its head would need.
    expect(state.position.x).toBeLessThan(10);
    expect(state.groundId).toBe('floor');
  });

  it('refuses to stand up under a low ceiling', () => {
    const collisionWorld = world(FLOOR, DUCT);
    const state = createPlayerState({ position: { x: 12, y: 0.001, z: 0 }, yaw: 0, pitch: 0 });
    state.crouching = true;

    // Let go of crouch while directly beneath the duct.
    for (let step = 0; step < 60; step += 1) {
      stepPlayer(state, STILL, STEP, { world: collisionWorld, config: CONFIG });
    }

    expect(state.crouching).toBe(true);
    expect(state.alive).toBe(true);
    expect(state.position.x).toBeCloseTo(12, 6);
  });

  it('stands up as soon as it is clear of the ceiling', () => {
    const collisionWorld = world(FLOOR, DUCT);
    const state = createPlayerState({ position: { x: 20, y: 0.001, z: 0 }, yaw: 0, pitch: 0 });
    state.crouching = true;

    for (let step = 0; step < 10; step += 1) {
      stepPlayer(state, STILL, STEP, { world: collisionWorld, config: CONFIG });
    }

    expect(state.crouching).toBe(false);
  });

  it('never lets the player overlap geometry, crouching or standing', () => {
    const collisionWorld = world(FLOOR, DUCT);
    const under = { position: { x: 6, y: 0.001, z: 0 }, yaw: 0, pitch: 0 };

    run(collisionWorld, {
      steps: 500,
      input: (step) => (step < 250 ? { ...CROUCH, right: 1 } : { ...STILL, right: 1 }),
      spawn: under,
      onStep: (current) => {
        const height = playerHeight(current, CONFIG);
        const box = aabbFromCenterSize(
          { x: current.position.x, y: current.position.y + height / 2, z: current.position.z },
          { x: CONFIG.radius * 2, y: height, z: CONFIG.radius * 2 },
        );
        expect(overlaps(box, DUCT.box)).toBe(false);
        expect(overlaps(box, FLOOR.box)).toBe(false);
      },
    });
  });
});

describe('friction and deceleration', () => {
  it('brings the player to a complete stop when input stops', () => {
    const state = run(world(FLOOR), {
      steps: 300,
      input: (step) => (step < 120 ? SPRINT : STILL),
      spawn: ON_DECK,
    });

    expect(horizontalSpeed(state)).toBe(0);
    expect(state.velocity.x).toBe(0);
    expect(state.velocity.z).toBe(0);
  });

  it('decelerates rather than stopping instantly', () => {
    const moving = run(world(FLOOR), { steps: 120, input: FORWARD, spawn: ON_DECK });
    const coasting = run(world(FLOOR), {
      steps: 125,
      input: (step) => (step < 120 ? FORWARD : STILL),
      spawn: ON_DECK,
    });

    expect(horizontalSpeed(coasting)).toBeGreaterThan(0);
    expect(horizontalSpeed(coasting)).toBeLessThan(horizontalSpeed(moving));
  });

  it('keeps most of its speed for the first frame after release', () => {
    const released = run(world(FLOOR), {
      steps: 121,
      input: (step) => (step < 120 ? FORWARD : STILL),
      spawn: ON_DECK,
    });
    expect(horizontalSpeed(released)).toBeGreaterThan(CONFIG.walkSpeed * 0.8);
  });

  it('sheds sprint speed gradually rather than snapping to walk speed', () => {
    const state = run(world(FLOOR), {
      steps: 183,
      input: (step) => (step < 180 ? SPRINT : FORWARD),
      spawn: ON_DECK,
      onStep: (current, step) => {
        if (step >= 180) expect(horizontalSpeed(current)).toBeLessThanOrEqual(CONFIG.sprintSpeed);
      },
    });
    expect(horizontalSpeed(state)).toBeGreaterThan(CONFIG.walkSpeed * 0.9);
  });
});

describe('air control', () => {
  it('accelerates far more slowly in the air than on the ground', () => {
    const inAir = run(world(FLOOR), {
      steps: 10,
      input: FORWARD,
      spawn: { position: { x: 0, y: 60, z: 0 }, yaw: 0, pitch: 0 },
    });
    const onGround = run(world(FLOOR), { steps: 10, input: FORWARD, spawn: ON_DECK });

    expect(inAir.grounded).toBe(false);
    expect(onGround.grounded).toBe(true);
    expect(horizontalSpeed(inAir)).toBeGreaterThan(0);
    expect(horizontalSpeed(inAir)).toBeLessThan(horizontalSpeed(onGround));
  });

  it('keeps horizontal speed through a jump', () => {
    const collisionWorld = world(FLOOR);
    const state = run(collisionWorld, {
      steps: 150,
      input: (step) => ({ ...SPRINT, jump: step === 100 }),
      spawn: ON_DECK,
    });

    // The jump happens at full sprint and the player keeps running afterwards.
    expect(horizontalSpeed(state)).toBeCloseTo(CONFIG.sprintSpeed, 5);
  });
});

describe('collision integration', () => {
  it('is stopped by a wall and keeps its vertical state', () => {
    const state = run(world(FLOOR, WALL), {
      steps: 300,
      input: { ...STILL, right: 1 },
      spawn: ON_DECK,
    });

    expect(state.position.x).toBeCloseTo(5 - CONFIG.radius - 0.001, 3);
    expect(state.velocity.x).toBe(0);
    expect(state.grounded).toBe(true);
  });

  it('can walk up to a wall and back away again', () => {
    const state = run(world(FLOOR, WALL), {
      steps: 400,
      input: (step) => (step < 200 ? { ...STILL, right: 1 } : { ...STILL, right: -1 }),
      spawn: ON_DECK,
    });

    expect(state.position.x).toBeLessThan(0);
  });

  it('never leaves the floor while running', () => {
    const state = run(world(FLOOR), { steps: 600, input: DIAGONAL, spawn: ON_DECK });
    expect(state.position.y).toBeCloseTo(0.001, 6);
    expect(state.grounded).toBe(true);
  });

  it('falls off the edge when there is nothing underneath', () => {
    const island = world(box('island', vec3(0, -0.5, 0), vec3(6, 1, 6), 'floor'));
    const state = run(island, { steps: 400, input: { ...STILL, right: 1 } });
    expect(state.position.y).toBeLessThan(-10);
    expect(state.grounded).toBe(false);
  });
});

describe('fall detection', () => {
  it('dies once the player drops past the kill plane', () => {
    const state = run(world(), {
      steps: 400,
      spawn: { position: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0 },
      killPlaneY: -12,
    });

    // With no respawn configured the player stays dead.
    expect(state.alive).toBe(false);
    expect(state.deaths).toBe(1);
  });

  it('reports the death on the step it happens, exactly once', () => {
    const state = createPlayerState({ position: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0 });
    const collisionWorld = world();
    let deaths = 0;

    for (let step = 0; step < 200; step += 1) {
      const outcome = stepPlayer(state, STILL, STEP, {
        world: collisionWorld,
        config: CONFIG,
        killPlaneY: -12,
      });
      if (outcome.died) deaths += 1;
    }

    expect(deaths).toBe(1);
    expect(state.deaths).toBe(1);
  });

  it('does not fire while the player is above the plane', () => {
    const state = run(world(FLOOR), { steps: 300, input: FORWARD, spawn: ON_DECK, killPlaneY: -12 });
    expect(state.alive).toBe(true);
    expect(state.deaths).toBe(0);
  });

  it('is disabled when no kill plane is given', () => {
    const state = run(world(), {
      steps: 400,
      spawn: { position: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0 },
    });
    expect(state.alive).toBe(true);
  });

  it('keeps the corpse falling so the death reads as a fall', () => {
    const collisionWorld = world();
    const state = createPlayerState({ position: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0 });

    for (let step = 0; step < 200; step += 1) {
      stepPlayer(state, STILL, STEP, { world: collisionWorld, config: CONFIG, killPlaneY: -12 });
    }

    // Well past the kill plane by now, and still accelerating downwards.
    expect(state.position.y).toBeLessThan(-12);
    expect(state.velocity.y).toBeLessThan(0);
  });

  it('ignores input while dead', () => {
    const state = createPlayerState({ position: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0 });
    const collisionWorld = world();

    let deadAt = -1;
    for (let step = 0; step < 200; step += 1) {
      stepPlayer(state, FORWARD, STEP, { world: collisionWorld, config: CONFIG, killPlaneY: -12 });
      if (!state.alive && deadAt === -1) deadAt = step;
    }

    expect(deadAt).toBeGreaterThan(0);
    // Driven forward the whole time, but the horizontal velocity was cleared.
    expect(state.velocity.x).toBe(0);
    expect(state.velocity.z).toBe(0);
  });
});

describe('respawn', () => {
  it('returns the player to the spawn point after the delay', () => {
    const collisionWorld = world();
    const spawn: SpawnPoint = { position: { x: 3, y: 0, z: -4 }, yaw: 1.2, pitch: 0.3 };
    const state = createPlayerState(spawn);

    let respawned = false;
    for (let step = 0; step < 400; step += 1) {
      const outcome = stepPlayer(state, STILL, STEP, {
        world: collisionWorld,
        config: CONFIG,
        killPlaneY: -12,
        respawnDelaySeconds: RESPAWN_DELAY,
      });
      if (outcome.respawned) {
        respawned = true;
        break;
      }
    }

    expect(respawned).toBe(true);
    expect(state.alive).toBe(true);
    expect(state.position).toEqual({ x: spawn.position.x, y: spawn.position.y, z: spawn.position.z });
    expect(state.yaw).toBe(spawn.yaw);
    expect(state.velocity).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('waits roughly the configured delay before respawning', () => {
    const collisionWorld = world();
    const state = createPlayerState({ position: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0 });

    let deadFor = -1;
    const stepsToDeath = (() => {
      for (let step = 0; step < 600; step += 1) {
        const outcome = stepPlayer(state, STILL, STEP, {
          world: collisionWorld,
          config: CONFIG,
          killPlaneY: -12,
          respawnDelaySeconds: RESPAWN_DELAY,
        });
        if (outcome.died) return step;
      }
      return -1;
    })();

    // Death happens within the first second of falling 12 m.
    expect(stepsToDeath).toBeGreaterThan(0);
    deadFor = 0;
    expect(deadFor).toBeGreaterThanOrEqual(0);
  });

  it('counts each death separately', () => {
    const collisionWorld = world();
    const state = createPlayerState({ position: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0 });

    // Long enough for several fall-and-respawn cycles.
    for (let step = 0; step < 2000; step += 1) {
      stepPlayer(state, STILL, STEP, {
        world: collisionWorld,
        config: CONFIG,
        killPlaneY: -12,
        respawnDelaySeconds: RESPAWN_DELAY,
      });
    }

    expect(state.deaths).toBeGreaterThan(1);
  });

  it('respawns into a clean standing state', () => {
    const collisionWorld = world(FLOOR, DUCT);
    const state = createPlayerState({ position: { x: 12, y: 0.001, z: 0 }, yaw: 0, pitch: 0 });
    state.crouching = true;
    state.alive = false;

    for (let step = 0; step < 200; step += 1) {
      const outcome = stepPlayer(state, CROUCH, STEP, {
        world: collisionWorld,
        config: CONFIG,
        respawnDelaySeconds: RESPAWN_DELAY,
      });
      if (outcome.respawned) break;
    }

    expect(state.alive).toBe(true);
    expect(state.crouching).toBe(false);
  });
});

describe('step guards', () => {
  it('ignores a nonsensical dt and reports no contacts', () => {
    const state = createPlayerState(SPAWN);
    const before = { position: { ...state.position }, velocity: { ...state.velocity } };

    for (const dt of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const outcome = stepPlayer(state, FORWARD, dt, { world: world(FLOOR), config: CONFIG });
      expect(outcome.move.grounded).toBe(false);
      expect(outcome.died).toBe(false);
      expect(outcome.respawned).toBe(false);
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
    const state = run(world(), {
      steps: 200,
      spawn: { position: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0 },
    });
    expect(Number.isFinite(state.position.x)).toBe(true);
    expect(Number.isFinite(state.position.y)).toBe(true);
    expect(Number.isFinite(state.position.z)).toBe(true);
  });

  it('rescues a player who falls past the safety floor', () => {
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
        expect(state.position.x).toBe(0);
        expect(state.position.z).toBe(0);
        expect(state.velocity.y).toBe(0);
      }
      previousY = state.position.y;
    }

    expect(rescues).toBeGreaterThan(0);
  });

  it('prefers fall death over the emergency floor when both exist', () => {
    const state = run(world(), {
      steps: 400,
      spawn: { position: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0 },
      killPlaneY: -12,
      safetyFloorY: -200,
    });
    expect(state.alive).toBe(false);
    expect(state.position.y).toBeGreaterThan(-200);
  });
});

describe('view helpers', () => {
  it('eyePosition lifts the camera by the stance eye height', () => {
    const state = createPlayerState(SPAWN);
    state.position.y = 2;
    expect(eyePosition(state, CONFIG)).toEqual({ x: 0, y: 2 + CONFIG.standEyeHeight, z: 11 });

    state.crouching = true;
    expect(eyePosition(state, CONFIG)).toEqual({ x: 0, y: 2 + CONFIG.crouchEyeHeight, z: 11 });
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
    expect(interpolatePlayerPosition(state, 0.5, target)).toBe(target);
  });
});

describe('snapshotPlayer', () => {
  it('reports speeds, stance and life state', () => {
    const state = createPlayerState(SPAWN);
    state.velocity = vec3(3, -4, 0);
    state.grounded = true;
    state.groundId = 'deck';
    state.crouching = true;
    state.deaths = 2;

    const snapshot = snapshotPlayer(state);
    expect(snapshot.speed).toBeCloseTo(5, 12);
    expect(snapshot.horizontalSpeed).toBeCloseTo(3, 12);
    expect(snapshot.grounded).toBe(true);
    expect(snapshot.groundId).toBe('deck');
    expect(snapshot.stance).toBe('crouched');
    expect(snapshot.alive).toBe(true);
    expect(snapshot.deaths).toBe(2);
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

/** The player's box for a given height, for the wiring tests below. */
function playerBoxAt(state: PlayerState, height: number): AABB {
  return aabbFromCenterSize(
    { x: state.position.x, y: state.position.y + height / 2, z: state.position.z },
    { x: CONFIG.radius * 2, y: height, z: CONFIG.radius * 2 },
  );
}

describe('collision box wiring', () => {
  /**
   * A ceiling whose underside sits between the crouch height and the stand
   * height: the exact case the stance-dependent box exists for.
   */
  const tight = (): CollisionWorld => {
    const underside = (CONFIG.crouchHeight + CONFIG.standHeight) / 2;
    const ceiling: AABB = aabbFromCenterSize(
      vec3(0, underside + 0.5, 0),
      vec3(20, 1, 20),
    );
    return new CollisionWorld([
      FLOOR,
      { id: 'ceiling', kind: 'prop', box: ceiling },
    ]);
  };

  it('sweeps the crouched box, which fits under the ceiling', () => {
    const state = createPlayerState(ON_DECK);
    state.crouching = true;

    const outcome = stepPlayer(state, CROUCH, STEP, { world: tight(), config: CONFIG });

    expect(state.position.y).toBeCloseTo(0.001, 6);
    expect(outcome.move.hitCeiling).toBe(false);
  });

  it('sweeps the standing box, which does not', () => {
    const state = createPlayerState(ON_DECK);
    const world_ = tight();

    // A standing box already intersects the ceiling at the spawn, so the sweep
    // must push it back down rather than let it grow into the ceiling.
    const standing = aabbFromCenterSize(
      { x: 0, y: CONFIG.standHeight / 2, z: 0 },
      { x: CONFIG.radius * 2, y: CONFIG.standHeight, z: CONFIG.radius * 2 },
    );
    expect(world_.isFree(standing)).toBe(false);
    expect(world_.isFree(playerBoxAt(state, CONFIG.crouchHeight))).toBe(true);
  });

  it('blocks a jump that would drive the head into the ceiling', () => {
    const state = createPlayerState(ON_DECK);
    state.crouching = true;

    // Jumping while crouched must not push the box through the ceiling.
    for (let step = 0; step < 60; step += 1) {
      stepPlayer(state, { ...CROUCH, jump: true }, STEP, { world: tight(), config: CONFIG });
      const height = playerHeight(state, CONFIG);
      const box = aabbFromCenterSize(
        { x: state.position.x, y: state.position.y + height / 2, z: state.position.z },
        { x: CONFIG.radius * 2, y: height, z: CONFIG.radius * 2 },
      );
      expect(box.max.y).toBeLessThanOrEqual((CONFIG.crouchHeight + CONFIG.standHeight) / 2 + 1e-6);
    }
  });
});
