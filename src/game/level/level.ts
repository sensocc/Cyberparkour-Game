/**
 * Turns a `LevelDefinition` into a collision world, and validates it.
 *
 * Validation runs at start-up and in the test suite: a level whose colliders
 * are too thin to catch the player, or whose spawn point starts inside
 * geometry, would otherwise fail in confusing ways at runtime.
 */

import { aabbFromCenterSize, minThickness, overlaps, type AABB } from '../physics/aabb.js';
import { CollisionWorld, type Collider } from '../physics/collision.js';
import type { LevelDefinition, PropDefinition } from './levelData.js';

/** Player dimensions, used for spawn validation. */
export interface PlayerSize {
  readonly radius: number;
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
