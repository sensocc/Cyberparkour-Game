/**
 * Integration test: the whole pipeline, without a renderer.
 *
 * level -> collision world -> fixed-step accumulator -> player. It exists to
 * catch what unit tests cannot see: tunnelling, sinking, escaping the level,
 * drift, non-determinism, and whether the movement abilities actually work on the
 * roof that ships rather than on a fixture.
 *
 * Every invariant is checked after *every* step, not just at the end.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG, fixedStep } from '../../src/core/config.js';
import { FixedStepAccumulator } from '../../src/core/delta.js';
import { copyVec3, lengthVec3, vec3, type Vec3 } from '../../src/core/vec3.js';
import { aabbFromCenterSize, overlaps } from '../../src/game/physics/aabb.js';
import { buildLevel, groundHeightAt, propBounds, type BuiltLevel } from '../../src/game/level/level.js';
import { DEMO_DISTRICT, type PropDefinition } from '../../src/game/level/levelData.js';
import { ElevatorSystem, carryRider } from '../../src/game/level/elevators.js';
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

const CONFIG = DEFAULT_CONFIG;
const PLAYER = CONFIG.player;
const STEP = fixedStep(CONFIG);
const TICKS_PER_SECOND = CONFIG.world.tickRate;

function createSimulation(): { level: BuiltLevel; player: PlayerState; climbables: Set<string> } {
  const level = buildLevel(DEMO_DISTRICT, {
    maxSubStep: CONFIG.world.maxCollisionSubStep,
    player: standingSize(PLAYER),
  });
  const climbables = new Set(
    level.colliders.filter((collider) => collider.kind === 'climbable').map((collider) => collider.id),
  );
  return { level, player: createPlayerState(DEMO_DISTRICT.spawn, CONFIG), climbables };
}

/** Options matching what `Game` passes to every step. */
function stepOptions(level: BuiltLevel, climbables: ReadonlySet<string>) {
  return {
    world: level.world,
    config: PLAYER,
    game: CONFIG,
    climbableIds: climbables,
    // V0.4 pipes, read straight from the level: the shipped district has one, and
    // the whole point of the integration suite is to exercise what actually ships.
    pipeIds: new Set(
      level.colliders.filter((collider) => collider.kind === 'pipe').map((collider) => collider.id),
    ),
    killPlaneY: DEMO_DISTRICT.killPlaneY,
    respawnDelaySeconds: CONFIG.respawn.delaySeconds,
    safetyFloorY: CONFIG.world.safetyFloorY,
  };
}

const input = (overrides: Partial<MoveInput> = {}): MoveInput => ({
  forward: 0,
  right: 0,
  sprint: false,
  jump: false,
  crouch: false,
  ...overrides,
});

const FORWARD_JUMP = input({ forward: 1, jump: true });
const STILL = input();
const FORWARD = input({ forward: 1 });
const SPRINT_FORWARD = input({ forward: 1, sprint: true });
const BACK = input({ forward: -1 });
const RIGHT = input({ right: 1 });
const LEFT = input({ right: -1 });
const SPRINT_BACK = input({ forward: -1, sprint: true });
const SPRINT_RIGHT = input({ right: 1, sprint: true });
const SPRINT_LEFT = input({ right: -1, sprint: true });

/** Places a player at a known spot on the deck, at rest, facing `yaw`. */
function placeAt(player: PlayerState, x: number, z: number, yaw = 0): void {
  player.position = vec3(x, 0.001, z);
  player.previousPosition = vec3(x, 0.001, z);
  player.velocity = vec3(0, 0, 0);
  player.yaw = yaw;
  player.grounded = false;
  player.crouching = false;
  player.sliding = false;
  player.hangId = null;
  player.climbId = null;
  player.maneuver = null;
  player.peakFallSpeed = 0;
  player.health = CONFIG.fallDamage.maxHealth;
  player.wallId = null;
  player.wallRunElapsed = 0;
  player.wallJumpId = null;
  player.wallCooldown = 0;
  // Back to the level spawn as well: a test that happens to cross a checkpoint
  // must not change where the next test's respawn lands.
  player.checkpoint = -1;
  copyVec3(player.respawn.position, player.spawn.position);
  player.respawn.yaw = player.spawn.yaw;
  player.respawn.pitch = player.spawn.pitch;
}

interface Trace {
  readonly positions: Vec3[];
  readonly worstPenetration: number;
  readonly minY: number;
  readonly maxY: number;
  readonly nonFinite: number;
  readonly groundIds: Set<string>;
  readonly deaths: number;
  readonly maneuvers: Set<string>;
  readonly landings: number;
  readonly maxDamage: number;
}

function simulate(
  level: BuiltLevel,
  player: PlayerState,
  climbables: ReadonlySet<string>,
  seconds: number,
  inputFor: (step: number, player: PlayerState) => MoveInput,
): Trace {
  const steps = Math.round(seconds * TICKS_PER_SECOND);
  const options = stepOptions(level, climbables);
  const positions: Vec3[] = [];
  const groundIds = new Set<string>();
  const maneuvers = new Set<string>();

  let worstPenetration = 0;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let nonFinite = 0;
  let deaths = 0;
  let landings = 0;
  let maxDamage = 0;

  for (let step = 0; step < steps; step += 1) {
    const outcome = stepPlayer(player, inputFor(step, player), STEP, options);
    if (outcome.died) deaths += 1;
    if (outcome.started) maneuvers.add(outcome.started);
    if (outcome.landing) {
      landings += 1;
      maxDamage = Math.max(maxDamage, outcome.landing.damage);
    }

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
    // inside any collider. Mantling and pull-ups are scripted moves that cross
    // the volume they are climbing, so they are the one exception.
    if (player.maneuver) continue;

    const height = playerHeight(player, PLAYER);
    const box = aabbFromCenterSize(
      { x: position.x, y: position.y + height / 2, z: position.z },
      { x: PLAYER.radius * 2, y: height, z: PLAYER.radius * 2 },
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
    maneuvers,
    landings,
    maxDamage,
  };
}

describe('settling onto the demo roof', () => {
  it('drops the spawn point onto the deck and stays there', () => {
    const { level, player, climbables } = createSimulation();
    const trace = simulate(level, player, climbables, 3, () => STILL);

    expect(trace.nonFinite).toBe(0);
    expect(trace.worstPenetration).toBe(0);
    expect(player.grounded).toBe(true);
    expect(player.groundId).toBe('deck');
    expect(player.position.y).toBeCloseTo(0.001, 6);
    expect(trace.minY).toBeGreaterThanOrEqual(0);
    expect(trace.maxY).toBeLessThan(1);
    expect(player.alive).toBe(true);
    expect(player.deaths).toBe(0);
    expect(player.health).toBe(CONFIG.fallDamage.maxHealth);
  });

  it('reports the deck as the only supporting surface', () => {
    const { level, player, climbables } = createSimulation();
    const trace = simulate(level, player, climbables, 2, () => STILL);
    expect([...trace.groundIds]).toEqual(['deck']);
  });
});

describe('traversal on the shipped roof', () => {
  it('walks forward without sinking or tunnelling', () => {
    const { level, player, climbables } = createSimulation();
    const trace = simulate(level, player, climbables, 1.5, () => FORWARD);

    expect(trace.nonFinite).toBe(0);
    expect(trace.worstPenetration).toBe(0);
    expect(trace.minY).toBeGreaterThanOrEqual(0);
    expect(player.position.z).toBeLessThan(DEMO_DISTRICT.spawn.position.z - 5);
  });

  it('sprints further than it walks in the same time', () => {
    const walk = createSimulation();
    const sprint = createSimulation();

    simulate(walk.level, walk.player, walk.climbables, 2, () => FORWARD);
    simulate(sprint.level, sprint.player, sprint.climbables, 2, () => SPRINT_FORWARD);

    const walked = Math.abs(walk.player.position.z - DEMO_DISTRICT.spawn.position.z);
    const sprinted = Math.abs(sprint.player.position.z - DEMO_DISTRICT.spawn.position.z);
    expect(sprinted).toBeGreaterThan(walked * 1.2);
  });

  it('moves in every direction without sinking through the deck', () => {
    for (const [name, direction] of [
      ['north (-Z)', FORWARD],
      ['south (+Z)', BACK],
      ['east (+X)', RIGHT],
      ['west (-X)', LEFT],
    ] as const) {
      const { level, player, climbables } = createSimulation();
      const trace = simulate(level, player, climbables, 1, () => direction);

      expect(trace.nonFinite, name).toBe(0);
      expect(trace.worstPenetration, name).toBe(0);
      expect(trace.minY, name).toBeGreaterThanOrEqual(0);
      expect(player.grounded, name).toBe(true);
      expect(player.position.y, name).toBeCloseTo(0.001, 6);
    }
  });

  it('survives a simulated minute of jittering input', () => {
    const { level, player, climbables } = createSimulation();
    let counter = 0;

    const trace = simulate(level, player, climbables, 60, () => {
      counter += 1;
      const phase = Math.floor(counter / 20) % 4;
      return input({
        forward: phase === 0 || phase === 3 ? 1 : -1,
        right: phase < 2 ? 1 : -1,
        sprint: phase % 2 === 0,
        jump: counter % 97 === 0,
        crouch: phase === 2 && counter % 40 < 15,
      });
    });

    expect(trace.nonFinite).toBe(0);
    expect(trace.worstPenetration).toBe(0);
    expect(lengthVec3(player.velocity)).toBeLessThan(PLAYER.maxSpeed);
    // Jittering on an open roof means eventually walking off it - and surviving
    // the fall by respawning.
    expect(trace.deaths).toBeGreaterThan(0);
    // A live player must never be below the kill plane. A *dead* one legitimately
    // can be: a dead player keeps falling until the respawn timer expires, which is
    // what stops a death from reading as a teleport - so a minute that happens to
    // end mid-death ends below the plane, on purpose.
    if (player.alive) {
      expect(player.position.y).toBeGreaterThan(DEMO_DISTRICT.killPlaneY);
    } else {
      expect(player.deaths).toBeGreaterThan(0);
    }
    // No single landing should have been lethal without it being a long fall.
    expect(trace.maxDamage).toBeLessThanOrEqual(CONFIG.fallDamage.maxHealth);
  });
});

describe('the V0.3 abilities, on the district that ships', () => {
  it('mantles every step of the roof access and onto the penthouse', () => {
    // The flight rises 0.6 m a step to 2.4 m, then a 1.4 m mantle onto the roof.
    const { level, player, climbables } = createSimulation();
    placeAt(player, -15, -8);

    const trace = simulate(level, player, climbables, 3, () => input({ right: 1 }));

    expect(trace.maneuvers.has('mantle')).toBe(true);
    // All the way up: the flight tops out at 2.4 m and the roof access at 3.8 m.
    expect(trace.maxY).toBeGreaterThan(3.7);
    expect(trace.groundIds.has('penthouse')).toBe(true);
    expect(trace.worstPenetration).toBe(0);
  });

  it('grabs and pulls up onto the duct, from a standing start', () => {
    const { level, player, climbables } = createSimulation();
    const duct = DEMO_DISTRICT.props.find((entry) => entry.id === 'duct')!;
    // Just west of the duct's face, which tops out 2.6 m above the deck.
    placeAt(player, duct.position.x - duct.size.x / 2 - 0.35, duct.position.z, -Math.PI / 2);

    const trace = simulate(level, player, climbables, 6, (step) => {
      if (step < 12) return FORWARD_JUMP;
      if (step < 50) return FORWARD;
      if (step < 60) return FORWARD_JUMP;
      return STILL;
    });

    expect(trace.maneuvers.has('hang')).toBe(true);
    expect(trace.maneuvers.has('pull-up')).toBe(true);
    expect(player.grounded).toBe(true);
    expect(player.position.y).toBeGreaterThan(2.5);
    expect(player.position.y).toBeLessThan(2.7);
    expect(player.alive).toBe(true);
  });

  it('slides under the duct, which a standing player cannot pass', () => {
    const approach = (action: (step: number) => MoveInput): PlayerState => {
      const { level, player, climbables } = createSimulation();
      placeAt(player, -8, 6);
      simulate(level, player, climbables, 3, action);
      return player;
    };

    // The duct spans x = 3.4 to 4.6 with 1.4 m of clearance beneath it.
    const running = approach((step) => (step < 72 ? SPRINT_RIGHT : input({ right: 1, crouch: true })));
    const walking = approach(() => RIGHT);

    expect(walking.position.x).toBeLessThan(3.4);
    expect(running.position.x).toBeGreaterThan(4.6);
  });

  it('climbs the riser pipe up past the pull-up ceiling', () => {
    const { level, player, climbables } = createSimulation();
    const pipe = DEMO_DISTRICT.props.find((entry) => entry.id === 'riser-pipe') as PropDefinition;
    expect(pipe).toBeDefined();
    const pipeTop = propBounds(pipe).max.y;

    // Stand just west of the pipe, facing it.
    placeAt(player, pipe.position.x - pipe.size.x / 2 - 0.6, pipe.position.z, -Math.PI / 2);

    const trace = simulate(level, player, climbables, 6, () => FORWARD);

    expect(trace.maneuvers.has('climb')).toBe(true);
    // Climbing reaches higher than any grab could.
    expect(trace.maxY).toBeGreaterThan(CONFIG.maneuver.pullUp.maxHeight);
    expect(trace.maxY).toBeGreaterThan(pipeTop - 0.5);
    expect(trace.worstPenetration).toBe(0);
  });

  it('rides the lift from the works back up to the home roof', () => {
    const { level, player, climbables } = createSimulation();
    const lifts = new ElevatorSystem(DEMO_DISTRICT.elevators ?? [], level.world, {
      dwellSeconds: CONFIG.elevator.dwellSeconds,
      speed: CONFIG.elevator.speed,
    });
    const options = stepOptions(level, climbables);

    // Stand on `lift-up` at the bottom of its travel. It sits in the gap between
    // the works roof and `home`, so the platform is the only thing underfoot.
    placeAt(player, 14, 14);
    player.position.y = -4.79;
    player.previousPosition = { ...player.position };

    let highest = player.position.y;
    let lowest = player.position.y;

    for (let tick = 0; tick < 600; tick += 1) {
      // Exactly the order the game uses: the lift moves, the rider is carried,
      // then the physics steps onto the new surface.
      for (const ride of lifts.update(STEP)) {
        if (player.groundId === ride.id) carryRider(player, ride.deltaY);
      }
      stepPlayer(player, STILL, STEP, options);
      highest = Math.max(highest, player.position.y);
      lowest = Math.min(lowest, player.position.y);
    }

    // It arrives at the home roof - flush, at y = 0 - and took the player with it.
    expect(highest).toBeGreaterThan(-0.05);
    // ...and the floor never slid out from under them on the way.
    expect(lowest).toBeGreaterThan(-5.1);
  });

  it('climbs the machine room pipe up to its roof', () => {
    const { level, player, climbables } = createSimulation();
    const pipe = DEMO_DISTRICT.props.find((entry) => entry.id === 'pipe-east') as PropDefinition;
    expect(pipe, 'expected the east machine room pipe').toBeDefined();
    const pipeTop = propBounds(pipe).max.y;

    // Stand east of the pipe on the east roof, facing it, and climb.
    placeAt(player, pipe.position.x + pipe.size.x / 2 + 0.6, pipe.position.z, Math.PI / 2);
    player.position.y = 1.21;
    player.previousPosition = { ...player.position };

    const trace = simulate(level, player, climbables, 8, () => FORWARD);

    expect(trace.maneuvers.has('pipe-grab')).toBe(true);
    // A pipe is climbed, which reaches higher than any grab can.
    expect(trace.maxY).toBeGreaterThan(CONFIG.maneuver.pullUp.maxHeight);
    // ...and it tops out at the room's roof, which is a surface you can stand on.
    expect(trace.maxY).toBeGreaterThanOrEqual(pipeTop - 0.2);
    expect(trace.worstPenetration).toBe(0);
  });

  it('survives a fall from the penthouse roof, but takes damage for it', () => {
    const { level, player, climbables } = createSimulation();
    // Level with the roof access block but clear of it in plan, so the drop runs
    // the full 3.8 m to the deck rather than starting on a roof.
    const penthouse = DEMO_DISTRICT.props.find((entry) => entry.id === 'penthouse')!;
    placeAt(player, penthouse.position.x, -1);
    player.position.y = propBounds(penthouse).max.y;
    player.previousPosition = { ...player.position };
    player.grounded = false;
    const loaded = player.health;

    const trace = simulate(level, player, climbables, 3, () => STILL);

    expect(trace.landings).toBeGreaterThan(0);
    expect(trace.maxDamage).toBeGreaterThan(0);
    expect(player.health).toBeLessThan(loaded);
    // It was a survivable drop.
    expect(player.alive).toBe(true);
    expect(player.groundId).toBe('deck');
  });

  it('takes no damage from hopping off a 0.6 m step', () => {
    const { level, player, climbables } = createSimulation();
    const step = DEMO_DISTRICT.props.find((entry) => entry.id === 'penthouse-step-1')!;
    placeAt(player, step.position.x, step.position.z);
    player.position.y = propBounds(step).max.y;
    player.grounded = false;

    const trace = simulate(level, player, climbables, 2, () => STILL);

    expect(trace.landings).toBeGreaterThan(0);
    expect(trace.maxDamage).toBe(0);
    expect(player.health).toBe(CONFIG.fallDamage.maxHealth);
  });
});

describe('fall detection and respawn', () => {
  it('dies when it runs off the edge, and comes back', () => {
    const { level, player, climbables } = createSimulation();
    placeAt(player, 0, 15);

    let diedAt = -1;
    let respawnedAt = -1;
    let cause: string | null = null;

    for (let step = 0; step < 1200; step += 1) {
      const outcome = stepPlayer(player, SPRINT_BACK, STEP, stepOptions(level, climbables));
      if (outcome.died && diedAt === -1) {
        diedAt = step;
        cause = player.deathCause;
      }
      if (outcome.respawned) {
        respawnedAt = step;
        break;
      }
    }

    expect(diedAt).toBeGreaterThan(0);
    expect(respawnedAt).toBeGreaterThan(diedAt);
    expect(cause).toBe('fell');
    expect(player.alive).toBe(true);
    expect(player.deaths).toBe(1);
    // A respawn clears the cause and restores health.
    expect(player.deathCause).toBeNull();
    expect(player.health).toBe(CONFIG.fallDamage.maxHealth);
    expect(player.position.x).toBeCloseTo(DEMO_DISTRICT.spawn.position.x, 6);
    expect(player.position.z).toBeCloseTo(DEMO_DISTRICT.spawn.position.z, 6);
  });

  it('kills a fall from every edge of the deck', () => {
    // Each start point is a couple of metres inside an edge of the home roof, on
    // a lane that is clear of props all the way to the drop.
    const directions: [string, { x: number; z: number }, MoveInput][] = [
      ['north (-Z)', { x: 0, z: -9 }, SPRINT_FORWARD],
      ['south (+Z)', { x: 0, z: 9 }, SPRINT_BACK],
      ['east (+X)', { x: 12, z: 0 }, SPRINT_RIGHT],
      ['west (-X)', { x: -14, z: 3 }, SPRINT_LEFT],
    ];

    for (const [name, start, direction] of directions) {
      const { level, player, climbables } = createSimulation();
      placeAt(player, start.x, start.z);
      expect(groundHeightAt(DEMO_DISTRICT, start), `${name} start is on the deck`).toBeCloseTo(0, 9);

      let died = false;
      for (let step = 0; step < 600 && !died; step += 1) {
        const outcome = stepPlayer(player, direction, STEP, {
          ...stepOptions(level, climbables),
          respawnDelaySeconds: Number.POSITIVE_INFINITY,
        });
        if (outcome.died) died = true;
      }

      expect(died, `${name} should be fatal`).toBe(true);
      expect(player.alive, name).toBe(false);
      expect(player.position.y, name).toBeLessThanOrEqual(DEMO_DISTRICT.killPlaneY);
    }
  });
});

describe('determinism', () => {
  it('produces identical results for the same scripted input', () => {
    const script = (step: number): MoveInput => {
      const phase = Math.floor(step / 30) % 4;
      return input({
        forward: phase === 0 ? 1 : phase === 2 ? -1 : 0,
        right: phase === 1 ? 1 : phase === 3 ? -1 : 0,
        sprint: phase % 2 === 0,
        jump: step % 45 === 0,
        crouch: phase === 3,
      });
    };

    const first = createSimulation();
    const second = createSimulation();

    const traceA = simulate(first.level, first.player, first.climbables, 8, script);
    const traceB = simulate(second.level, second.player, second.climbables, 8, script);

    expect(traceA.positions).toEqual(traceB.positions);
    expect(traceA.deaths).toBe(traceB.deaths);
    expect(first.player.velocity).toEqual(second.player.velocity);
  });
});

describe('fixed-step accumulator integration', () => {
  it('simulates the same total time regardless of frame rate', () => {
    function runAt(fps: number): { z: number; steps: number } {
      const { level, player, climbables } = createSimulation();
      const accumulator = new FixedStepAccumulator(STEP, CONFIG.world.maxSubSteps);
      const options = stepOptions(level, climbables);

      let steps = 0;
      for (let frame = 0; frame < fps * 1.5; frame += 1) {
        steps += accumulator.run(1 / fps, (dt) => {
          stepPlayer(player, SPRINT_FORWARD, dt, options);
        });
      }
      return { z: player.position.z, steps };
    }

    const at60 = runAt(60);
    const at120 = runAt(120);

    expect(at120.steps).toBeCloseTo(at60.steps, 0);
    expect(at120.z).toBeCloseTo(at60.z, 3);
  });

  it('keeps interpolation alpha in range across a burst of frames', () => {
    const accumulator = new FixedStepAccumulator(STEP, CONFIG.world.maxSubSteps);
    for (const delta of [0.016, 0.017, 0.008, 0.033, 0.1, 0.25]) {
      accumulator.run(delta, () => {});
      expect(accumulator.alpha).toBeGreaterThanOrEqual(0);
      expect(accumulator.alpha).toBeLessThanOrEqual(1);
    }
  });

  it('interpolated positions stay between the previous and current step', () => {
    const { level, player, climbables } = createSimulation();
    const accumulator = new FixedStepAccumulator(STEP, CONFIG.world.maxSubSteps);
    const options = stepOptions(level, climbables);
    const out = vec3();

    for (let frame = 0; frame < 240; frame += 1) {
      accumulator.run(1 / 144, (dt) => {
        stepPlayer(player, FORWARD, dt, options);
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
    const { level, player, climbables } = createSimulation();
    // Half a second: long enough to be moving, short enough that the player is
    // still on the home roof rather than out over a canyon.
    simulate(level, player, climbables, 0.5, () => SPRINT_FORWARD);

    const snapshot = snapshotPlayer(player);
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
    expect(snapshot.grounded).toBe(true);
    expect(snapshot.stance).toBe('standing');
    expect(snapshot.alive).toBe(true);
    expect(snapshot.deaths).toBe(0);
    expect(snapshot.health).toBe(CONFIG.fallDamage.maxHealth);
    expect(snapshot.locomotion).toBe('grounded');
    expect(snapshot.speed).toBeGreaterThan(0);
  });

  it('reports the eye height for the current stance', () => {
    const { player } = createSimulation();
    expect(eyeHeight(player, PLAYER)).toBe(PLAYER.standEyeHeight);
    player.crouching = true;
    expect(eyeHeight(player, PLAYER)).toBe(PLAYER.crouchEyeHeight);
  });
});
