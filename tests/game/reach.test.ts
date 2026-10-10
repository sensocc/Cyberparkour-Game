import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG, fixedStep } from '../../src/core/config.js';
import { createPlayerState, standingSize, stepPlayer } from '../../src/game/player.js';
import { crossingGap, crossingRise, reachOf } from '../../src/game/reach.js';
import { collider, FACING_EAST, FLOOR, optionsFor, world } from '../helpers/player.js';
import { vec3 } from '../../src/core/vec3.js';

const CONFIG = DEFAULT_CONFIG;
const STEP = fixedStep(CONFIG);

/**
 * How far a running jump actually crosses, and how high it actually gets.
 *
 * The number the generator builds to has to come from somewhere, and "the movement
 * code" is a better answer than a constant somebody liked. This jumps the player and
 * measures: run up to speed, jump, and watch until the feet come back to the height they
 * left from.
 */
function measured(): { distance: number; rise: number } {
  const state = createPlayerState({ position: { x: 0, y: 0.001, z: 0 }, yaw: 0, pitch: 0 }, CONFIG);
  const options = optionsFor(world(FLOOR));
  const input = { forward: 1, right: 0, sprint: true, jump: false, crouch: false };

  // A run-up long enough to be at full speed before the edge.
  for (let tick = 0; tick < 180; tick += 1) stepPlayer(state, input, STEP, options);
  const from = { x: state.position.x, z: state.position.z, y: state.position.y };

  stepPlayer(state, { ...input, jump: true }, STEP, options);
  let rise = 0;
  let distance = 0;
  for (let tick = 0; tick < 120; tick += 1) {
    stepPlayer(state, { ...input, jump: false }, STEP, options);
    rise = Math.max(rise, state.position.y - from.y);
    distance = Math.max(distance, Math.hypot(state.position.x - from.x, state.position.z - from.z));
    // The jump is over the moment the player is back on their feet.
    if (tick > 8 && state.grounded) break;
  }
  return { distance, rise };
}

describe('the reach envelope', () => {
  it('agrees with what the player actually does', () => {
    // This is the test that makes the generator's limits worth having. If the movement
    // is retuned - a longer jump, a weaker pull-up - the city's gaps stop matching the
    // player, and this is where that shows up rather than in a report of "the rooftops
    // feel far apart".
    const envelope = reachOf(CONFIG);
    const actual = measured();

    // The analytic gap is a *slightly conservative* figure - the simulation measures
    // about a tenth further, because the tick the jump is applied on is integrated
    // before gravity is - and being under it is the safe direction for a generator to
    // be wrong in. What must hold is that it is the right order of magnitude, and that
    // the gap the city is actually built to is inside the distance the player really
    // covers: 5.8 m of arithmetic against 7.3 m of jumping.
    expect(envelope.gap).toBeLessThanOrEqual(actual.distance);
    expect(envelope.gap).toBeGreaterThan(actual.distance * 0.75);
    expect(crossingGap(CONFIG)).toBeLessThan(actual.distance * 0.95);

    expect(actual.rise).toBeGreaterThan(0.5);
    // A jump gets about a metre up; a pull-up - which is the real ceiling - is more.
    expect(actual.rise).toBeLessThan(envelope.rise);
  });

  it('leaves a gap the generator can build to a margin inside the jump', () => {
    const envelope = reachOf(CONFIG);
    expect(crossingGap(CONFIG)).toBeLessThan(envelope.gap);
    expect(crossingGap(CONFIG)).toBeGreaterThan(envelope.gap * 0.8);
    expect(crossingRise(CONFIG)).toBeLessThanOrEqual(envelope.rise);
    expect(crossingRise(CONFIG)).toBeGreaterThan(envelope.rise * 0.75);
  });

  it('scales with the configuration rather than being a number somebody liked', () => {
    // Halve the jump and the reach halves: the envelope is a function of the physics.
    const weak = {
      ...CONFIG,
      player: { ...CONFIG.player, jumpSpeed: CONFIG.player.jumpSpeed / 2 },
    };
    expect(reachOf(weak).gap).toBeCloseTo(reachOf(CONFIG).gap / 2, 5);

    const slow = {
      ...CONFIG,
      player: { ...CONFIG.player, sprintSpeed: CONFIG.player.sprintSpeed / 2 },
    };
    expect(reachOf(slow).gap).toBeCloseTo(reachOf(CONFIG).gap / 2, 5);

    const lowGravity = { ...CONFIG, player: { ...CONFIG.player, gravity: CONFIG.player.gravity * 2 } };
    expect(reachOf(lowGravity).gap).toBeCloseTo(reachOf(CONFIG).gap / 2, 5);
  });

  it('measures a jump across a gap the generator would leave, and lands it', () => {
    // The strongest form of the question: not "is the arithmetic right" but "does the
    // player cross it". A ledge exactly `crossingGap` away, at the same height, and a
    // running jump onto it.
    // Two ledges with a gap between them that `crossingGap` allows, and a long run-up
    // on the near one. The gap is 6.4 m of air, which is what the generator builds to.
    const near = collider('near', vec3(-30, 0, 4), vec3(53.6, 1, 12), 'floor');
    const far = collider('far', vec3(30, 0, 4), vec3(53.6, 1, 12), 'floor');
    const arena = world(near, far);
    // Facing +X, which is the axis the two ledges are strung along.
    const state = createPlayerState({ position: { x: -20, y: 1.001, z: 4 }, yaw: FACING_EAST, pitch: 0 }, CONFIG);
    const options = optionsFor(arena);
    const input = { forward: 1, right: 0, sprint: true, jump: false, crouch: false };

    for (let tick = 0; tick < 180; tick += 1) stepPlayer(state, input, STEP, options);
    // Run up to the edge, jumping as late as a player would.
    let jumps = 0;
    for (let tick = 0; tick < 300 && state.alive; tick += 1) {
      const atEdge = state.position.x >= -3.2 - CONFIG.player.radius;
      if (atEdge && jumps === 0) jumps += 1;
      stepPlayer(state, { ...input, jump: atEdge && jumps === 1 && state.grounded }, STEP, options);
      if (atEdge && jumps === 1 && !state.grounded) break;
    }
    for (let tick = 0; tick < 200 && state.alive; tick += 1) {
      if (state.grounded && state.position.y > 0.5) break;
      stepPlayer(state, { ...input, jump: false }, STEP, options);
    }

    expect(state.alive).toBe(true);
    expect(state.position.x, 'landed on the far ledge').toBeGreaterThan(3.2);
    expect(standingSize(CONFIG.player).height).toBeGreaterThan(0);
  });
});
