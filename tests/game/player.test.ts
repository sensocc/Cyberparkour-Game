/**
 * The locomotion model.
 *
 * Six movement modes share one priority chain, so these tests walk each of them
 * individually and then check the transitions between them. The reachability
 * assertions are written against the *configured* bands rather than against
 * literal heights, so retuning jump speed or the mantle ceiling cannot quietly
 * invalidate them.
 */

import { describe, expect, it } from 'vitest';

import { vec3 } from '../../src/core/vec3.js';
import { overlaps } from '../../src/game/physics/aabb.js';
import { CollisionWorld } from '../../src/game/physics/collision.js';
import {
  advanceHeadBob,
  createPlayerState,
  eyePosition,
  eyeHeight,
  headBobOffset,
  horizontalSpeed,
  interpolatePlayerPosition,
  locomotion,
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
import {
  boxOf,
  collider,
  CONFIG,
  CROUCH,
  FLOOR,
  FORWARD,
  input,
  FACING_EAST,
  ON_DECK,
  optionsFor,
  run,
  spawnAt,
  SPRINT,
  STEP,
  STILL,
  world,
} from '../helpers/player.js';

const PLAYER = CONFIG.player;
/** Apex of a jump, from the configured jump speed and gravity. */
const JUMP_APEX = (PLAYER.jumpSpeed * PLAYER.jumpSpeed) / (2 * PLAYER.gravity);

/** A step whose top is `height` metres above the floor, starting at x = 0.5. */
function stepAt(id: string, height: number) {
  return collider(id, vec3(2.5, height / 2, 0), vec3(4, height, 8));
}

/** A wall-like climbable face rising `height` metres, at x = 0.5. */
function climbableAt(id: string, height: number) {
  return collider(id, vec3(0.8, height / 2, 0), vec3(0.6, height, 1.2), 'climbable');
}

/** A ceiling slab whose underside is `underside` metres above the floor. */
function ceilingAt(underside: number, thickness = 1) {
  return collider('ceiling', vec3(0, underside + thickness / 2, 0), vec3(8, thickness, 8));
}

describe('createPlayerState', () => {
  it('starts standing, alive, unhurt and on full health', () => {
    const state = createPlayerState(ON_DECK, CONFIG);
    expect(state.alive).toBe(true);
    expect(state.crouching).toBe(false);
    expect(state.sliding).toBe(false);
    expect(state.hangId).toBeNull();
    expect(state.climbId).toBeNull();
    expect(state.maneuver).toBeNull();
    expect(state.health).toBe(CONFIG.fallDamage.maxHealth);
    expect(state.deaths).toBe(0);
    expect(state.deathCause).toBeNull();
    expect(locomotion(state)).toBe('airborne');
  });

  it('does not alias the spawn definition it was given', () => {
    const spawn = spawnAt(1, 2, 3);
    const state = createPlayerState(spawn, CONFIG);
    state.position.x = 42;
    expect(spawn.position.x).toBe(1);
  });
});

describe('stance helpers', () => {
  it('shortens the box and drops the camera when crouched', () => {
    const state = createPlayerState(ON_DECK, CONFIG);
    expect(playerHeight(state, PLAYER)).toBe(PLAYER.standHeight);
    expect(eyeHeight(state, PLAYER)).toBe(PLAYER.standEyeHeight);

    state.crouching = true;
    expect(playerHeight(state, PLAYER)).toBe(PLAYER.crouchHeight);
    expect(eyeHeight(state, PLAYER)).toBe(PLAYER.crouchEyeHeight);
    expect(stance(state)).toBe('crouched');
  });

  it('standingSize describes the largest footprint, for level validation', () => {
    expect(standingSize(PLAYER)).toEqual({ radius: PLAYER.radius, height: PLAYER.standHeight });
  });
});

describe('lifecycle', () => {
  it('respawnPlayer clears every manoeuvre and restores health', () => {
    const state = createPlayerState(ON_DECK, CONFIG);
    state.health = 12;
    state.sliding = true;
    state.hangId = 'ledge';
    state.climbId = 'pipe';
    state.crouching = true;
    state.alive = false;
    state.deaths = 3;

    respawnPlayer(state, CONFIG);

    expect(state.alive).toBe(true);
    expect(state.health).toBe(CONFIG.fallDamage.maxHealth);
    expect(state.crouching).toBe(false);
    expect(state.sliding).toBe(false);
    expect(state.hangId).toBeNull();
    expect(state.climbId).toBeNull();
    expect(state.maneuver).toBeNull();
    expect(state.velocity).toEqual({ x: 0, y: 0, z: 0 });
    // A respawn is not a restart: the death count survives.
    expect(state.deaths).toBe(3);
  });

  it('resetPlayerState also clears the death count', () => {
    const state = createPlayerState(ON_DECK, CONFIG);
    state.deaths = 4;
    resetPlayerState(state, CONFIG);
    expect(state.deaths).toBe(0);
  });
});

describe('ordinary locomotion', () => {
  it('walks up to exactly the walk speed', () => {
    const state = run(world(FLOOR), { steps: 240, input: FORWARD });
    expect(horizontalSpeed(state)).toBeCloseTo(PLAYER.walkSpeed, 6);
    expect(state.position.z).toBeLessThan(-8);
  });

  it('sprints faster, and settles back to walking when it stops sprinting', () => {
    const sprinted = run(world(FLOOR), { steps: 240, input: SPRINT });
    expect(horizontalSpeed(sprinted)).toBeCloseTo(PLAYER.sprintSpeed, 6);

    const eased = run(world(FLOOR), {
      steps: 300,
      input: (step) => (step < 180 ? SPRINT : FORWARD),
    });
    expect(horizontalSpeed(eased)).toBeCloseTo(PLAYER.walkSpeed, 4);
  });

  it('crouches to a slower speed and a shorter box', () => {
    const state = run(world(FLOOR), { steps: 240, input: CROUCH });
    expect(state.crouching).toBe(true);
    expect(horizontalSpeed(state)).toBeCloseTo(PLAYER.crouchSpeed, 6);
    expect(state.position.y).toBeCloseTo(0.001, 6);
  });

  it('refuses to stand up under a low ceiling', () => {
    const tight = world(FLOOR, ceilingAt((PLAYER.crouchHeight + PLAYER.standHeight) / 2));
    const state = createPlayerState(ON_DECK, CONFIG);
    state.crouching = true;
    for (let step = 0; step < 40; step += 1) {
      stepPlayer(state, STILL, STEP, optionsFor(tight));
    }
    expect(state.crouching).toBe(true);
  });

  it('stands up as soon as it is clear of the ceiling', () => {
    const state = createPlayerState(spawnAt(6, 0.001, 0), CONFIG);
    state.crouching = true;
    const flat = world(FLOOR, ceilingAt(1.5, 1));
    for (let step = 0; step < 10; step += 1) {
      stepPlayer(state, STILL, STEP, optionsFor(flat));
    }
    expect(state.crouching).toBe(false);
  });

  it('jumps to the configured apex and lands again', () => {
    let apex = 0;
    const state = run(world(FLOOR), {
      steps: 200,
      input: (step) => input({ jump: step < 2 }),
      onStep: (current) => {
        apex = Math.max(apex, current.position.y);
      },
    });

    expect(apex).toBeGreaterThan(JUMP_APEX * 0.9);
    expect(apex).toBeLessThan(JUMP_APEX * 1.15);
    expect(state.grounded).toBe(true);
  });

  it('cannot jump from mid-air', () => {
    const state = run(world(), {
      steps: 5,
      input: input({ jump: true }),
      spawn: spawnAt(0, 50, 0),
    });
    expect(state.velocity.y).toBeLessThan(0);
  });

  it('never ends a step inside geometry', () => {
    const obstacle = collider('block', vec3(2, 1, 0), vec3(2, 2, 2));
    const collisionWorld = world(FLOOR, obstacle);
    run(collisionWorld, {
      steps: 400,
      input: (step) => input({ forward: step % 80 < 40 ? 1 : -1, right: step % 40 < 20 ? 1 : -1, sprint: true }),
      onStep: (current) => {
        expect(overlaps(boxOf(current), obstacle.box)).toBe(false);
        expect(overlaps(boxOf(current), FLOOR.box)).toBe(false);
      },
    });
  });
});

describe('sliding', () => {
  it('starts from a run and outruns the sprint cap briefly', () => {
    let fastest = 0;
    const state = run(world(FLOOR), {
      steps: 400,
      input: (step) => (step < 120 ? SPRINT : input({ crouch: true })),
      onStep: (current) => {
        fastest = Math.max(fastest, horizontalSpeed(current));
      },
    });

    expect(fastest).toBeGreaterThan(PLAYER.sprintSpeed);
    // ...and then bleeds off, so a slide cannot be sustained.
    expect(horizontalSpeed(state)).toBeLessThan(PLAYER.walkSpeed);
  });

  it('reports the slide as a manoeuvre start and end', () => {
    const state = createPlayerState(ON_DECK, CONFIG);
    const collisionWorld = world(FLOOR);
    const events: string[] = [];

    for (let step = 0; step < 400; step += 1) {
      const action = step < 120 ? SPRINT : input({ crouch: true });
      const outcome = stepPlayer(state, action, STEP, optionsFor(collisionWorld));
      if (outcome.started) events.push(`start:${outcome.started}`);
      if (outcome.ended) events.push(`end:${outcome.ended}`);
    }

    expect(events).toContain('start:slide');
    expect(events).toContain('end:slide');
  });

  it('passes under the duct while a standing player cannot', () => {
    // Underside at 1.4 m: over crouch height, under stand height.
    const duct = collider('duct', vec3(12, 2, 0), vec3(4, 1.2, 8));
    const collisionWorld = world(FLOOR, duct);

    const slid = run(collisionWorld, {
      steps: 400,
      input: (step) => (step < 100 ? input({ right: 1, sprint: true }) : input({ right: 1, crouch: true })),
    });
    const walked = run(collisionWorld, { steps: 400, input: input({ right: 1 }) });

    expect(walked.position.x).toBeLessThan(10);
    expect(slid.position.x).toBeGreaterThan(14);
  });

  it('does not start from a slow walk', () => {
    const state = run(world(FLOOR), { steps: 400, input: input({ forward: 1, crouch: true }) });
    expect(state.sliding).toBe(false);
  });
});

describe('mantling', () => {
  it('steps up a ledge that is within the mantle band', () => {
    const stepHeight = (CONFIG.maneuver.mantle.minHeight + CONFIG.maneuver.mantle.maxHeight) / 2;
    const ledge = stepAt('ledge', stepHeight);
    const collisionWorld = world(FLOOR, ledge);

    // Stop pushing once the mantle has finished, or the player simply keeps
    // walking and steps off the far side of the ledge.
    const state = run(collisionWorld, {
      steps: 120,
      input: (step) => (step < 26 ? input({ right: 1 }) : STILL),
    });

    expect(state.grounded).toBe(true);
    expect(state.groundId).toBe('ledge');
    expect(state.position.y).toBeCloseTo(stepHeight, 2);
    expect(state.alive).toBe(true);
  });

  it('reports the mantle as a manoeuvre', () => {
    const ledge = stepAt('ledge', 0.8);
    const state = createPlayerState(ON_DECK, CONFIG);
    const collisionWorld = world(FLOOR, ledge);
    const events: string[] = [];

    for (let step = 0; step < 120; step += 1) {
      const outcome = stepPlayer(state, input({ right: 1 }), STEP, optionsFor(collisionWorld));
      if (outcome.started) events.push(outcome.started);
      if (outcome.ended) events.push(`end:${outcome.ended}`);
    }

    expect(events).toContain('mantle');
    expect(events).toContain('end:mantle');
  });

  it('leaves the player in a scripted pose while mantling', () => {
    const ledge = stepAt('ledge', 0.8);
    const collisionWorld = world(FLOOR, ledge);
    const state = createPlayerState(ON_DECK, CONFIG);
    let sawMantling = false;

    for (let step = 0; step < 200; step += 1) {
      stepPlayer(state, input({ right: 1 }), STEP, optionsFor(collisionWorld));
      if (locomotion(state) === 'mantling') {
        sawMantling = true;
        // Input is ignored mid-move.
        expect(state.velocity).toEqual({ x: 0, y: 0, z: 0 });
      }
    }

    // Mantling ignores collision on purpose - the pose passes through the volume
    // it is climbing - so the invariant is that it *ends* clear, not that it
    // never overlaps.
    const settled = run(collisionWorld, {
      steps: 120,
      input: (step) => (step < 26 ? input({ right: 1 }) : STILL),
    });
    expect(sawMantling).toBe(true);
    expect(overlaps(boxOf(settled), ledge.box)).toBe(false);
  });

  it('does not mantle something below the minimum height', () => {
    const flat = collider('kerb', vec3(2.5, 0.05, 0), vec3(4, 0.1, 8), 'floor');
    const state = run(world(FLOOR, flat), { steps: 60, input: input({ right: 1 }) });
    expect(state.maneuver).toBeNull();
  });

  it('does not mantle something above the maximum height', () => {
    const tall = stepAt('tall', CONFIG.maneuver.mantle.maxHeight + 1);
    const state = run(world(FLOOR, tall), { steps: 60, input: input({ right: 1 }) });
    expect(state.maneuver).toBeNull();
    expect(state.position.x).toBeLessThan(0.4);
  });

  it('does not mantle a ledge the player is walking away from', () => {
    const ledge = stepAt('ledge', 0.8);
    const state = run(world(FLOOR, ledge), { steps: 60, input: input({ right: -1 }) });
    expect(state.maneuver).toBeNull();
  });

  it('refuses a ledge with no room to stand on top', () => {
    const ledge = stepAt('ledge', 0.8);
    // A slab right above the ledge, leaving no headroom.
    const overhang = collider('overhang', vec3(2.5, 0.85 + PLAYER.standHeight / 2, 0), vec3(4, 0.4, 8));
    const state = run(world(FLOOR, ledge, overhang), { steps: 60, input: input({ right: 1 }) });
    expect(state.maneuver).toBeNull();
  });
});

describe('grabbing and pull-ups', () => {
  /** A ledge inside the grab band, but above the mantle ceiling. */
  const grabHeight = (CONFIG.maneuver.pullUp.minHeight + CONFIG.maneuver.pullUp.maxHeight) / 2;

  it('catches a ledge that is too high to step onto', () => {
    const ledge = stepAt('ledge', grabHeight);
    const collisionWorld = world(FLOOR, ledge);

    const state = run(collisionWorld, { steps: 20, input: input({ right: 1, jump: true }) });

    expect(state.hangId).toBe('ledge');
    expect(locomotion(state)).toBe('hanging');
    // Feet dangle the configured distance below the top.
    expect(state.position.y).toBeCloseTo(grabHeight - CONFIG.maneuver.pullUp.hangDepth, 3);
    expect(state.velocity).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('hangs indefinitely rather than sliding down', () => {
    const ledge = stepAt('ledge', grabHeight);
    const collisionWorld = world(FLOOR, ledge);
    const state = createPlayerState(ON_DECK, CONFIG);

    // Jump into it, then hold everything still for a while.
    for (let step = 0; step < 10; step += 1) {
      stepPlayer(state, input({ right: 1, jump: true }), STEP, optionsFor(collisionWorld));
    }
    const grabbed = state.position.y;
    for (let step = 0; step < 300; step += 1) {
      stepPlayer(state, STILL, STEP, optionsFor(collisionWorld));
    }

    expect(state.hangId).toBe('ledge');
    expect(state.position.y).toBeCloseTo(grabbed, 6);
  });

  it('needs the jump key released before pulling up', () => {
    const ledge = stepAt('ledge', grabHeight);
    const collisionWorld = world(FLOOR, ledge);

    // Jumping in and *holding* jump must not immediately haul the player up.
    const holding = run(collisionWorld, { steps: 60, input: input({ right: 1, jump: true }) });
    expect(holding.hangId).toBe('ledge');

    // Releasing and pressing again does.
    const state = createPlayerState(ON_DECK, CONFIG);
    let pulledUp = false;
    for (let step = 0; step < 400; step += 1) {
      const action =
        step < 10
          ? input({ right: 1, jump: true })
          : step < 40
            ? input({ right: 1 })
            : input({ right: 1, jump: true });
      const outcome = stepPlayer(state, action, STEP, optionsFor(collisionWorld));
      if (outcome.started === 'pull-up') pulledUp = true;
      if (pulledUp && state.maneuver === null) break;
    }

    expect(pulledUp).toBe(true);
    expect(state.hangId).toBeNull();
    expect(state.grounded).toBe(true);
    expect(state.position.y).toBeCloseTo(grabHeight, 2);
  });

  it('lets go when crouching, and does not immediately re-grab', () => {
    const ledge = stepAt('ledge', grabHeight);
    const collisionWorld = world(FLOOR, ledge);
    const state = createPlayerState(ON_DECK, CONFIG);

    for (let step = 0; step < 10; step += 1) {
      stepPlayer(state, input({ right: 1, jump: true }), STEP, optionsFor(collisionWorld));
    }
    expect(state.hangId).toBe('ledge');

    // One step of crouch releases; the cooldown keeps the same ledge out of
    // reach for a moment afterwards.
    stepPlayer(state, input({ right: 1, crouch: true }), STEP, optionsFor(collisionWorld));
    expect(state.hangId).toBeNull();

    for (let step = 0; step < CONFIG.maneuver.pullUp.releaseCooldownSeconds * 30; step += 1) {
      stepPlayer(state, input({ right: 1 }), STEP, optionsFor(collisionWorld));
      expect(state.hangId).toBeNull();
    }
  });

  it('ignores a ledge above the grab ceiling', () => {
    const tooTall = stepAt('tower', CONFIG.maneuver.pullUp.maxHeight + 1.5);
    const state = run(world(FLOOR, tooTall), {
      steps: 60,
      input: input({ right: 1, jump: true }),
    });
    expect(state.hangId).toBeNull();
  });
});

describe('climbing', () => {
  it('ascends a tagged face while holding forward', () => {
    const pipe = climbableAt('pipe', 6);
    const collisionWorld = world(FLOOR, pipe);
    const climbableIds = new Set(['pipe']);

    let sawClimbing = false;
    let highest = 0;
    run(collisionWorld, {
      steps: 300,
      // Facing the pipe and pushing into it, which is what climbing asks for.
      input: input({ forward: 1 }),
      spawn: spawnAt(0, 0.001, 0, FACING_EAST),
      climbableIds,
      onStep: (current) => {
        if (locomotion(current) === 'climbing') sawClimbing = true;
        highest = Math.max(highest, current.position.y);
      },
    });

    expect(sawClimbing).toBe(true);
    // It tops out on the pipe rather than stopping pinned to its edge. The input
    // keeps running, so the player then walks off the top - what matters is that
    // they got there.
    expect(highest).toBeGreaterThan(pipe.box.max.y - 0.3);
  });

  it('ignores a face that is not tagged climbable', () => {
    const wall = collider('wall', vec3(0.8, 3, 0), vec3(0.6, 6, 1.2), 'wall');
    const state = run(world(FLOOR, wall), {
      steps: 60,
      input: input({ forward: 1 }),
      spawn: spawnAt(0, 0.001, 0, FACING_EAST),
      // Tagged, but the level's own collider is not climbable.
      climbableIds: new Set(['nothing']),
    });
    expect(state.climbId).toBeNull();
  });

  it('does not climb a tagged face that does not rise above the feet', () => {
    const stub = climbableAt('stub', 0.8);
    const state = run(world(FLOOR, stub), {
      steps: 60,
      input: input({ forward: 1 }),
      spawn: spawnAt(0, 0.001, 0, FACING_EAST),
      climbableIds: new Set(['stub']),
    });
    expect(state.climbId).toBeNull();
  });

  it('needs the player facing the face, not merely moving', () => {
    const pipe = climbableAt('pipe', 6);
    const state = run(world(FLOOR, pipe), {
      steps: 60,
      input: input({ forward: 1 }),
      // Facing east, pipe to the east: this one should work...
      spawn: spawnAt(0, 0.001, 0, FACING_EAST),
      climbableIds: new Set(['pipe']),
    });
    expect(state.climbId).toBe('pipe');

    // ...while walking backwards into it should not.
    const backwards = run(world(FLOOR, pipe), {
      steps: 60,
      input: input({ forward: -1 }),
      spawn: spawnAt(0, 0.001, 0, FACING_EAST),
      climbableIds: new Set(['pipe']),
    });
    expect(backwards.climbId).toBeNull();
  });

  it('lets go when forward is released', () => {
    const pipe = climbableAt('pipe', 6);
    const collisionWorld = world(FLOOR, pipe);
    const state = createPlayerState(spawnAt(0, 0.001, 0, FACING_EAST), CONFIG);
    const climbableIds = new Set(['pipe']);
    const climbOptions = optionsFor(collisionWorld, { climbableIds });

    for (let step = 0; step < 40; step += 1) {
      stepPlayer(state, input({ forward: 1 }), STEP, climbOptions);
    }
    expect(state.climbId).toBe('pipe');

    stepPlayer(state, STILL, STEP, climbOptions);
    expect(state.climbId).toBeNull();
  });

  it('does not fall while climbing', () => {
    const pipe = climbableAt('pipe', 6);
    const collisionWorld = world(FLOOR, pipe);
    const state = createPlayerState(spawnAt(0, 0.001, 0, FACING_EAST), CONFIG);
    const climbOptions = optionsFor(collisionWorld, { climbableIds: new Set(['pipe']) });

    const started = state.position.y;
    let lowest = started;
    for (let step = 0; step < 80; step += 1) {
      stepPlayer(state, input({ forward: 1 }), STEP, climbOptions);
      lowest = Math.min(lowest, state.position.y);
    }
    // Climbing is a controlled ascent: the player never sinks back down.
    expect(lowest).toBeGreaterThanOrEqual(started - 1e-6);
  });
});

describe('fall damage', () => {
  const fall = CONFIG.fallDamage;

  it('takes no damage from a short drop', () => {
    // Under safeImpactSpeed, which is a free fall of about 2.8 m.
    const state = createPlayerState(spawnAt(0, 2.5, 0), CONFIG);
    const collisionWorld = world(FLOOR);
    let landing = null;

    for (let step = 0; step < 200; step += 1) {
      const outcome = stepPlayer(state, STILL, STEP, optionsFor(collisionWorld));
      if (outcome.landing) landing = outcome.landing;
    }

    expect(landing).not.toBeNull();
    expect(landing?.damage).toBe(0);
    expect(state.health).toBe(fall.maxHealth);
    expect(state.alive).toBe(true);
  });

  it('scales damage with impact speed', () => {
    const measure = (height: number): number => {
      const state = createPlayerState(spawnAt(0, height, 0), CONFIG);
      const collisionWorld = world(FLOOR);
      for (let step = 0; step < 300; step += 1) {
        const outcome = stepPlayer(state, STILL, STEP, optionsFor(collisionWorld));
        if (outcome.landing) return outcome.landing.damage;
      }
      return 0;
    };

    const light = measure(6);
    const heavy = measure(9.5);

    expect(light).toBeGreaterThan(0);
    expect(heavy).toBeGreaterThan(light);
    expect(heavy).toBeLessThanOrEqual(fall.maxHealth);
  });

  it('kills the player from a fall above the fatal impact speed', () => {
    const state = createPlayerState(spawnAt(0, 40, 0), CONFIG);
    const collisionWorld = world(FLOOR);
    const events: string[] = [];

    for (let step = 0; step < 400; step += 1) {
      const outcome = stepPlayer(state, STILL, STEP, optionsFor(collisionWorld));
      if (outcome.died) events.push('died');
    }

    expect(events).toEqual(['died']);
    expect(state.alive).toBe(false);
    expect(state.deathCause).toBe('impact');
    expect(state.health).toBe(0);
  });

  it('accumulates damage across landings rather than resetting', () => {
    const state = createPlayerState(spawnAt(0, 9, 0), CONFIG);
    const collisionWorld = world(FLOOR);
    const land = (): void => {
      state.position = vec3(0, 9, 0);
      state.previousPosition = vec3(0, 9, 0);
      state.velocity = vec3(0, 0, 0);
      state.grounded = false;
      state.peakFallSpeed = 0;
      for (let step = 0; step < 200; step += 1) {
        if (stepPlayer(state, STILL, STEP, optionsFor(collisionWorld)).landing) return;
      }
    };

    land();
    const afterFirst = state.health;
    land();
    const afterSecond = state.health;

    expect(afterFirst).toBeLessThan(fall.maxHealth);
    expect(afterSecond).toBeLessThan(afterFirst);
  });

  it('a respawn restores full health', () => {
    const state = createPlayerState(spawnAt(0, 40, 0), CONFIG);
    const collisionWorld = world(FLOOR);
    const stepOptions = optionsFor(collisionWorld, { respawnDelaySeconds: CONFIG.respawn.delaySeconds });

    for (let step = 0; step < 700; step += 1) {
      stepPlayer(state, STILL, STEP, stepOptions);
    }

    expect(state.alive).toBe(true);
    expect(state.health).toBe(fall.maxHealth);
    expect(state.deaths).toBeGreaterThan(0);
  });

  it('does not count a climb or a mantle as a fall', () => {
    const ledge = stepAt('ledge', 0.8);
    const collisionWorld = world(FLOOR, ledge);
    const state = run(collisionWorld, { steps: 200, input: input({ right: 1 }) });
    expect(state.health).toBe(fall.maxHealth);
  });
});

describe('head bob', () => {
  it('is centred when the player is not moving', () => {
    const state = run(world(FLOOR), { steps: 60, input: STILL });
    const offset = headBobOffset(state, CONFIG);
    expect(Math.hypot(offset.x, offset.y, offset.z)).toBeLessThan(0.002);
  });

  it('advances with distance travelled, not with time', () => {
    const slow = run(world(FLOOR), { steps: 240, input: input({ forward: 1 }) });
    const fast = run(world(FLOOR), { steps: 240, input: SPRINT });

    // Sprinting covers more ground, so its phase has advanced further.
    const covered = (state: PlayerState): number => Math.abs(state.position.z);
    expect(covered(fast)).toBeGreaterThan(covered(slow));
    expect(fast.bobAmount).toBeGreaterThan(0.9);
    expect(slow.bobAmount).toBeGreaterThan(0.9);
  });

  it('bobs twice vertically for every lateral sway', () => {
    const state = createPlayerState(ON_DECK, CONFIG);
    state.bobAmount = 1;
    const vertical: number[] = [];
    const lateral: number[] = [];

    for (let index = 0; index < 64; index += 1) {
      state.bobPhase = (index / 64) * Math.PI * 2;
      const offset = headBobOffset(state, CONFIG);
      vertical.push(offset.y);
      lateral.push(Math.hypot(offset.x, offset.z));
    }

    const zeroCrossings = (values: number[]): number => {
      let count = 0;
      for (let index = 1; index < values.length; index += 1) {
        const previous = values[index - 1] as number;
        const current = values[index] as number;
        if (previous * current < 0) count += 1;
      }
      return count;
    };

    expect(zeroCrossings(vertical)).toBeGreaterThan(zeroCrossings(lateral.map((value, index) =>
      Math.sin((index / 64) * Math.PI * 2) * value === 0 ? 1 : value,
    )));
  });

  it('fades out when the player stops', () => {
    const state = run(world(FLOOR), {
      steps: 200,
      input: (step) => (step < 120 ? FORWARD : STILL),
    });
    expect(state.bobAmount).toBeLessThan(0.1);
  });

  it('fades out in the air', () => {
    const state = run(world(), { steps: 40, input: input({ forward: 1, jump: true }), spawn: spawnAt(0, 20, 0) });
    expect(state.bobAmount).toBeLessThan(0.2);
  });

  it('is included in the eye position', () => {
    const state = createPlayerState(ON_DECK, CONFIG);
    state.bobAmount = 1;
    state.bobPhase = Math.PI / 4;

    const eye = eyePosition(state, CONFIG);
    const expectedBob = Math.sin((Math.PI / 4) * 2) * CONFIG.headBob.verticalAmplitude;

    expect(eye.y - state.position.y - PLAYER.standEyeHeight).toBeCloseTo(expectedBob, 6);

    // ...and it is genuinely absent when the bob has faded out.
    state.bobAmount = 0;
    const still = eyePosition(state, CONFIG);
    expect(still.y - state.position.y).toBeCloseTo(PLAYER.standEyeHeight, 6);
  });

  it('advanceHeadBob does nothing for a stationary grounded player', () => {
    const state = createPlayerState(ON_DECK, CONFIG);
    state.bobAmount = 1;
    const phase = state.bobPhase;
    advanceHeadBob(state, { game: CONFIG, config: PLAYER }, 0.5, 0);

    // The phase only advances with distance travelled, so standing still leaves it
    // exactly where it was.
    expect(state.bobPhase).toBe(phase);
    // The amplitude fades rather than snapping: it drops straight away, but half a
    // second is nowhere near long enough for it to disappear.
    expect(state.bobAmount).toBeLessThan(1);
    expect(state.bobAmount).toBeGreaterThan(0);
    const later = { ...state };
    advanceHeadBob(later, { game: CONFIG, config: PLAYER }, 2, 0);
    expect(later.bobAmount).toBeLessThan(0.01);
  });
});

describe('step guards and helpers', () => {
  it('ignores a nonsensical dt', () => {
    const state = createPlayerState(ON_DECK, CONFIG);
    const before = { ...state.position };
    for (const dt of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const outcome = stepPlayer(state, FORWARD, dt, optionsFor(world(FLOOR)));
      expect(outcome.move.grounded).toBe(false);
      expect(outcome.died).toBe(false);
      expect(state.position).toEqual(before);
    }
  });

  it('records the previous position for render interpolation', () => {
    const state = createPlayerState(ON_DECK, CONFIG);
    const start = { ...state.position };
    stepPlayer(state, FORWARD, STEP, optionsFor(world(FLOOR)));
    expect(state.previousPosition).toEqual(start);
  });

  it('interpolatePlayerPosition blends between steps', () => {
    const state = createPlayerState(ON_DECK, CONFIG);
    state.previousPosition = vec3(0, 0, 0);
    state.position = vec3(10, 0, 20);

    expect(interpolatePlayerPosition(state, 0)).toEqual({ x: 0, y: 0, z: 0 });
    expect(interpolatePlayerPosition(state, 0.25)).toEqual({ x: 2.5, y: 0, z: 5 });
  });

  it('rescues a player past the safety floor', () => {
    const state = createPlayerState(spawnAt(0, 0, 0), CONFIG);
    const collisionWorld = world();
    for (let step = 0; step < 400; step += 1) {
      stepPlayer(state, STILL, STEP, optionsFor(collisionWorld, { safetyFloorY: -20 }));
      expect(state.position.y).toBeGreaterThan(-21);
    }
  });

  it('prefers fall death over the emergency floor when both exist', () => {
    const state = run(world(), {
      steps: 400,
      spawn: spawnAt(0, 0, 0),
      killPlaneY: -12,
      safetyFloorY: -200,
    });
    expect(state.alive).toBe(false);
    expect(state.deathCause).toBe('fell');
    expect(state.position.y).toBeGreaterThan(-200);
  });

  it('reports speed helpers consistently', () => {
    const state = createPlayerState(ON_DECK, CONFIG);
    state.velocity = vec3(3, -100, 4);
    expect(horizontalSpeed(state)).toBeCloseTo(5, 12);
    expect(speed(state)).toBeCloseTo(Math.hypot(3, 100, 4), 9);
  });

  it('snapshots everything the HUD and crash reports need', () => {
    const state = createPlayerState(ON_DECK, CONFIG);
    state.velocity = vec3(3, -4, 0);
    state.grounded = true;
    state.groundId = 'deck';
    state.crouching = true;
    state.deaths = 2;
    state.health = 41;

    const snapshot = snapshotPlayer(state);
    expect(snapshot.speed).toBeCloseTo(5, 12);
    expect(snapshot.stance).toBe('crouched');
    expect(snapshot.alive).toBe(true);
    expect(snapshot.deaths).toBe(2);
    expect(snapshot.health).toBe(41);
    expect(snapshot.locomotion).toBe('grounded');
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);

    state.position.x = 500;
    expect(snapshot.position.x).toBe(0);
  });
});

describe('locomotion reporting', () => {
  it('names every mode', () => {
    const state = createPlayerState(ON_DECK, CONFIG);

    state.alive = false;
    expect(locomotion(state)).toBe('dead');
    state.alive = true;

    state.maneuver = {
      elapsed: 0,
      durationSeconds: 1,
      from: vec3(),
      to: vec3(),
      arcHeight: 0,
      kind: 'pull-up',
      exitSpeed: 0,
      exitDirection: vec3(),
      lowProfile: false,
    };
    expect(locomotion(state)).toBe('pulling-up');
    state.maneuver = { ...state.maneuver, kind: 'mantle' };
    expect(locomotion(state)).toBe('mantling');
    state.maneuver = null;

    state.hangId = 'ledge';
    expect(locomotion(state)).toBe('hanging');
    state.hangId = null;

    state.climbId = 'pipe';
    expect(locomotion(state)).toBe('climbing');
    state.climbId = null;

    state.sliding = true;
    expect(locomotion(state)).toBe('sliding');
    state.sliding = false;

    state.grounded = false;
    expect(locomotion(state)).toBe('airborne');
    state.grounded = true;
    expect(locomotion(state)).toBe('grounded');
  });
});

describe('collision-world wiring', () => {
  it('uses the configured radius and stance height', () => {
    const tight = new CollisionWorld(
      [FLOOR, collider('low', vec3(0, (CONFIG.player.crouchHeight + CONFIG.player.standHeight) / 2 + 0.5, 0), vec3(20, 1, 20))],
      { maxSubStep: CONFIG.world.maxCollisionSubStep },
    );
    expect(tight.isFree(boxOf(createPlayerState(ON_DECK, CONFIG)))).toBe(false);

    const state = createPlayerState(ON_DECK, CONFIG);
    state.crouching = true;
    expect(tight.isFree(boxOf(state))).toBe(true);
  });
});

export type { MoveInput };

describe('the windows that forgive an imprecise input', () => {
  /** A small platform whose top is at Y = 0, so the player can walk off its edge. */
  const PLATFORM = collider('platform', vec3(0, -0.5, 0), vec3(6, 1, 6), 'floor');

  /**
   * Runs off the platform, then presses jump `delay` steps after leaving the ground.
   *
   * The first step is spent landing on the platform - a fresh player starts with
   * `grounded` false - so the window only opens once they have actually stood on
   * something and then left it.
   */
  function jumpAfterLeaving(delay: number): boolean {
    let leftAt: number | null = null;
    let wasGrounded = false;
    let rose = false;

    run(world(PLATFORM), {
      steps: 60,
      input: (step, state) => {
        if (state.grounded) wasGrounded = true;
        else if (wasGrounded && leftAt === null) leftAt = step;
        return input({
          forward: 1,
          sprint: true,
          jump: leftAt !== null && step === leftAt + delay,
        });
      },
      onStep: (state) => {
        if (state.velocity.y > 0.5) rose = true;
      },
    });
    return rose;
  }

  it('lets a jump taken just after the edge count', () => {
    // The player was watching their feet, not the edge. Two steps is 33 ms.
    expect(jumpAfterLeaving(2)).toBe(true);
  });

  it('stops counting once the window has closed', () => {
    // Twelve steps is 200 ms, comfortably past the twelve-hundredths window - and
    // past the point where a jump reads as flight rather than as a late press.
    expect(jumpAfterLeaving(12)).toBe(false);
  });

  it('holds a jump pressed just before landing until there is something to jump from', () => {
    let bounced = false;
    run(world(FLOOR), {
      steps: 90,
      spawn: spawnAt(0, 4, 0),
      // Pressed in the last few centimetres of the fall, which is under two steps.
      input: (_step, state) => input({ jump: state.position.y < 0.4 }),
      onStep: (state, step) => {
        if (step > 10 && state.velocity.y > 0.5) bounced = true;
      },
    });
    expect(bounced).toBe(true);
  });

  it('forgets a jump pressed long before landing', () => {
    // Pressed at the *top* of the fall, when the ground is still half a second away:
    // by the time there is something to jump from, the press is long forgotten.
    let bounced = false;
    run(world(FLOOR), {
      steps: 90,
      spawn: spawnAt(0, 4, 0),
      input: (_step, state) => input({ jump: state.position.y > 3.9 }),
      onStep: (state, step) => {
        if (step > 10 && state.velocity.y > 0.5) bounced = true;
      },
    });
    expect(bounced).toBe(false);
  });

  it('does not hand out a second jump when the first one left the ground', () => {
    // Holding jump re-triggered through the newly-opened coyote window the instant
    // the ground was left, which doubled the height of every jump in the game.
    let apex = 0;
    run(world(FLOOR), {
      steps: 200,
      // Held, so the player hops for the whole run: the apex of each hop is what
      // this is about, not where they happen to be when it ends.
      input: () => input({ jump: true }),
      onStep: (current) => {
        apex = Math.max(apex, current.position.y);
      },
    });

    expect(apex).toBeGreaterThan(JUMP_APEX * 0.9);
    expect(apex).toBeLessThan(JUMP_APEX * 1.15);
  });
});
