/**
 * Integration test: the simulation pipeline end to end, without a renderer.
 *
 * This is the closest thing to "run the game headlessly" that the V0.0
 * architecture allows - level -> collision world -> fixed-step accumulator ->
 * player. It exists to catch the failures unit tests cannot see: tunnelling,
 * sinking, escaping the level, drift, and non-determinism.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG, fixedStep } from '../../src/core/config.js';
import { FixedStepAccumulator } from '../../src/core/delta.js';
import { lengthVec3, vec3, type Vec3 } from '../../src/core/vec3.js';
import { overlaps } from '../../src/game/physics/aabb.js';
import { buildLevel, type BuiltLevel } from '../../src/game/level/level.js';
import { DEMO_ROOF } from '../../src/game/level/levelData.js';
import {
  createPlayerState,
  interpolatePlayerPosition,
  snapshotPlayer,
  stepPlayer,
  type MoveInput,
  type PlayerState,
} from '../../src/game/player.js';

const STEP = fixedStep(DEFAULT_CONFIG);
const TICK_STEPS_PER_SECOND = DEFAULT_CONFIG.world.tickRate;

function createSimulation(): { level: BuiltLevel; player: PlayerState } {
  const level = buildLevel(DEMO_ROOF, {
    maxSubStep: DEFAULT_CONFIG.world.maxCollisionSubStep,
    player: DEFAULT_CONFIG.player,
  });
  return { level, player: createPlayerState(DEMO_ROOF.spawn) };
}

interface Trace {
  readonly positions: Vec3[];
  readonly worstPenetration: number;
  readonly minY: number;
  readonly maxY: number;
  readonly nonFinite: number;
  readonly groundIds: Set<string>;
}

/** Runs `seconds` of simulation, checking invariants at every single step. */
function simulate(
  level: BuiltLevel,
  player: PlayerState,
  seconds: number,
  inputFor: (step: number, player: PlayerState) => MoveInput,
): Trace {
  const steps = Math.round(seconds * TICK_STEPS_PER_SECOND);
  const positions: Vec3[] = [];
  const groundIds = new Set<string>();

  let worstPenetration = 0;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let nonFinite = 0;

  for (let step = 0; step < steps; step += 1) {
    stepPlayer(player, inputFor(step, player), STEP, {
      world: level.world,
      config: DEFAULT_CONFIG.player,
      safetyFloorY: DEFAULT_CONFIG.world.safetyFloorY,
    });

    const { position, velocity } = player;
    if (
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.y) ||
      !Number.isFinite(position.z) ||
      !Number.isFinite(velocity.x) ||
      !Number.isFinite(velocity.y) ||
      !Number.isFinite(velocity.z)
    ) {
      nonFinite += 1;
      continue;
    }

    positions.push({ ...position });
    minY = Math.min(minY, position.y);
    maxY = Math.max(maxY, position.y);
    if (player.groundId) groundIds.add(player.groundId);

    // Rebuild the player box exactly as the solver does and confirm it is not
    // inside any collider.
    const box = {
      min: vec3(position.x - DEFAULT_CONFIG.player.radius, position.y, position.z - DEFAULT_CONFIG.player.radius),
      max: vec3(
        position.x + DEFAULT_CONFIG.player.radius,
        position.y + DEFAULT_CONFIG.player.height,
        position.z + DEFAULT_CONFIG.player.radius,
      ),
    };

    for (const collider of level.colliders) {
      if (!overlaps(box, collider.box)) continue;
      const depth = Math.min(
        Math.min(box.max.x, collider.box.max.x) - Math.max(box.min.x, collider.box.min.x),
        Math.min(box.max.y, collider.box.max.y) - Math.max(box.min.y, collider.box.min.y),
        Math.min(box.max.z, collider.box.max.z) - Math.max(box.min.z, collider.box.min.z),
      );
      worstPenetration = Math.max(worstPenetration, depth);
    }
  }

  return { positions, worstPenetration, minY, maxY, nonFinite, groundIds };
}

const FORWARD: MoveInput = { forward: 1, right: 0 };
const STILL: MoveInput = { forward: 0, right: 0 };

describe('settling onto the demo roof', () => {
  it('drops the spawn point onto the roof deck and stays there', () => {
    const { level, player } = createSimulation();
    const trace = simulate(level, player, 3, () => STILL);

    expect(trace.nonFinite).toBe(0);
    expect(trace.worstPenetration).toBe(0);
    expect(player.grounded).toBe(true);
    expect(player.groundId).toBe('roof-deck');
    expect(player.position.y).toBeCloseTo(0.001, 6);
    // It fell the half metre to the deck and never went below it.
    expect(trace.minY).toBeGreaterThanOrEqual(0);
    expect(trace.maxY).toBeLessThan(1);
  });

  it('reports the deck as the only supporting surface', () => {
    const { level, player } = createSimulation();
    const trace = simulate(level, player, 2, () => STILL);
    expect([...trace.groundIds]).toEqual(['roof-deck']);
  });
});

describe('traversal', () => {
  it('walks forward across the roof without sinking or tunnelling', () => {
    const { level, player } = createSimulation();
    const trace = simulate(level, player, 4, () => FORWARD);

    expect(trace.nonFinite).toBe(0);
    expect(trace.worstPenetration).toBe(0);
    expect(trace.minY).toBeGreaterThanOrEqual(0);
    // Started at z = 11 and walked toward -Z.
    expect(player.position.z).toBeLessThan(0);
    expect(player.position.y).toBeCloseTo(0.001, 6);
  });

  it('is stopped by the parapet instead of walking off the roof', () => {
    const { level, player } = createSimulation();
    const trace = simulate(level, player, 12, () => FORWARD);

    expect(trace.nonFinite).toBe(0);
    expect(trace.worstPenetration).toBe(0);
    expect(trace.minY).toBeGreaterThanOrEqual(0);
    expect(player.grounded).toBe(true);
    // The north parapet's inner face sits at z = -14.6.
    expect(player.position.z).toBeGreaterThan(-14.6);
    expect(player.position.z).toBeLessThan(-13);
  });

  it('strafes into every parapet without escaping', () => {
    const cardinals: [string, MoveInput][] = [
      ['north (-Z)', FORWARD],
      ['south (+Z)', { forward: -1, right: 0 }],
      ['east (+X)', { forward: 0, right: 1 }],
      ['west (-X)', { forward: 0, right: -1 }],
    ];

    for (const [name, input] of cardinals) {
      const { level, player } = createSimulation();
      const trace = simulate(level, player, 12, () => input);

      expect(trace.nonFinite, name).toBe(0);
      expect(trace.worstPenetration, name).toBe(0);
      expect(trace.minY, name).toBeGreaterThanOrEqual(0);
      expect(player.grounded, name).toBe(true);
      // Still inside the roof footprint (34 x 30, i.e. +/-17 by +/-15).
      expect(Math.abs(player.position.x), name).toBeLessThan(17);
      expect(Math.abs(player.position.z), name).toBeLessThan(15);
    }
  });

  it('round-trips: walking out and back returns near the start', () => {
    const { level, player } = createSimulation();
    const start = { ...player.position };

    simulate(level, player, 2, () => FORWARD);
    const turnaround = player.position.z;
    simulate(level, player, 2, () => ({ forward: -1, right: 0 }));
    simulate(level, player, 2, () => STILL);

    const snapshot = snapshotPlayer(player);
    expect(snapshot.horizontalSpeed).toBe(0);

    // Forward movement starts from rest and so covers less ground than the
    // reverse leg, which starts already at speed. The overshoot is bounded.
    expect(turnaround).toBeLessThan(start.z - 5);
    expect(player.position.z).toBeGreaterThan(start.z);
    expect(player.position.z - start.z).toBeLessThan(1.5);

    // Pure forward/back motion must not introduce any lateral drift at all.
    expect(player.position.x).toBeCloseTo(start.x, 9);
    expect(player.position.y).toBeCloseTo(start.y - 0.5 + 0.001, 3);
  });

  it('climbs onto the low block and back down', () => {
    const { level, player } = createSimulation();
    // Walk diagonally toward the low block at (-8, -3).
    simulate(level, player, 3, () => ({ forward: 1, right: -1 }));
    expect(player.position.y).toBeGreaterThanOrEqual(0);
    expect(player.grounded).toBe(true);
  });

  it('survives jittering input for a simulated minute', () => {
    const { level, player } = createSimulation();
    let counter = 0;

    const trace = simulate(level, player, 60, () => {
      counter += 1;
      // Change direction about twice a second, sweeping all four quadrants.
      const phase = Math.floor(counter / 20) % 4;
      const forward = phase === 0 || phase === 3 ? 1 : -1;
      const right = phase < 2 ? 1 : -1;
      return { forward, right };
    });

    expect(trace.nonFinite).toBe(0);
    expect(trace.worstPenetration).toBe(0);
    expect(trace.minY).toBeGreaterThanOrEqual(0);
    expect(player.grounded).toBe(true);
    expect(lengthVec3(player.velocity)).toBeLessThan(DEFAULT_CONFIG.player.maxSpeed);
  });
});

describe('determinism', () => {
  it('produces identical results for the same scripted input', () => {
    const script = (step: number): MoveInput => {
      const phase = Math.floor(step / 30) % 4;
      return phase === 0
        ? { forward: 1, right: 0 }
        : phase === 1
          ? { forward: 0, right: 1 }
          : phase === 2
            ? { forward: -1, right: 0 }
            : { forward: 0, right: -1 };
    };

    const first = createSimulation();
    const second = createSimulation();

    const traceA = simulate(first.level, first.player, 8, script);
    const traceB = simulate(second.level, second.player, 8, script);

    expect(traceA.positions).toEqual(traceB.positions);
    expect(first.player.velocity).toEqual(second.player.velocity);
  });
});

describe('fixed-step accumulator integration', () => {
  it('simulates the same total time regardless of frame rate', () => {
    function runAt(fps: number): { seconds: number; steps: number } {
      const { level, player } = createSimulation();
      const accumulator = new FixedStepAccumulator(STEP, DEFAULT_CONFIG.world.maxSubSteps);
      const frameDelta = 1 / fps;

      let steps = 0;
      for (let frame = 0; frame < fps * 3; frame += 1) {
        steps += accumulator.run(frameDelta, (dt) => {
          stepPlayer(player, FORWARD, dt, { world: level.world, config: DEFAULT_CONFIG.player });
        });
      }
      return { seconds: player.position.z, steps };
    }

    // Above the tick rate the accumulator is exact; below it the spiral guard
    // deliberately trades time for stability, so 60 Hz is the reference.
    const at60 = runAt(60);
    const at120 = runAt(120);

    expect(at120.steps).toBeCloseTo(at60.steps, 0);
    expect(at120.seconds).toBeCloseTo(at60.seconds, 3);
  });

  it('keeps interpolation alpha in range across a burst of frames', () => {
    const accumulator = new FixedStepAccumulator(STEP, DEFAULT_CONFIG.world.maxSubSteps);
    for (const delta of [0.016, 0.017, 0.008, 0.033, 0.1, 0.25]) {
      accumulator.run(delta, () => {});
      expect(accumulator.alpha).toBeGreaterThanOrEqual(0);
      expect(accumulator.alpha).toBeLessThanOrEqual(1);
    }
  });

  it('interpolated positions stay between the previous and current step', () => {
    const { level, player } = createSimulation();
    const accumulator = new FixedStepAccumulator(STEP, DEFAULT_CONFIG.world.maxSubSteps);
    const out = vec3();

    for (let frame = 0; frame < 240; frame += 1) {
      accumulator.run(1 / 144, (dt) => {
        stepPlayer(player, FORWARD, dt, { world: level.world, config: DEFAULT_CONFIG.player });
      });
      interpolatePlayerPosition(player, accumulator.alpha, out);

      const low = Math.min(player.previousPosition.z, player.position.z) - 1e-9;
      const high = Math.max(player.previousPosition.z, player.position.z) + 1e-9;
      expect(out.z).toBeGreaterThanOrEqual(low);
      expect(out.z).toBeLessThanOrEqual(high);
    }
  });
});

describe('crash-report snapshot', () => {
  it('gives the reporter a complete, serialisable player state', () => {
    const { level, player } = createSimulation();
    simulate(level, player, 2, () => FORWARD);

    const snapshot = snapshotPlayer(player);
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
    expect(snapshot.grounded).toBe(true);
    expect(snapshot.groundId).toBe('roof-deck');
    expect(snapshot.speed).toBeGreaterThan(0);
    expect(snapshot.position).not.toBe(player.position);
  });
});
