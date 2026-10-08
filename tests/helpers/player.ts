/**
 * Shared scaffolding for the movement suites.
 *
 * The player API grew a lot in V0.2 - a step now needs the manoeuvre, head-bob
 * and fall-damage config as well as the movement config - so tests build their
 * input and options through these helpers instead of spelling it out each time.
 */

import { DEFAULT_CONFIG, fixedStep, type GameConfig } from '../../src/core/config.js';
import { vec3, type Vec3 } from '../../src/core/vec3.js';
import { aabbFromCenterSize } from '../../src/game/physics/aabb.js';
import { CollisionWorld, type Collider } from '../../src/game/physics/collision.js';
import {
  createPlayerState,
  playerHeight,
  stepPlayer,
  type MoveInput,
  type PlayerState,
  type PlayerStepOptions,
} from '../../src/game/player.js';
import type { SpawnPoint } from '../../src/game/level/levelData.js';

export const CONFIG: GameConfig = DEFAULT_CONFIG;
export const STEP = fixedStep(CONFIG);
export const RESPAWN_DELAY = CONFIG.respawn.delaySeconds;

/** A complete movement input, so tests only state what they care about. */
export function input(overrides: Partial<MoveInput> = {}): MoveInput {
  return { forward: 0, right: 0, sprint: false, jump: false, crouch: false, ...overrides };
}

export const STILL = input();
export const FORWARD = input({ forward: 1 });
export const SPRINT = input({ forward: 1, sprint: true });
export const CROUCH = input({ forward: 1, crouch: true });
export const JUMP = input({ jump: true });

export function collider(
  id: string,
  center: Vec3,
  size: Vec3,
  kind: Collider['kind'] = 'prop',
): Collider {
  return { id, kind, box: aabbFromCenterSize(center, size) };
}

export function world(...colliders: Collider[]): CollisionWorld {
  return new CollisionWorld(colliders, { maxSubStep: CONFIG.world.maxCollisionSubStep });
}

/** Ground slab with its top surface at Y = 0, big enough to run on. */
export const FLOOR = collider('floor', vec3(0, -0.5, 0), vec3(600, 1, 600), 'floor');

export function spawnAt(x: number, y: number, z: number, yaw = 0): SpawnPoint {
  return { position: { x, y, z }, yaw, pitch: 0 };
}

/** Facing +X, which is where yaw = -PI/2 points. */
export const FACING_EAST = -Math.PI / 2;

/** A spawn resting exactly on the floor. */
export const ON_DECK = spawnAt(0, 0.001, 0);

export interface RunOptions {
  readonly steps: number;
  readonly input?: MoveInput | ((step: number, state: PlayerState) => MoveInput);
  readonly world?: CollisionWorld;
  readonly spawn?: SpawnPoint;
  readonly killPlaneY?: number;
  readonly respawnDelaySeconds?: number;
  readonly safetyFloorY?: number;
  readonly climbableIds?: ReadonlySet<string>;
  readonly onStep?: (state: PlayerState, step: number) => void;
}

export function optionsFor(
  collisionWorld: CollisionWorld,
  overrides: Partial<PlayerStepOptions> = {},
): PlayerStepOptions {
  return { world: collisionWorld, config: CONFIG.player, game: CONFIG, ...overrides };
}

/** Runs a scripted number of fixed steps and returns the final state. */
export function run(collisionWorld: CollisionWorld, runOptions: RunOptions): PlayerState {
  const state = createPlayerState(runOptions.spawn ?? ON_DECK, CONFIG);
  const source = runOptions.input;
  const inputFor = typeof source === 'function' ? source : () => source ?? STILL;

  const stepOptions = optionsFor(collisionWorld, {
    ...(runOptions.killPlaneY === undefined ? {} : { killPlaneY: runOptions.killPlaneY }),
    ...(runOptions.respawnDelaySeconds === undefined
      ? {}
      : { respawnDelaySeconds: runOptions.respawnDelaySeconds }),
    ...(runOptions.safetyFloorY === undefined ? {} : { safetyFloorY: runOptions.safetyFloorY }),
    ...(runOptions.climbableIds === undefined ? {} : { climbableIds: runOptions.climbableIds }),
  });

  for (let step = 0; step < runOptions.steps; step += 1) {
    stepPlayer(state, inputFor(step, state), STEP, stepOptions);
    runOptions.onStep?.(state, step);
  }
  return state;
}

/** The player's box for its current stance, for overlap assertions. */
export function boxOf(state: PlayerState) {
  const height = playerHeight(state, CONFIG.player);
  return aabbFromCenterSize(
    { x: state.position.x, y: state.position.y + height / 2, z: state.position.z },
    { x: CONFIG.player.radius * 2, y: height, z: CONFIG.player.radius * 2 },
  );
}
