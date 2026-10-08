/**
 * Pipe climbing.
 *
 * A pipe is V0.4's two-way climbable: forward works the player up it, back or
 * crouch slides them down - fast - and jump kicks off it. These run against a
 * bare floor and one pipe, so every assertion is about the move rather than
 * about the district; the integration suite checks the pipe that ships.
 */

import { describe, expect, it } from 'vitest';

import { vec3 } from '../../src/core/vec3.js';
import { createPlayerState, locomotion, stepPlayer } from '../../src/game/player.js';
import {
  CONFIG,
  FACING_EAST,
  FLOOR,
  FORWARD,
  STEP,
  collider,
  input,
  optionsFor,
  run,
  spawnAt,
  world,
} from '../helpers/player.js';

/** A pipe standing on the floor at x = 2, tall enough to climb. */
const PIPE = collider('pipe', vec3(2, 3, 0), vec3(0.4, 6, 0.4), 'pipe');
const PIPE_IDS = new Set(['pipe']);

/** On the deck, a couple of metres west of the pipe, facing it. */
const ON_DECK = spawnAt(0, 0.001, 0, FACING_EAST);

/** Runs until the player has hold of the pipe, and returns the state. */
function onPipe(collisionWorld = world(FLOOR, PIPE)) {
  return run(collisionWorld, {
    steps: 40,
    input: FORWARD,
    spawn: ON_DECK,
    pipeIds: PIPE_IDS,
  });
}

describe('grabbing a pipe', () => {
  it('latches on when the player runs into one', () => {
    const state = onPipe();
    expect(state.pipeId).toBe('pipe');
    expect(locomotion(state)).toBe('piping');
  });

  it('ignores a stub too short to be worth grabbing', () => {
    const stub = collider('pipe', vec3(2, 0.4, 0), vec3(0.4, 0.8, 0.4), 'pipe');
    const state = run(world(FLOOR, stub), {
      steps: 60,
      input: FORWARD,
      spawn: ON_DECK,
      pipeIds: new Set(['pipe']),
    });
    expect(state.pipeId).toBeNull();
  });

  it('ignores a pipe the player has not been told about', () => {
    const state = run(world(FLOOR, PIPE), { steps: 60, input: FORWARD, spawn: ON_DECK });
    expect(state.pipeId).toBeNull();
  });
});

describe('climbing a pipe', () => {
  it('goes up while the player holds forward', () => {
    const state = onPipe();
    const startY = state.position.y;
    const options = optionsFor(world(FLOOR, PIPE), { pipeIds: PIPE_IDS });

    for (let step = 0; step < 30; step += 1) stepPlayer(state, FORWARD, STEP, options);

    expect(state.pipeId).toBe('pipe');
    expect(state.position.y).toBeGreaterThan(startY + 1);
    // A climb is a controlled ascent, not a fall.
    expect(state.peakFallSpeed).toBe(0);
  });

  it('holds position when the player is not pushing either way', () => {
    const state = onPipe();
    const options = optionsFor(world(FLOOR, PIPE), { pipeIds: PIPE_IDS });
    for (let step = 0; step < 10; step += 1) stepPlayer(state, FORWARD, STEP, options);

    const held = state.position.y;
    for (let step = 0; step < 30; step += 1) stepPlayer(state, input(), STEP, options);

    expect(state.position.y).toBeCloseTo(held, 6);
  });

  it('slides down much faster than it climbs', () => {
    const state = onPipe();
    const options = optionsFor(world(FLOOR, PIPE), { pipeIds: PIPE_IDS });

    const beforeClimb = state.position.y;
    for (let step = 0; step < 10; step += 1) stepPlayer(state, FORWARD, STEP, options);
    const climbed = state.position.y - beforeClimb;

    const beforeSlide = state.position.y;
    for (let step = 0; step < 10; step += 1) stepPlayer(state, input({ crouch: true }), STEP, options);
    const slid = beforeSlide - state.position.y;

    expect(climbed).toBeGreaterThan(0);
    expect(slid).toBeGreaterThan(climbed * 2);
  });

  it('tops out by mantling onto whatever the pipe reaches', () => {
    const collisionWorld = world(FLOOR, PIPE);
    const state = createPlayerState(ON_DECK, CONFIG);
    const options = optionsFor(collisionWorld, { pipeIds: PIPE_IDS });
    const started = new Set<string>();
    let maxY = 0;

    for (let step = 0; step < 400; step += 1) {
      const outcome = stepPlayer(state, FORWARD, STEP, options);
      if (outcome.started) started.add(outcome.started);
      maxY = Math.max(maxY, state.position.y);
    }

    expect(started.has('pipe-grab')).toBe(true);
    // The head of the pipe hands over to a mantle, so a pipe is a route up and
    // not just a place to hang.
    expect(started.has('mantle')).toBe(true);
    expect(maxY).toBeGreaterThan(5.5);
  });
});

describe('leaving a pipe', () => {
  it('kicks off when the player jumps', () => {
    const state = onPipe();
    const options = optionsFor(world(FLOOR, PIPE), { pipeIds: PIPE_IDS });

    const outcome = stepPlayer(state, input({ jump: true }), STEP, options);

    expect(outcome.ended).toBe('climb');
    expect(state.pipeId).toBeNull();
    // The pipe is to the east, so the kick is west - away from it...
    expect(state.velocity.x).toBeLessThan(0);
    // ...and upward, so leaving keeps the height the climb gained.
    expect(state.velocity.y).toBeGreaterThan(0);
    // ...and the pipe is refused briefly, so the jump is not undone next step.
    expect(state.pipeCooldown).toBeGreaterThan(0);
  });

  it('lets go when it slides down onto the floor', () => {
    const state = onPipe();
    const options = optionsFor(world(FLOOR, PIPE), { pipeIds: PIPE_IDS });
    let ended = false;

    for (let step = 0; step < 200 && !ended; step += 1) {
      const outcome = stepPlayer(state, input({ crouch: true }), STEP, options);
      if (outcome.ended === 'climb') ended = true;
    }

    expect(ended).toBe(true);
    expect(state.pipeId).toBeNull();
    expect(state.grounded).toBe(true);
    expect(state.position.y).toBeLessThan(0.1);
  });

  it('cannot be re-grabbed during the release cooldown', () => {
    const state = onPipe();
    const options = optionsFor(world(FLOOR, PIPE), { pipeIds: PIPE_IDS });

    stepPlayer(state, input({ jump: true }), STEP, options);
    expect(state.pipeCooldown).toBeCloseTo(CONFIG.maneuver.pipe.releaseCooldownSeconds, 6);

    // Push straight back into it, and it is still refused.
    stepPlayer(state, FORWARD, STEP, options);
    expect(state.pipeId).toBeNull();
  });
});
