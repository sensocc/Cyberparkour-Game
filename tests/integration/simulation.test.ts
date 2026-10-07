/**
 * Integration test: the simulation pipeline end to end, without a renderer.
 *
 * This is the closest thing to "run the game headlessly" that the architecture
 * allows - level -> collision world -> fixed-step accumulator -> player. It
 * exists to catch the failures unit tests cannot see: tunnelling, sinking,
 * escaping the level, drift, and non-determinism.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG, fixedStep } from '../../src/core/config.js';
import { FixedStepAccumulator } from '../../src/core/delta.js';
import { lengthVec3, vec3, type Vec3 } from '../../src/core/vec3.js';
import { aabbFromCenterSize, overlaps } from '../../src/game/physics/aabb.js';
import { buildLevel, groundHeightAt, type BuiltLevel } from '../../src/game/level/level.js';
import { DEMO_ROOF } from '../../src/game/level/levelData.js';
import {
  createPlayerState,
  eyeHeight,
  interpolatePlayerPosition,
  playerHeight,
  snapshotPlayer,
  standingSize,
  stepPlayer,
  type MoveInput,
  type PlayerState,
} from '../../src/game/player.js';

const STEP = fixedStep(DEFAULT_CONFIG);
const TICKS_PER_SECOND = DEFAULT_CONFIG.world.tickRate;
const RESPAWN_DELAY = DEFAULT_CONFIG.respawn.delaySeconds;

function createSimulation(): { level: BuiltLevel; player: PlayerState } {
  const level = buildLevel(DEMO_ROOF, {
    maxSubStep: DEFAULT_CONFIG.world.maxCollisionSubStep,
    player: standingSize(DEFAULT_CONFIG.player),
  });
  return { level, player: createPlayerState(DEMO_ROOF.spawn) };
}

/** Options matching what `Game` passes to every step. */
function stepOptions(level: BuiltLevel) {
  return {
    world: level.world,
    config: DEFAULT_CONFIG.player,
    killPlaneY: DEMO_ROOF.killPlaneY,
    respawnDelaySeconds: RESPAWN_DELAY,
    safetyFloorY: DEFAULT_CONFIG.world.safetyFloorY,
  };
}

interface Trace {
  readonly positions: Vec3[];
  readonly worstPenetration: number;
  readonly minY: number;
  readonly maxY: number;
  readonly nonFinite: number;
  readonly groundIds: Set<string>;
  readonly deaths: number;
  readonly maxHeightAboveDeck: number;
}

/** Runs `seconds` of simulation, checking invariants at every single step. */
function simulate(
  level: BuiltLevel,
  player: PlayerState,
  seconds: number,
  inputFor: (step: number, player: PlayerState) => MoveInput,
): Trace {
  const steps = Math.round(seconds * TICKS_PER_SECOND);
  const positions: Vec3[] = [];
  const groundIds = new Set<string>();

  let worstPenetration = 0;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let nonFinite = 0;
  let deaths = 0;
  let maxHeightAboveDeck = 0;

  for (let step = 0; step < steps; step += 1) {
    const outcome = stepPlayer(player, inputFor(step, player), STEP, stepOptions(level));
    if (outcome.died) deaths += 1;

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

    // Only meaningful while alive and above the kill plane.
    if (player.alive) maxHeightAboveDeck = Math.max(maxHeightAboveDeck, position.y);

    // Rebuild the player box exactly as the solver does and confirm it is not
    // inside any collider.
    const height = playerHeight(player, DEFAULT_CONFIG.player);
    const box = aabbFromCenterSize(
      { x: position.x, y: position.y + height / 2, z: position.z },
      { x: DEFAULT_CONFIG.player.radius * 2, y: height, z: DEFAULT_CONFIG.player.radius * 2 },
    );

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

  return {
    positions,
    worstPenetration,
    minY,
    maxY,
    nonFinite,
    groundIds,
    deaths,
    maxHeightAboveDeck,
  };
}

const FORWARD: MoveInput = { forward: 1, right: 0, sprint: false, jump: false, crouch: false };
const SPRINT_FORWARD: MoveInput = { forward: 1, right: 0, sprint: true, jump: false, crouch: false };
const CROUCH_FORWARD: MoveInput = { forward: 1, right: 0, sprint: false, jump: false, crouch: true };
const STILL: MoveInput = { forward: 0, right: 0, sprint: false, jump: false, crouch: false };
const RIGHT: MoveInput = { ...STILL, right: 1 };
const LEFT: MoveInput = { ...STILL, right: -1 };
const BACK: MoveInput = { ...STILL, forward: -1 };
const SPRINT_BACK: MoveInput = { ...SPRINT_FORWARD, forward: -1 };
const SPRINT_RIGHT: MoveInput = { ...SPRINT_FORWARD, forward: 0, right: 1 };
const SPRINT_LEFT: MoveInput = { ...SPRINT_FORWARD, forward: 0, right: -1 };

/** Places a player at a known spot on the deck, at rest. */
function placeAt(player: PlayerState, x: number, z: number): void {
  player.position = vec3(x, 0.001, z);
  player.previousPosition = vec3(x, 0.001, z);
  player.velocity = vec3(0, 0, 0);
}

describe('settling onto the demo roof', () => {
  it('drops the spawn point onto the deck and stays there', () => {
    const { level, player } = createSimulation();
    const trace = simulate(level, player, 3, () => STILL);

    expect(trace.nonFinite).toBe(0);
    expect(trace.worstPenetration).toBe(0);
    expect(player.grounded).toBe(true);
    expect(player.groundId).toBe('deck');
    expect(player.position.y).toBeCloseTo(0.001, 6);
    expect(trace.minY).toBeGreaterThanOrEqual(0);
    expect(trace.maxY).toBeLessThan(1);
    expect(player.alive).toBe(true);
    expect(player.deaths).toBe(0);
  });

  it('reports the deck as the only supporting surface', () => {
    const { level, player } = createSimulation();
    const trace = simulate(level, player, 2, () => STILL);
    expect([...trace.groundIds]).toEqual(['deck']);
  });
});

describe('traversal', () => {
  it('walks forward across the roof without sinking or tunnelling', () => {
    const { level, player } = createSimulation();
    const trace = simulate(level, player, 1.5, () => FORWARD);

    expect(trace.nonFinite).toBe(0);
    expect(trace.worstPenetration).toBe(0);
    expect(trace.minY).toBeGreaterThanOrEqual(0);
    expect(player.position.z).toBeLessThan(DEMO_ROOF.spawn.position.z - 5);
    expect(player.position.y).toBeCloseTo(0.001, 6);
  });

  it('sprints further than it walks in the same time', () => {
    const walk = createSimulation();
    const sprint = createSimulation();

    simulate(walk.level, walk.player, 2, () => FORWARD);
    simulate(sprint.level, sprint.player, 2, () => SPRINT_FORWARD);

    const walked = Math.abs(walk.player.position.z - DEMO_ROOF.spawn.position.z);
    const sprinted = Math.abs(sprint.player.position.z - DEMO_ROOF.spawn.position.z);
    expect(sprinted).toBeGreaterThan(walked * 1.2);
  });

  it('moves in every direction without sinking through the deck', () => {
    const inputs: [string, MoveInput][] = [
      ['north (-Z)', FORWARD],
      ['south (+Z)', BACK],
      ['east (+X)', RIGHT],
      ['west (-X)', LEFT],
    ];

    for (const [name, input] of inputs) {
      const { level, player } = createSimulation();
      // One second of walking covers ~5 m, which stays on the deck from the
      // spawn in every direction.
      const trace = simulate(level, player, 1, () => input);

      expect(trace.nonFinite, name).toBe(0);
      expect(trace.worstPenetration, name).toBe(0);
      expect(trace.minY, name).toBeGreaterThanOrEqual(0);
      expect(trace.deaths, name).toBe(0);
      expect(player.grounded, name).toBe(true);
      expect(player.position.y, name).toBeCloseTo(0.001, 6);
    }

    // ...and each direction actually went somewhere.
    const { level, player } = createSimulation();
    const start = { ...player.position };
    simulate(level, player, 1, () => RIGHT);
    expect(player.position.x).toBeGreaterThan(start.x + 3);
  });

  it('survives jittering input for a simulated minute', () => {
    const { level, player } = createSimulation();
    let counter = 0;

    const trace = simulate(level, player, 60, () => {
      counter += 1;
      const phase = Math.floor(counter / 20) % 4;
      return {
        forward: phase === 0 || phase === 3 ? 1 : -1,
        right: phase < 2 ? 1 : -1,
        sprint: phase % 2 === 0,
        jump: counter % 97 === 0,
        crouch: phase === 2 && counter % 40 < 15,
      };
    });

    expect(trace.nonFinite).toBe(0);
    expect(trace.worstPenetration).toBe(0);
    expect(lengthVec3(player.velocity)).toBeLessThan(DEFAULT_CONFIG.player.maxSpeed);
    // Jittering on an open roof means eventually walking off it - and surviving
    // the fall by respawning.
    expect(trace.deaths).toBeGreaterThan(0);
    expect(player.position.y).toBeGreaterThan(DEMO_ROOF.killPlaneY);
  });
});

describe('sprint', () => {
  it('reaches the sprint speed on the real roof', () => {
    const { level, player } = createSimulation();
    // 1.4 s of northward running stays on the deck (the spawn is 33 m from the
    // north edge and the lane is clear).
    simulate(level, player, 1.4, () => SPRINT_FORWARD);

    const snapshot = snapshotPlayer(player);
    expect(player.alive).toBe(true);
    expect(player.grounded).toBe(true);
    expect(snapshot.horizontalSpeed).toBeCloseTo(DEFAULT_CONFIG.player.sprintSpeed, 4);
    expect(snapshot.speed).toBeGreaterThan(DEFAULT_CONFIG.player.walkSpeed);
  });
});

describe('jump', () => {
  it('gets airborne and lands again on the roof', () => {
    const { level, player } = createSimulation();
    let leftGround = false;

    const trace = simulate(level, player, 4, (step) => {
      if (!player.alive) return STILL;
      if (step % 90 === 0 && player.grounded) return { ...STILL, jump: true };
      if (step < 60) return FORWARD;
      return STILL;
    });

    expect(trace.nonFinite).toBe(0);
    expect(trace.worstPenetration).toBe(0);
    expect(trace.maxY).toBeGreaterThan(0.5);
    leftGround = trace.maxY > 0.5;
    expect(leftGround).toBe(true);
    expect(player.grounded).toBe(true);
  });
});

describe('crouch', () => {
  /**
   * The duct spans x = 17.4 to 18.6 at z = 0, with its underside at 1.4 m.
   * Everything here approaches it head-on along +X.
   */
  const DUCT_NEAR_FACE = 17.4;
  const DUCT_FAR_FACE = 18.6;

  it('passes under the duct while crouched', () => {
    const { level, player } = createSimulation();
    placeAt(player, 15, 0);

    simulate(level, player, 1.4, () => ({ ...CROUCH_FORWARD, forward: 0, right: 1 }));

    expect(player.crouching).toBe(true);
    expect(player.position.x).toBeGreaterThan(DUCT_FAR_FACE);
    expect(player.alive).toBe(true);
  });

  it('is blocked by the duct while standing', () => {
    const { level, player } = createSimulation();
    placeAt(player, 15, 0);

    simulate(level, player, 1.4, () => RIGHT);

    // The duct occupies the space its head would need.
    expect(player.crouching).toBe(false);
    expect(player.position.x).toBeLessThan(DUCT_NEAR_FACE);
    // Stopped just short of the duct's near face.
    expect(player.position.x).toBeGreaterThan(DUCT_NEAR_FACE - 1);
  });

  it('keeps the camera at crouch height while crawling', () => {
    const { level, player } = createSimulation();
    placeAt(player, 15, 0);

    simulate(level, player, 1.4, () => ({ ...CROUCH_FORWARD, forward: 0, right: 1 }));

    expect(player.crouching).toBe(true);
    expect(eyeHeight(player, DEFAULT_CONFIG.player)).toBe(DEFAULT_CONFIG.player.crouchEyeHeight);
    // Feet stay on the deck: only the top of the box drops.
    expect(player.position.y).toBeCloseTo(0.001, 6);
  });

  it('stands back up once clear of the duct', () => {
    const { level, player } = createSimulation();
    placeAt(player, 15, 0);

    // Crawl past the duct, then let go of crouch.
    simulate(level, player, 1.4, () => ({ ...CROUCH_FORWARD, forward: 0, right: 1 }));
    expect(player.crouching).toBe(true);
    expect(player.position.x).toBeGreaterThan(DUCT_FAR_FACE);

    const cleared = player.position.x;
    simulate(level, player, 0.5, () => STILL);

    expect(player.position.x).toBeGreaterThan(cleared - 0.5);
    expect(player.crouching).toBe(false);
    expect(player.alive).toBe(true);
  });
});

describe('fall detection and respawn', () => {
  it('dies when it runs off the edge, and comes back', () => {
    const { level, player } = createSimulation();
    // The spawn's south side is the short, clear route to an open edge.
    placeAt(player, 0, 15);

    let diedAt = -1;
    let respawnedAt = -1;
    let steps = 0;

    for (; steps < 1200; steps += 1) {
      const outcome = stepPlayer(player, SPRINT_BACK, STEP, stepOptions(level));
      if (outcome.died && diedAt === -1) diedAt = steps;
      if (outcome.respawned && respawnedAt === -1) {
        respawnedAt = steps;
        break;
      }
    }

    expect(diedAt).toBeGreaterThan(0);
    expect(respawnedAt).toBeGreaterThan(diedAt);
    expect(player.alive).toBe(true);
    expect(player.deaths).toBe(1);

    // Respawned at the spawn point, standing still.
    expect(player.position.x).toBeCloseTo(DEMO_ROOF.spawn.position.x, 6);
    expect(player.position.z).toBeCloseTo(DEMO_ROOF.spawn.position.z, 6);
    expect(player.velocity).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('kills a fall from every edge of the deck', () => {
    // The deck spans x in [-24, 24] and z in [-20, 20]. Each start point is a
    // couple of metres inside an edge, on a clear lane.
    const directions: [string, { x: number; z: number }, MoveInput][] = [
      ['north (-Z)', { x: 0, z: -18 }, SPRINT_FORWARD],
      ['south (+Z)', { x: 0, z: 18 }, SPRINT_BACK],
      ['east (+X)', { x: 22, z: 0 }, SPRINT_RIGHT],
      ['west (-X)', { x: -22, z: 14 }, SPRINT_LEFT],
    ];

    for (const [name, start, input] of directions) {
      const { level, player } = createSimulation();
      placeAt(player, start.x, start.z);

      // Confirm the start point is genuinely on the deck before relying on it.
      expect(groundHeightAt(DEMO_ROOF, start), `${name} start is on the deck`).toBeCloseTo(0, 9);

      let died = false;
      for (let step = 0; step < 600 && !died; step += 1) {
        // No respawn, so the death is unambiguous.
        const outcome = stepPlayer(player, input, STEP, {
          ...stepOptions(level),
          respawnDelaySeconds: Number.POSITIVE_INFINITY,
        });
        if (outcome.died) died = true;
      }

      expect(died, `${name} should be fatal`).toBe(true);
      expect(player.alive, name).toBe(false);
      expect(player.velocity.x, name).toBe(0);
      expect(player.velocity.z, name).toBe(0);
      expect(player.position.y, name).toBeLessThanOrEqual(DEMO_ROOF.killPlaneY);
    }
  });

  it('never lets a falling player pass the world safety floor', () => {
    const { level, player } = createSimulation();
    // No input, no kill plane, no respawn: an endless fall that the emergency
    // floor must still contain.
    for (let step = 0; step < 3000; step += 1) {
      stepPlayer(player, STILL, STEP, {
        world: level.world,
        config: DEFAULT_CONFIG.player,
        safetyFloorY: DEFAULT_CONFIG.world.safetyFloorY,
        respawnDelaySeconds: Number.POSITIVE_INFINITY,
      });
      expect(player.position.y).toBeGreaterThan(DEFAULT_CONFIG.world.safetyFloorY - 1);
    }
  });

  it('does not count a death while merely standing still on the deck', () => {
    const { level, player } = createSimulation();
    const trace = simulate(level, player, 20, () => STILL);
    expect(trace.deaths).toBe(0);
    expect(player.alive).toBe(true);
  });
});

describe('determinism', () => {
  it('produces identical results for the same scripted input', () => {
    const script = (step: number): MoveInput => {
      const phase = Math.floor(step / 30) % 4;
      return {
        forward: phase === 0 ? 1 : phase === 2 ? -1 : 0,
        right: phase === 1 ? 1 : phase === 3 ? -1 : 0,
        sprint: phase % 2 === 0,
        jump: step % 45 === 0,
        crouch: phase === 3,
      };
    };

    const first = createSimulation();
    const second = createSimulation();

    const traceA = simulate(first.level, first.player, 8, script);
    const traceB = simulate(second.level, second.player, 8, script);

    expect(traceA.positions).toEqual(traceB.positions);
    expect(traceA.deaths).toBe(traceB.deaths);
    expect(first.player.velocity).toEqual(second.player.velocity);
  });
});

describe('fixed-step accumulator integration', () => {
  it('simulates the same total time regardless of frame rate', () => {
    function runAt(fps: number): { z: number; steps: number } {
      const { level, player } = createSimulation();
      const accumulator = new FixedStepAccumulator(STEP, DEFAULT_CONFIG.world.maxSubSteps);
      const frameDelta = 1 / fps;

      let steps = 0;
      for (let frame = 0; frame < fps * 1.5; frame += 1) {
        steps += accumulator.run(frameDelta, (dt) => {
          stepPlayer(player, SPRINT_FORWARD, dt, stepOptions(level));
        });
      }
      return { z: player.position.z, steps };
    }

    // Above the tick rate the accumulator is exact; below it the spiral guard
    // deliberately trades time for stability, so 60 Hz is the reference.
    const at60 = runAt(60);
    const at120 = runAt(120);

    expect(at120.steps).toBeCloseTo(at60.steps, 0);
    expect(at120.z).toBeCloseTo(at60.z, 3);
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
        stepPlayer(player, FORWARD, dt, stepOptions(level));
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
    simulate(level, player, 2, () => SPRINT_FORWARD);

    const snapshot = snapshotPlayer(player);
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
    expect(snapshot.grounded).toBe(true);
    expect(snapshot.stance).toBe('standing');
    expect(snapshot.alive).toBe(true);
    expect(snapshot.deaths).toBe(0);
    expect(snapshot.speed).toBeGreaterThan(0);
    expect(snapshot.position).not.toBe(player.position);
  });
});
