/**
 * Turns a `LevelDefinition` into a collision world, and validates it.
 *
 * Validation runs at start-up and in the test suite: a level whose colliders
 * are too thin to catch the player, whose spawn point starts inside geometry, or
 * whose kill plane would execute the player on sight would otherwise fail in
 * confusing ways at runtime.
 */

import { aabbFromCenterSize, minThickness, overlaps, type AABB } from '../physics/aabb.js';
import { CollisionWorld, type Collider, type ColliderKind } from '../physics/collision.js';
import type { LevelDefinition, PropDefinition } from './levelData.js';
import { modelById, resolveModelParts, topSurface, type ResolvedPart } from './models.js';
import { acousticForSurface, surfaceById } from './surfaces.js';

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

/**
 * The prop's model parts, in world space.
 *
 * Collision uses the prop's own box; these are the meshes. Throws for an unknown
 * model, which validation catches first.
 */
export function resolvePropParts(prop: PropDefinition): ResolvedPart[] {
  const model = modelById(prop.model);
  if (!model) throw new RangeError(`prop "${prop.id}" references unknown model "${prop.model}"`);
  return resolveModelParts(model, propBounds(prop).min, prop.size);
}

/**
 * Colliders for a level.
 *
 * One collider per prop, from the prop's box: the model parts are surface
 * detail, and a box is the right approximation for all of them.
 *
 * Each collider also carries the prop's **footstep surface** - the acoustic
 * material of the model's topmost part - so the audio can tell a metal deck from
 * a concrete roof without the physics layer knowing what a surface is.
 */
export function toColliders(definition: LevelDefinition): Collider[] {
  const colliders: Collider[] = definition.props.map((prop) => {
    const model = modelById(prop.model);
    const acoustic = model ? acousticForSurface(topSurface(model) ?? '') : undefined;

    return {
      id: prop.id,
      kind: colliderKindFor(prop),
      box: propBounds(prop),
      ...(acoustic ? { surface: acoustic } : {}),
    };
  });

  // Doors are colliders too, but they are not props: they have no model parts of
  // their own (the scene builder swings the leaf) and the game may switch them
  // off. A panel is metal, so a footstep on a closed one rings.
  for (const door of definition.doors ?? []) {
    colliders.push({
      id: door.id,
      kind: 'door',
      box: aabbFromCenterSize(door.position, door.size),
      surface: 'metal',
    });
  }

  // A lift is a floor that moves. It starts at the bottom of its travel; the
  // elevator system rewrites the box from there.
  for (const elevator of definition.elevators ?? []) {
    colliders.push({
      id: elevator.id,
      kind: 'floor',
      box: aabbFromCenterSize(
        { x: elevator.at[0], y: elevator.lowTop - elevator.thickness / 2, z: elevator.at[1] },
        { x: elevator.size[0], y: elevator.thickness, z: elevator.size[1] },
      ),
      surface: 'metal',
    });
  }

  return colliders;
}

/** The collision tag for a prop: pipes and climbables are specialisations. */
export function colliderKindFor(prop: PropDefinition): ColliderKind {
  if (prop.kind === 'door') return 'door';
  if (prop.pipe) return 'pipe';
  if (prop.climbable) return 'climbable';
  return prop.kind;
}

/** Ids of colliders the pipe-climbing ability can use. */
export function pipeIds(colliders: readonly Collider[]): Set<string> {
  return new Set(colliders.filter((collider) => collider.kind === 'pipe').map((c) => c.id));
}

/** Ids of climbable (non-pipe) colliders. */
export function climbableIds(colliders: readonly Collider[]): Set<string> {
  return new Set(colliders.filter((collider) => collider.kind === 'climbable').map((c) => c.id));
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

    if (!modelById(prop.model)) add(`unknown model "${prop.model}"`, prop.id);

    for (const [surfaceId, tint] of Object.entries(prop.tints ?? {})) {
      if (!surfaceById(surfaceId)) add(`tint references unknown surface "${surfaceId}"`, prop.id);
      if (!/^#[0-9a-f]{6}$/i.test(tint)) add(`tint "${surfaceId}" must be a #rrggbb colour`, prop.id);
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

  validateDoors(definition, add, maxSubStep, seen);
  validateLights(definition, add);
  validateElevators(definition, add, maxSubStep, seen);
  validateTriggers(definition, add);

  // Spawn sanity: the player must not start inside geometry.
  const box = spawnBounds(definition, player);
  for (const prop of definition.props) {
    if (overlaps(box, propBounds(prop))) {
      add(`spawn point intersects prop "${prop.id}"`, prop.id);
    }
  }
  for (const door of definition.doors ?? []) {
    if (overlaps(box, aabbFromCenterSize(door.position, door.size))) {
      add(`spawn point intersects door "${door.id}"`, door.id);
    }
  }
  for (const elevator of definition.elevators ?? []) {
    // The whole shaft, not just where the car happens to be: a spawn inside a
    // lift well is a spawn that will be run over by one.
    const span = elevator.highTop - elevator.lowTop + elevator.thickness;
    const shaft = aabbFromCenterSize(
      {
        x: elevator.at[0],
        y: (elevator.lowTop - elevator.thickness + elevator.highTop) / 2,
        z: elevator.at[1],
      },
      { x: elevator.size[0], y: span, z: elevator.size[1] },
    );
    if (overlaps(box, shaft)) {
      add(`spawn point is inside lift "${elevator.id}"'s shaft`, elevator.id);
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

/** The four edges a door may hinge on. */
const DOOR_HINGES: readonly string[] = ['x-', 'x+', 'z-', 'z+'];

/**
 * Doors share the prop id namespace, so a clash is rejected rather than silently
 * shadowed. A door has the same thinness rule as a prop, because the solver has
 * no idea it is a door: it is a box like any other.
 */
function validateDoors(
  definition: LevelDefinition,
  add: (message: string, id?: string) => void,
  maxSubStep: number,
  seenIds: Set<string>,
): void {
  for (const door of definition.doors ?? []) {
    if (seenIds.has(door.id)) add(`duplicate id "${door.id}" (shared with a prop or another door)`, door.id);
    seenIds.add(door.id);

    for (const axis of ['x', 'y', 'z'] as const) {
      if (!(door.size[axis] > 0)) add(`door size.${axis} must be > 0`, door.id);
    }
    if (!DOOR_HINGES.includes(door.hinge)) {
      add(`door hinge "${door.hinge}" must be one of ${DOOR_HINGES.join(' ')}`, door.id);
    }
    if (!Number.isFinite(door.openAngle)) add('door openAngle must be finite', door.id);

    const thin = minThickness(aabbFromCenterSize(door.position, door.size));
    if (Number.isFinite(thin) && thin < maxSubStep) {
      add(
        `door thinnest extent is ${thin.toFixed(3)}m, below the ${maxSubStep}m collision sub-step`,
        door.id,
      );
    }
  }
}

/** Lights are decoration with consequences, so their numbers must make sense. */
function validateLights(
  definition: LevelDefinition,
  add: (message: string, id?: string) => void,
): void {
  const seen = new Set<string>();
  for (const light of definition.lights ?? []) {
    if (seen.has(light.id)) add(`duplicate light id "${light.id}"`, light.id);
    seen.add(light.id);
    if (!/^#[0-9a-f]{6}$/i.test(light.color)) add('light colour must be a #rrggbb colour', light.id);
    if (!(light.intensity > 0)) add('light intensity must be > 0', light.id);
    if (!(light.distance > 0)) add('light distance must be > 0', light.id);
  }
}

/**
 * Lifts share the id namespace and the thinness rule, and have one of their own:
 * the two ends of the travel must actually be apart, or a lift is a floor with
 * delusions of grandeur.
 */
function validateElevators(
  definition: LevelDefinition,
  add: (message: string, id?: string) => void,
  maxSubStep: number,
  seenIds: Set<string>,
): void {
  for (const elevator of definition.elevators ?? []) {
    if (seenIds.has(elevator.id)) {
      add(`duplicate id "${elevator.id}" (shared with a prop, door or lift)`, elevator.id);
    }
    seenIds.add(elevator.id);

    if (!(elevator.size[0] > 0) || !(elevator.size[1] > 0)) {
      add('lift size must be > 0 on both axes', elevator.id);
    }
    if (!(elevator.thickness >= maxSubStep)) {
      add(`lift thickness must be at least the ${maxSubStep}m collision sub-step`, elevator.id);
    }
    if (!(elevator.highTop > elevator.lowTop)) add('lift highTop must be above its lowTop', elevator.id);
    if (elevator.phase !== undefined && !Number.isFinite(elevator.phase)) {
      add('lift phase must be finite', elevator.id);
    }
  }
}

/**
 * Pickups and the finish line: unique ids and finite positions, and nothing
 * else. They are not colliders and not props, so there is nothing more to be
 * wrong with them.
 */
function validateTriggers(
  definition: LevelDefinition,
  add: (message: string, id?: string) => void,
): void {
  const seen = new Set<string>();
  const check = (id: string, at: { readonly x: number; readonly y: number; readonly z: number }, what: string): void => {
    if (seen.has(id)) add(`duplicate id "${id}" (shared by two ${what}s)`, id);
    seen.add(id);
    if (!Number.isFinite(at.x) || !Number.isFinite(at.y) || !Number.isFinite(at.z)) {
      add(`${what} position must be finite`, id);
    }
  };

  for (const pickup of definition.collectibles ?? []) check(pickup.id, pickup.position, 'pickup');
  if (definition.goal) check(definition.goal.id, definition.goal.position, 'goal');
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

  const backdrop = environment.backdrop;
  if (!(backdrop.radius > 0)) add('environment.backdrop.radius must be > 0');
  if (!(backdrop.height > 0)) add('environment.backdrop.height must be > 0');
  if (!(backdrop.repeat > 0)) add('environment.backdrop.repeat must be > 0');
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
