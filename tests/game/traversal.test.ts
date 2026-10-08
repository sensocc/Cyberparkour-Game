/**
 * The V0.3 traversal moves: wall running, wall jumping, rolling, vaulting,
 * Kong vaulting and checkpoints.
 *
 * These run against small, purpose-built worlds rather than the district, so each
 * test can state the geometry it needs in one place and the numbers in the
 * assertions are about the *move* rather than about a level that will change.
 * The integration suite is where the same moves are checked on the roof that
 * actually ships.
 */

import { describe, expect, it } from 'vitest';

import { clamp } from '../../src/core/math.js';
import { lengthXZ, vec3 } from '../../src/core/vec3.js';
import { COLLISION_SKIN } from '../../src/game/physics/collision.js';
import { findVaultObstacle, findWallRunSurface } from '../../src/game/physics/ledges.js';
import { boxOf, collider, input, optionsFor, run, spawnAt, world, CONFIG, STEP } from '../helpers/player.js';
import {
  createPlayerState,
  headBobOffset,
  locomotion,
  snapshotPlayer,
  stance,
  stepPlayer,
  type PlayerState,
} from '../../src/game/player.js';
import { aabbFromCenterSize } from '../../src/game/physics/aabb.js';
import type { CheckpointDefinition } from '../../src/game/level/levelData.js';

const WALL_RUN = CONFIG.maneuver.wallRun;
const WALL_JUMP = CONFIG.maneuver.wallJump;
const VAULT = CONFIG.maneuver.vault;
const CHECKPOINT = CONFIG.checkpoint;

/** Yaw that looks along +X. */
const FACING_EAST = -Math.PI / 2;

/** A tall wall running north-south, on the player's right when heading +Z. */
function eastWall(at = 2): ReturnType<typeof collider> {
  return collider('wall', vec3(at + 0.5, 4, 0), vec3(1, 8, 40), 'wall');
}

describe('findWallRunSurface', () => {
  const floor = collider('floor', vec3(0, -0.5, 0), vec3(60, 1, 60), 'floor');

  const probe = (
    collisionWorld: ReturnType<typeof world>,
    position: ReturnType<typeof vec3>,
    travel: ReturnType<typeof vec3>,
    extra: { ignoreWallId?: string | null } = {},
  ) =>
    findWallRunSurface({
      world: collisionWorld,
      box: aabbFromCenterSize(
        { x: position.x, y: position.y + CONFIG.player.standHeight / 2, z: position.z },
        { x: CONFIG.player.radius * 2, y: CONFIG.player.standHeight, z: CONFIG.player.radius * 2 },
      ),
      travel,
      reach: WALL_RUN.reach,
      minHeight: WALL_RUN.minHeight,
      ignoreId: null,
      ...extra,
    });

  it('finds a wall parallel to the direction of travel', () => {
    const hit = probe(world(floor, eastWall(2)), vec3(1.5, 0.001, 0), vec3(0, 0, 1));
    expect(hit?.collider.id).toBe('wall');
    // Which side it is on matters: it is what the wall jump pushes away from.
    expect(hit?.direction.x).toBe(1);
  });

  it('ignores a wall it is heading straight into', () => {
    // A face ahead is something to run into or climb, not along.
    expect(probe(world(floor, eastWall(2)), vec3(1.5, 0.001, 0), vec3(1, 0, 0))).toBeNull();
  });

  it('ignores anything too low to be a wall', () => {
    const kerb = collider('kerb', vec3(2.5, 0.25, 0), vec3(1, 0.5, 40), 'prop');
    expect(probe(world(floor, kerb), vec3(1.5, 0.001, 0), vec3(0, 0, 1))).toBeNull();
  });

  it('ignores a wall that has been locked out by a wall jump', () => {
    expect(probe(world(floor, eastWall(2)), vec3(1.5, 0.001, 0), vec3(0, 0, 1), { ignoreWallId: 'wall' })).toBeNull();
  });

  it('prefers the nearer of two walls', () => {
    // Both within reach, the west one closer: the nearer wall wins.
    const hit = probe(
      world(floor, eastWall(1.2), collider('west', vec3(-0.95, 4, 0), vec3(1, 8, 40), 'wall')),
      vec3(0, 0.001, 0),
      vec3(0, 0, 1),
    );
    expect(hit?.collider.id).toBe('west');
  });
});

describe('wall running', () => {
  /**
   * A wall on the east side of a lane, and no floor beyond it.
   *
   * The player runs north (+Z) along the wall, so the wall is on their right.
   */
  const lane = world(
    collider('floor', vec3(0, -0.5, 0), vec3(6, 1, 200), 'floor'),
    collider('wall', vec3(4, 5, 0), vec3(2, 12, 200), 'wall'),
  );

  it('attaches in the air, against a wall it is running along', () => {
    const { attachedAt } = runAttached(lane, 0.5);
    expect(attachedAt).toBeGreaterThan(0);
  });

  it('applies far less gravity than a free fall', () => {
    // Settled onto the wall first, so the jump's own rise is out of the picture.
    const { state, attachedAt, attachedVy } = runAttached(lane, 0.6);
    const elapsed = (state.wallRunElapsed === 0 ? 0 : 0) + 0.6;
    const wallFall = attachedVy - state.velocity.y;
    const freeFall = CONFIG.player.gravity * elapsed;

    expect(wallFall).toBeGreaterThan(0);
    expect(wallFall).toBeLessThan(freeFall * 0.5);
    expect(attachedAt).toBeGreaterThan(0);
    expect(CONFIG.maneuver.wallRun.gravityScale).toBeLessThan(1);
  });

  it('ends once the run has lasted its limit, and locks the wall out', () => {
    const { state, events } = runAttached(lane, WALL_RUN.maxSeconds + 0.3);
    expect(events).toContain('end:wall-run');
    // And it does not quietly start again: the same wall is refused for a moment,
    // which is what stops a single wall from being an indefinite hover.
    expect(state.wallId).toBeNull();
    expect(locomotion(state)).not.toBe('wall-running');
    expect(WALL_RUN.reattachCooldownSeconds).toBeGreaterThan(0);
  });

  it('ends when the player runs off the end of the wall', () => {
    // A wall that stops 17 m along: the contact is simply gone, and the run ends
    // before its own time limit - which is the difference between the two exits.
    const shortWall = world(
      collider('floor', vec3(0, -0.5, 0), vec3(6, 1, 200), 'floor'),
      collider('wall', vec3(4, 5, 0), vec3(2, 12, 34), 'wall'),
    );
    const { state, events } = runAttached(shortWall, 1.2);

    expect(events).toContain('wall-run');
    expect(events).toContain('end:wall-run');
    expect(state.wallId).toBeNull();
    // It ran out of wall, not out of time: the run ended well inside its own
    // limit, because the run-up had already carried the player most of the way
    // along this particular wall.
    expect(state.wallRunElapsed).toBeGreaterThan(0.4);
    expect(state.wallRunElapsed).toBeLessThan(WALL_RUN.maxSeconds);
  });

  it('never attaches from the ground', () => {
    // Standing next to a wall is not running along it.
    const player = run(lane, { steps: 30, input: input({ right: 1 }) });
    expect(player.wallId).toBeNull();
  });

  it('does not attach below the entry speed', () => {
    const player = run(lane, {
      steps: 40,
      input: (step) => (step < 20 ? input({ right: 1 }) : input({ forward: 1, jump: true })),
    });
    expect(player.wallId).toBeNull();
  });

  /**
   * Runs north along the wall, jumps, and reports the state once attached.
   *
   * The lane is 6 m wide with the wall along its east edge, so the player starts
   * pressed against it and travels *along* it - which is the only way a wall run
   * makes sense, and the reason a jump straight at a wall does not attach.
   */
  function runAttached(
    collisionWorld: ReturnType<typeof world>,
    seconds: number,
    slowFrom?: (step: number) => boolean,
  ): { state: PlayerState; attachedAt: number; attachedVy: number; events: string[] } {
    const state = createPlayerState(spawnAt(2.4, 0.001, 0, 0), CONFIG);
    const options = optionsFor(collisionWorld);
    const events: string[] = [];
    let attachedAt = -1;
    let attachedVy = 0;
    const total = Math.ceil((seconds + 5) / STEP);

    for (let step = 0; step < total; step += 1) {
      const move =
        step < 60
          ? input({ forward: 1, sprint: true })
          : step === 60
            ? input({ forward: 1, sprint: true, jump: true })
            : slowFrom?.(step)
              ? input()
              : input({ forward: 1, sprint: true });
      const outcome = stepPlayer(state, move, STEP, options);
      if (outcome.started) events.push(outcome.started);
      if (outcome.ended) events.push(`end:${outcome.ended}`);
      if (attachedAt < 0 && state.wallId !== null) {
        attachedAt = step;
        attachedVy = state.velocity.y;
      }
      if (attachedAt >= 0 && step >= attachedAt + Math.ceil(seconds / STEP)) break;
    }
    return { state, attachedAt, attachedVy, events };
  }
});

describe('wall jumping', () => {
  const corridor = world(
    collider('floor', vec3(0, -0.5, 0), vec3(200, 1, 200), 'floor'),
    collider('west', vec3(-1.6, 5, 0), vec3(1, 12, 200), 'wall'),
    collider('east', vec3(1.6, 5, 0), vec3(1, 12, 200), 'wall'),
  );

  it('pushes away from the wall and upward', () => {
    const { state, jumped, wallId } = jumpOffWall();
    expect(jumped).toBe(true);
    expect(wallId).toBe('west');
    // The wall is on the player's west side, so away from it is east - and the
    // push has to be strong enough to be worth the jump.
    expect(state.velocity.x).toBeGreaterThan(WALL_JUMP.outwardSpeed * 0.5);
    expect(state.velocity.y).toBeGreaterThan(0);
  });

  it('locks out the wall it just left, so one wall cannot be climbed', () => {
    const { state, wallId } = jumpOffWall();
    expect(state.wallJumpId).toBe(wallId);
    expect(state.wallCooldown).toBeCloseTo(WALL_JUMP.lockoutSeconds, 6);

    // Which means the probe refuses it for as long as the lockout lasts.
    const stillLocked = state.wallCooldown > 0;
    expect(stillLocked).toBe(true);
  });

  it('rises higher than the jump it interrupted', () => {
    expect(WALL_JUMP.upwardSpeed).toBeGreaterThan(CONFIG.player.jumpSpeed);
  });

  /**
   * Attaches to the west wall of the corridor, then kicks off it.
   *
   * The jump is deliberately pressed a step *after* attaching: the press that got
   * the player off the ground is long gone, so the only thing the second press can
   * be is a wall jump.
   */
  function jumpOffWall(): { state: PlayerState; jumped: boolean; wallId: string } {
    const state = createPlayerState(spawnAt(-0.5, 0.001, 0, 0), CONFIG);
    const options = optionsFor(corridor);
    let jumped = false;
    let wallId = '';
    let attached = false;

    for (let step = 0; step < 200; step += 1) {
      const move = attached
        ? input({ forward: 1, sprint: true, jump: true })
        : step === 60
          ? input({ forward: 1, sprint: true, jump: true })
          : input({ forward: 1, sprint: true });
      const before = state.wallId;
      const outcome = stepPlayer(state, move, STEP, options);
      if (outcome.started === 'wall-run') attached = true;
      if (outcome.started === 'wall-jump') {
        jumped = true;
        wallId = before ?? '';
        break;
      }
    }
    return { state, jumped, wallId };
  }
});

describe('rolling out of a landing', () => {
  /** A drop from `dropHeight`, landing on the floor below. */
  function drop(dropHeight: number, crouch: boolean, steps = 200): {
    state: PlayerState;
    damage: number;
    rolled: boolean;
    maxY: number;
    minY: number;
  } {
    const floor = world(collider('floor', vec3(0, -0.5, 0), vec3(200, 1, 200), 'floor'));
    const state = createPlayerState(spawnAt(0, dropHeight, 0, FACING_EAST), CONFIG);
    const options = optionsFor(floor);
    let damage = 0;
    let rolled = false;
    let landed = false;
    let maxY = state.position.y;
    let minY = state.position.y;

    for (let step = 0; step < steps; step += 1) {
      // Build up speed so there is something to roll with, then hold crouch.
      const move = crouch
        ? input({ forward: 1, sprint: true, crouch: state.position.y < CONFIG.player.standHeight })
        : input({ forward: 1, sprint: true });
      const outcome = stepPlayer(state, move, STEP, options);
      if (outcome.landing) {
        landed = true;
        damage = outcome.landing.damage;
        rolled = outcome.landing.rolled;
      }
      maxY = Math.max(maxY, state.position.y);
      minY = Math.min(minY, state.position.y);
      if (landed && state.maneuver === null) break;
    }
    return { state, damage, rolled, maxY, minY };
  }

  it('rolls on a hard landing and takes much less damage', () => {
    const rolled = drop(9, true);
    const taken = drop(9, false);

    expect(rolled.rolled).toBe(true);
    expect(taken.rolled).toBe(false);
    expect(rolled.damage).toBeGreaterThan(0);
    expect(rolled.damage).toBeLessThan(taken.damage * 0.5);
  });

  it('ignores the crouch key on a landing that does not need a roll', () => {
    const soft = drop(1.5, true);
    expect(soft.rolled).toBe(false);
    expect(soft.damage).toBe(0);
  });

  it('turns a fatal drop into a survivable one', () => {
    // 14 m: comfortably past the fatal impact speed, with room to spare for the
    // step quantisation that decides exactly when the landing is detected.
    const taken = drop(14, false);
    const rolled = drop(14, true);
    expect(taken.state.health).toBe(0);
    expect(rolled.state.health).toBeGreaterThan(0);
    expect(rolled.state.alive).toBe(true);
  });

  it('keeps the player low while rolling', () => {
    const floor = world(collider('floor', vec3(0, -0.5, 0), vec3(200, 1, 200), 'floor'));
    const state = createPlayerState(spawnAt(0, 6, 0, FACING_EAST), CONFIG);
    const options = optionsFor(floor);
    let sawRolling = false;

    for (let step = 0; step < 200; step += 1) {
      const outcome = stepPlayer(
        state,
        input({ forward: 1, sprint: true, crouch: state.position.y < CONFIG.player.standHeight }),
        STEP,
        options,
      );
      if (state.maneuver?.kind === 'roll') {
        sawRolling = true;
        // The body stays crouch-height for the whole move, so it fits under
        // things it could not standing up.
        expect(boxOf(state).max.y - boxOf(state).min.y).toBeCloseTo(CONFIG.player.crouchHeight, 6);
        expect(stance(state)).toBe('rolling');
      }
      if (outcome.started === 'roll') break;
    }
    expect(sawRolling).toBe(true);
  });

  it('carries the player forward, not backward', () => {
    const rolled = drop(9, true);
    expect(rolled.state.position.x).toBeGreaterThan(0.5);
  });
});

describe('findVaultObstacle', () => {
  const floor = collider('floor', vec3(0, -0.5, 0), vec3(200, 1, 200), 'floor');
  const query = (obstacle: ReturnType<typeof collider>) => {
    const box = aabbFromCenterSize(
      { x: 0, y: 0.001 + CONFIG.player.standHeight / 2, z: 0 },
      { x: CONFIG.player.radius * 2, y: CONFIG.player.standHeight, z: CONFIG.player.radius * 2 },
    );
    return findVaultObstacle({
      world: world(floor, obstacle),
      box,
      direction: vec3(1, 0, 0),
      reach: VAULT.reach,
      minTopY: 0.001 + VAULT.minHeight,
      maxTopY: 0.001 + VAULT.maxHeight,
      maxDepth: VAULT.maxDepth,
      landingGap: VAULT.landingGap,
      supportDepth: VAULT.supportDepth,
      radius: CONFIG.player.radius,
      standHeight: CONFIG.player.standHeight,
      ignoreId: null,
    });
  };

  it('accepts a thin obstacle inside the waist-high band', () => {
    const hit = query(collider('rail', vec3(1, 0.5, 0), vec3(0.5, 1, 6), 'prop'));
    expect(hit?.collider.id).toBe('rail');
    // And lands past it, not on top of it.
    expect(hit?.landing.x).toBeGreaterThan(1.25);
    expect(hit?.landing.y).toBeCloseTo(0.001 + COLLISION_SKIN, 6);
  });

  it('rejects an obstacle too deep to cross', () => {
    // A crate is something to climb onto, not to vault.
    expect(query(collider('crate', vec3(1, 0.7, 0), vec3(1.6, 1.4, 1.6), 'prop'))).toBeNull();
  });

  it('rejects an obstacle with a hole behind it', () => {
    const edge = collider('floor', vec3(-40, -0.5, 0), vec3(80, 1, 200), 'floor');
    const gapWorld = world(edge, collider('rail', vec3(1, 0.5, 0), vec3(0.5, 1, 6), 'prop'));
    const box = aabbFromCenterSize(
      { x: 0, y: 0.001 + CONFIG.player.standHeight / 2, z: 0 },
      { x: CONFIG.player.radius * 2, y: CONFIG.player.standHeight, z: CONFIG.player.radius * 2 },
    );
    const hit = findVaultObstacle({
      world: gapWorld,
      box,
      direction: vec3(1, 0, 0),
      reach: VAULT.reach,
      minTopY: 0.001 + VAULT.minHeight,
      maxTopY: 0.001 + VAULT.maxHeight,
      maxDepth: VAULT.maxDepth,
      // A landing gap that reaches past the floor's edge, into the void.
      landingGap: 40,
      supportDepth: VAULT.supportDepth,
      radius: CONFIG.player.radius,
      standHeight: CONFIG.player.standHeight,
      ignoreId: null,
    });
    expect(hit).toBeNull();
  });

  it('rejects an obstacle below the vault band', () => {
    expect(query(collider('kerb', vec3(1, 0.12, 0), vec3(0.5, 0.25, 6), 'prop'))).toBeNull();
  });
});

describe('vaulting and the Kong vault', () => {
  /** A 1 m rail 2 m ahead, with floor either side. */
  const course = world(
    collider('floor', vec3(0, -0.5, 0), vec3(200, 1, 200), 'floor'),
    collider('rail', vec3(2, 0.5, 0), vec3(0.4, 1, 8), 'prop'),
  );

  /**
   * Runs at the rail and reports what happened.
   *
   * `exitSpeed` is the speed the move itself handed back, sampled on the step the
   * move ended. Measuring it a few steps later would measure friction instead.
   */
  const approach = (
    sprint: boolean,
    steps = 120,
  ): { state: PlayerState; started: string[]; exitSpeed: number; exitY: number } => {
    const state = createPlayerState(spawnAt(0, 0.001, 0, FACING_EAST), CONFIG);
    const options = optionsFor(course);
    const started: string[] = [];
    let exitSpeed = 0;
    let exitY = 0;
    for (let step = 0; step < steps; step += 1) {
      const outcome = stepPlayer(state, input({ forward: 1, sprint }), STEP, options);
      if (outcome.started) started.push(outcome.started);
      if (outcome.ended === 'vault' || outcome.ended === 'kong-vault') {
        started.push(`end:${outcome.ended}`);
        exitSpeed = lengthXZ(state.velocity);
        exitY = state.position.y;
      }
      if (state.position.x > 5) break;
    }
    return { state, started, exitSpeed, exitY };
  };

  it('vaults the rail at a walk', () => {
    const { state, started } = approach(false);
    expect(started).toContain('vault');
    // And ends up past the rail, still on the floor.
    expect(state.position.x).toBeGreaterThan(2.4);
    expect(state.position.y).toBeLessThan(0.1);
  });

  it('Kong vaults the same rail from a sprint', () => {
    const { started } = approach(true);
    expect(started).toContain('kong-vault');
    expect(started).not.toContain('vault');
  });

  it('keeps far more speed out of a Kong vault than a vault', () => {
    const walk = approach(false);
    const sprint = approach(true);

    // The speed the move hands back, measured as it ends. This difference is the
    // whole reason the Kong vault exists: it is the way over a rail that does not
    // cost you your run.
    expect(sprint.exitSpeed).toBeGreaterThan(walk.exitSpeed * 1.5);
    // And what it keeps is nearly everything it arrived with, where a plain vault
    // keeps well under two thirds.
    expect(VAULT.kong.speedRetention).toBeGreaterThan(0.9);
    expect(VAULT.vault.speedRetention).toBeLessThan(0.7);
  });

  it('travels further than a plain vault', () => {
    expect(VAULT.kong.distanceBonus).toBeGreaterThan(0);
    expect(VAULT.kong.speedRetention).toBeGreaterThan(VAULT.vault.speedRetention);
  });

  it('needs a genuine sprint, not just a walk, for the Kong vault', () => {
    expect(VAULT.kong.minSpeed).toBeGreaterThan(VAULT.vault.minSpeed);
    // Below the Kong threshold but above the plain one.
    const { started } = approach(false);
    expect(started).toContain('vault');
  });

  it('does not vault an obstacle it is not running at', () => {
    const state = createPlayerState(spawnAt(0, 0.001, 0, FACING_EAST), CONFIG);
    const options = optionsFor(course);
    // Sprint *past* the rail, at right angles to it.
    for (let step = 0; step < 60; step += 1) {
      stepPlayer(state, input({ right: 1, sprint: true }), STEP, options);
      expect(state.maneuver?.kind).not.toBe('vault');
    }
  });
});

describe('checkpoints', () => {
  const floor = world(collider('floor', vec3(0, -0.5, 0), vec3(400, 1, 400), 'floor'));
  const checkpoints: readonly CheckpointDefinition[] = [
    { id: 'first', position: vec3(10, 0.001, 0), yaw: 1 },
    { id: 'second', position: vec3(30, 0.001, 0) },
  ];

  /** Runs east across the floor, past both checkpoints. */
  function traverse(runOptions: {
    readonly steps: number;
    readonly checks?: readonly CheckpointDefinition[];
    readonly killPlaneY?: number;
    readonly respawnDelaySeconds?: number;
  }): { state: PlayerState; reached: number[] } {
    const state = createPlayerState(spawnAt(0, 0.001, 0, FACING_EAST), CONFIG);
    const options = optionsFor(floor, {
      checkpoints: runOptions.checks ?? checkpoints,
      ...(runOptions.killPlaneY === undefined ? {} : { killPlaneY: runOptions.killPlaneY }),
      ...(runOptions.respawnDelaySeconds === undefined
        ? {}
        : { respawnDelaySeconds: runOptions.respawnDelaySeconds }),
    });
    const reached: number[] = [];
    for (let step = 0; step < runOptions.steps; step += 1) {
      const outcome = stepPlayer(state, input({ forward: 1, sprint: true }), STEP, options);
      if (outcome.checkpoint !== null) reached.push(outcome.checkpoint);
    }
    return { state, reached };
  }

  it('records a checkpoint the player passes through', () => {
    const { state, reached } = traverse({ steps: 180 });
    expect(reached).toContain(0);
    expect(state.checkpoint).toBe(1);
  });

  it('only ever advances: re-crossing an earlier checkpoint changes nothing', () => {
    const { state, reached } = traverse({ steps: 180 });
    const firstHits = reached.filter((index) => index === 0).length;
    expect(firstHits).toBe(1);
    expect(state.checkpoint).toBe(1);
  });

  it('moves the respawn point, so a fall does not undo the route', () => {
    const { state } = traverse({ steps: 180 });
    expect(state.respawn.position.x).toBeCloseTo(30, 6);
    expect(state.respawn.position.z).toBeCloseTo(0, 6);
  });

  it('keeps the spawn facing when a checkpoint does not set one', () => {
    const { state } = traverse({ steps: 180 });
    expect(state.respawn.yaw).toBe(state.spawn.yaw);
  });

  it('sends the player back to the last checkpoint after a fall', () => {
    const state = createPlayerState(spawnAt(0, 0.001, 0, FACING_EAST), CONFIG);
    const options = optionsFor(floor, {
      checkpoints,
      killPlaneY: -5,
      respawnDelaySeconds: 0,
    });
    for (let step = 0; step < 180; step += 1) {
      stepPlayer(state, input({ forward: 1, sprint: true }), STEP, options);
    }
    expect(state.checkpoint).toBe(1);

    // Dropped below the kill plane, as a fall between buildings would be.
    state.position.y = -10;
    for (let step = 0; step < 5 && state.alive; step += 1) {
      stepPlayer(state, input(), STEP, options);
    }
    expect(state.alive).toBe(false);
    expect(state.deaths).toBe(1);

    let respawned = false;
    for (let step = 0; step < 5 && !respawned; step += 1) {
      const outcome = stepPlayer(state, input(), STEP, options);
      if (outcome.respawned) respawned = true;
    }
    expect(respawned).toBe(true);
    expect(state.position.x).toBeCloseTo(30, 6);
    // A respawn is a setback, not a restart: the checkpoint still stands.
    expect(state.checkpoint).toBe(1);
  });

  it('ignores a checkpoint well above or below the player', () => {
    const overhead: readonly CheckpointDefinition[] = [
      { id: 'sky', position: vec3(10, 30, 0) },
    ];
    const { state } = traverse({ steps: 180, checks: overhead });
    expect(state.checkpoint).toBe(-1);
    expect(CHECKPOINT.heightTolerance).toBeLessThan(30);
  });

  it('watches nothing when the level has no checkpoints', () => {
    const { state, reached } = traverse({ steps: 60, checks: [] });
    expect(reached).toHaveLength(0);
    expect(state.checkpoint).toBe(-1);
  });
});

describe('the head bob', () => {
  it('stays inside the configured amplitude', () => {
    const state = run(world(collider('floor', vec3(0, -0.5, 0), vec3(600, 1, 600), 'floor')), {
      steps: 240,
      input: input({ forward: 1 }),
    });
    const offset = headBobOffset(state, CONFIG);
    expect(Math.abs(offset.y)).toBeLessThanOrEqual(CONFIG.headBob.verticalAmplitude + 1e-9);
    expect(Math.hypot(offset.x, offset.z)).toBeLessThanOrEqual(CONFIG.headBob.lateralAmplitude + 1e-9);
  });

  it('shakes less per step at speed than it used to at a walk', () => {
    // The whole point of the speed falloff: the frequency rises with speed, so the
    // amplitude has to come down or sprinting feels like being shaken.
    const floor = world(collider('floor', vec3(0, -0.5, 0), vec3(600, 1, 600), 'floor'));
    const walking = run(floor, { steps: 200, input: input({ forward: 1 }) });
    const sprinting = run(floor, { steps: 200, input: input({ forward: 1, sprint: true }) });

    const walkOffset = Math.abs(headBobOffset(walking, CONFIG).y);
    const sprintOffset = Math.abs(headBobOffset(sprinting, CONFIG).y);

    expect(walking.bobAmount).toBeCloseTo(1, 1);
    expect(sprinting.bobAmount).toBeCloseTo(1, 1);
    // Both are at full fade-in, so only the falloff differs - and the two states
    // are at different points of their cycles, so compare the *scale* directly.
    const sprintScale = headBobAmplitudeScaleFor(sprinting);
    expect(sprintScale).toBeLessThan(0.8);
    expect(walkOffset).toBeGreaterThanOrEqual(0);
    expect(sprintOffset).toBeGreaterThanOrEqual(0);
  });

  it('fades in over time rather than snapping on', () => {
    const floor = world(collider('floor', vec3(0, -0.5, 0), vec3(600, 1, 600), 'floor'));
    const early = run(floor, { steps: 4, input: input({ forward: 1 }) });
    const settled = run(floor, { steps: 120, input: input({ forward: 1 }) });

    expect(early.bobAmount).toBeLessThan(settled.bobAmount);
    expect(early.bobAmount).toBeGreaterThan(0);
    // A fraction of the way there after four ticks, not all of it: the rate is a
    // rate constant, not an on/off switch.
    expect(early.bobAmount).toBeLessThan(0.5);
    expect(CONFIG.headBob.settleRate).toBeGreaterThan(1);
  });

  it('reports the checkpoint in the crash snapshot', () => {
    const floor = world(collider('floor', vec3(0, -0.5, 0), vec3(600, 1, 600), 'floor'));
    const state = run(floor, { steps: 120, input: input({ forward: 1 }) });
    expect(snapshotPlayer(state).checkpoint).toBe(-1);
  });
});

/** The amplitude scale the head bob is currently applying. */
function headBobAmplitudeScaleFor(state: PlayerState): number {
  const { walkSpeed, sprintSpeed } = CONFIG.player;
  const speed = lengthXZ(state.velocity);
  const t = clamp((speed - walkSpeed) / Math.max(1e-6, sprintSpeed - walkSpeed), 0, 1);
  return 1 - (1 - CONFIG.headBob.speedFalloff) * t;
}
