/**
 * Turns a `LevelDefinition` into a collision world, and validates it.
 *
 * Validation runs at start-up and in the test suite: a level whose colliders
 * are too thin to catch the player, whose spawn point starts inside geometry, or
 * whose kill plane would execute the player on sight would otherwise fail in
 * confusing ways at runtime.
 */

import { aabbFromCenterSize, minThickness, overlaps, type AABB } from '../physics/aabb.js';
import { CollisionWorld, type Collider } from '../physics/collision.js';
import type { LevelDefinition, PropDefinition } from './levelData.js';

/** Player dimensions, used for spawn validation. */
export interface PlayerSize {
  /** Half-width of the player box. */
  readonly radius: number;
  /** Height of the player box. Validation uses the *standing* height. */
  readonly height: number;
}

export interface BuildLevelOptions {
  /** Passed through to `CollisionWorld`; also used to validate thickness. */
  maxSubStep?: number;
  /** Player dimensions used to validate the spawn point. */
  player?: PlayerSize;
}

export interface LevelProblem {
  readonly level: string;
  readonly prop?: string;
  readonly message: string;
}

export interface BuiltLevel {
  readonly definition: LevelDefinition;
  readonly colliders: readonly Collider[];
  readonly world: CollisionWorld;
}

export const DEFAULT_PLAYER_SIZE: PlayerSize = { radius: 0.35, height: 1.8 };

/** How far above the nearest surface the spawn point may sit. */
const MAX_SPAWN_DROP = 3;

/** Minimum gap between a walkable surface and the kill plane. */
const MIN_KILL_PLANE_CLEARANCE = 1;

/** Collision box of a prop definition. */
export function propBounds(prop: PropDefinition): AABB {
  return aabbFromCenterSize(prop.position, prop.size);
}

/** Collision box the player would occupy at the level's spawn point. */
export function spawnBounds(definition: LevelDefinition, player: PlayerSize): AABB {
  const { x, y, z } = definition.spawn.position;
  return {
    min: { x: x - player.radius, y, z: z - player.radius },
    max: { x: x + player.radius, y: y + player.height, z: z + player.radius },
  };
}

export function toColliders(definition: LevelDefinition): Collider[] {
  return definition.props.map((prop) => ({
    id: prop.id,
    kind: prop.kind,
    box: propBounds(prop),
  }));
}

/**
 * Highest solid surface directly under `point`, ignoring everything above it.
 *
 * @returns the surface Y, or `null` when there is nothing underneath.
 */
export function groundHeightAt(
  definition: LevelDefinition,
  point: { x: number; z: number },
  fromY = Number.POSITIVE_INFINITY,
): number | null {
  let best: number | null = null;

  for (const prop of definition.props) {
    const box = propBounds(prop);
    if (point.x < box.min.x || point.x > box.max.x) continue;
    if (point.z < box.min.z || point.z > box.max.z) continue;
    if (box.max.y > fromY) continue;
    if (best === null || box.max.y > best) best = box.max.y;
  }

  return best;
}

/**
 * Checks the level for authoring mistakes.
 *
 * @returns an empty array when the level is sound.
 */
export function validateLevel(
  definition: LevelDefinition,
  options: BuildLevelOptions = {},
): LevelProblem[] {
  const problems: LevelProblem[] = [];
  const level = definition.id;
  const maxSubStep = options.maxSubStep ?? 0.2;
  const player = options.player ?? DEFAULT_PLAYER_SIZE;
  const add = (message: string, prop?: string): void => {
    problems.push(prop === undefined ? { level, message } : { level, prop, message });
  };

  if (definition.props.length === 0) add('level has no props');

  const seen = new Set<string>();
  for (const prop of definition.props) {
    if (seen.has(prop.id)) add(`duplicate prop id "${prop.id}"`, prop.id);
    seen.add(prop.id);

    for (const axis of ['x', 'y', 'z'] as const) {
      if (!(prop.size[axis] > 0)) add(`size.${axis} must be > 0`, prop.id);
    }

    // The solver advances at most `maxSubStep` metres before re-testing; a
    // collider thinner than that could be stepped straight through.
    const thin = minThickness(propBounds(prop));
    if (Number.isFinite(thin) && thin < maxSubStep) {
      add(
        `thinnest extent is ${thin.toFixed(3)}m, below the ${maxSubStep}m collision sub-step ` +
          '(thicken the geometry or lower the sub-step)',
        prop.id,
      );
    }
  }

  // Spawn sanity: the player must not start inside geometry.
  const box = spawnBounds(definition, player);
  for (const prop of definition.props) {
    if (overlaps(box, propBounds(prop))) {
      add(`spawn point intersects prop "${prop.id}"`, prop.id);
    }
  }

  // ...and must start on top of something, not in mid-air over the city.
  const spawn = definition.spawn.position;
  const surface = groundHeightAt(definition, { x: spawn.x, z: spawn.z });
  if (surface === null) {
    add('spawn point has no surface beneath it');
  } else {
    const drop = spawn.y - surface;
    if (drop > MAX_SPAWN_DROP) {
      add(`spawn point is ${drop.toFixed(2)}m above the surface below it (max ${MAX_SPAWN_DROP}m)`);
    }
  }

  // Fall detection must not execute the player the moment they spawn, and must
  // leave room to actually fall before it triggers.
  if (!Number.isFinite(definition.killPlaneY)) {
    add('killPlaneY must be a finite number');
  } else {
    if (definition.killPlaneY >= spawn.y) {
      add(`killPlaneY (${definition.killPlaneY}) is not below the spawn point (${spawn.y})`);
    }
    if (surface !== null && definition.killPlaneY > surface - MIN_KILL_PLANE_CLEARANCE) {
      add(
        `killPlaneY (${definition.killPlaneY}) is within ${MIN_KILL_PLANE_CLEARANCE}m of the ` +
          `walkable surface (${surface})`,
      );
    }
  }

  problems.push(...validateEnvironment(definition, add));

  return problems;
}

function validateEnvironment(
  definition: LevelDefinition,
  add: (message: string) => void,
): LevelProblem[] {
  const problems: LevelProblem[] = [];
  const environment = definition.environment;

  for (const [name, color] of [
    ['skyColor', environment.skyColor],
    ['fogColor', environment.fogColor],
    ['sunColor', environment.sunColor],
    ['ambientSkyColor', environment.ambientSkyColor],
    ['ambientGroundColor', environment.ambientGroundColor],
  ] as const) {
    if (!/^#[0-9a-f]{6}$/i.test(color)) add(`environment.${name} must be a #rrggbb colour`);
  }

  if (environment.fogFar <= environment.fogNear) {
    add('environment.fogFar must be greater than fogNear');
  }

  if (!(environment.skyRadius > 0)) add('environment.skyRadius must be > 0');

  const backdrop = environment.backdrop;
  if (!(backdrop.radius > 0)) add('environment.backdrop.radius must be > 0');
  if (!(backdrop.height > 0)) add('environment.backdrop.height must be > 0');
  if (!(backdrop.repeat > 0)) add('environment.backdrop.repeat must be > 0');
  if (backdrop.radius >= environment.skyRadius) {
    add('environment.backdrop.radius must be smaller than skyRadius, or it would be clipped');
  }
  if (backdrop.radius <= environment.fogNear) {
    add('environment.backdrop.radius should be beyond fogNear, or the skyline is invisible');
  }

  return problems;
}

/** Builds the collision world, throwing when the level fails validation. */
export function buildLevel(
  definition: LevelDefinition,
  options: BuildLevelOptions = {},
): BuiltLevel {
  const problems = validateLevel(definition, options);
  if (problems.length > 0) {
    throw new Error(
      `Invalid level "${definition.id}":\n${problems
        .map((problem) => ` - ${problem.prop ? `[${problem.prop}] ` : ''}${problem.message}`)
        .join('\n')}`,
    );
  }

  const colliders = toColliders(definition);
  const world = new CollisionWorld(colliders, {
    ...(options.maxSubStep === undefined ? {} : { maxSubStep: options.maxSubStep }),
  });

  return { definition, colliders, world };
}
