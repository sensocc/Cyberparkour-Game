/**
 * Declarative definition of the V0.4 demo district.
 *
 * Keeping the level as plain data (rather than as three.js objects) means it
 * can be validated, collision-tested and rendered from a single source of
 * truth.
 *
 * Coordinate conventions
 *  - Y is up, and the **top surface of the roof deck is Y = 0**, so a prop's
 *    `position` is the centre of a box whose underside usually rests on it.
 *  - `position` is the centre of a box, `size` its full extents.
 *  - The player spawns at `spawn.position`, which is the position of their
 *    feet (centre of the bottom face).
 */

import type { ReadonlyVec3 } from '../../core/vec3.js';
import type { ColliderKind } from '../physics/collision.js';

/**
 * Imported GLTF prop models, drawn by the renderer instead of box parts.
 *
 * The level references them by id; the renderer owns the files and the loading.
 * They are decoration - rooftop and street clutter - and never carry collision.
 */
export type GltfPropModelId =
  | 'ac'
  | 'ac-side'
  | 'antenna-1'
  | 'antenna-2'
  | 'cable-small'
  | 'computer'
  | 'door'
  | 'fence'
  | 'light-square'
  | 'water-tower'
  | 'solar-flat'
  | 'solar-landscape'
  | 'chimney-small'
  | 'chimney-medium'
  | 'detail-tank'
  | 'windmill-low'
  | 'container-a'
  | 'dumpster'
  | 'street-light'
  | 'pole-single'
  | 'barrier'
  | 'npc-a'
  | 'npc-b';

export interface PropDefinition {
  readonly id: string;
  /** Which model in the model library this prop is an instance of. */
  readonly model: string;
  /** Collision tag. */
  readonly kind: ColliderKind;
  /** Centre of the box in world units. */
  readonly position: ReadonlyVec3;
  /** Full extents (width, height, depth). */
  readonly size: ReadonlyVec3;
  /**
   * Surfaces this instance recolours, keyed by surface id. Lets one model serve
   * several different-looking props without duplicating its parts.
   */
  readonly tints?: Readonly<Record<string, string>>;
  /** Whether the player can climb this prop's face. */
  readonly climbable?: boolean;
  /**
   * What the prop's collider is.
   *
   * `box` - the default - is one box around the whole prop, which is right for a slab and wrong
   * for anything with air in it. A tower crane is a lattice mast, a jib and a counterweight inside
   * a fifty-metre bounding box, and a box collider makes the air between them solid: the parts
   * collide with `parts`, and `none` is for a prop that is decoration.
   */
  readonly collide?: 'box' | 'parts' | 'none';
  /**
   * Whether this prop is a *pipe* the player can climb up and down.
   *
   * Separate from `climbable` because a pipe is two-way: a face is only ever
   * ascended, a pipe is also descended and slid down.
   */
  readonly pipe?: boolean;
  readonly castShadow?: boolean;
  readonly receiveShadow?: boolean;
  /**
   * An imported GLTF model drawn instead of the box parts.
   *
   * `model` is the renderer's prop library; `scale` is uniform. The prop still
   * carries a box `model` and `size`, so a scene without the model loaded (a
   * test, a failed fetch) falls back to ordinary box parts. The collider is the
   * prop's own box, like any other prop - decorations pass `collide: 'none'`.
   */
  readonly gltf?: {
    readonly model: GltfPropModelId;
    readonly scale: number;
    /** Rotation around Y, in radians. */
    readonly yaw?: number;
  };
}



export interface NpcDefinition {
  readonly id: string;
  readonly position: ReadonlyVec3;
  /** How close the player has to be to be offered a word. */
  readonly reach: number;
  /** What to call it on screen. */
  readonly name: string;
}

/**
 * A time trial: through the first gate to reach the second.
 *
 * `starTimes` are seconds for one, two and three stars, in that order - so a trial is a route with
 * a pace to it rather than a checkpoint, and the fastest way is rarely the safest.
 */
export interface TrialDefinition {
  readonly id: string;
  readonly from: ReadonlyVec3;
  readonly to: ReadonlyVec3;
  readonly reach: number;
  readonly starTimes: readonly [number, number, number];
}

export interface SpawnPoint {
  /** Feet position. */
  readonly position: ReadonlyVec3;
  /** Facing, in radians. 0 looks down -Z. */
  readonly yaw: number;
  /** Initial camera pitch, in radians. */
  readonly pitch: number;
}

/**
 * A point the player resumes from once they have reached it.
 *
 * Checkpoints are what make a long, dangerous route playable: the district is
 * crossed by falling, and without them a single mistake would cost the whole
 * traverse. They are ordered by route, and reaching a later one never downgrades
 * an earlier one.
 */
export interface CheckpointDefinition {
  readonly id: string;
  /** Feet position: the player is placed here on respawn. */
  readonly position: ReadonlyVec3;
  /** Facing on respawn, in radians. Defaults to the level spawn's yaw. */
  readonly yaw?: number;
}

/**
 * A point light in the level.
 *
 * V0.4 needs these for interiors: the sun and the hemisphere light do not reach
 * inside a building, and a room with no light of its own is a black void. They
 * also let a neon sign throw a little colour onto the wall behind it.
 */
export interface LightDefinition {
  readonly id: string;
  readonly position: ReadonlyVec3;
  readonly color: string;
  readonly intensity: number;
  /** How far the light carries, in metres. */
  readonly distance: number;
}

/**
 * A door: a panel that swings open on a vertical hinge.
 *
 * The closed panel is a collider; an open one is not. That is the whole
 * mechanism - `CollisionWorld` can switch a collider off, and the door swings its
 * mesh to match.
 */
export interface DoorDefinition {
  readonly id: string;
  /** Centre of the closed panel. */
  readonly position: ReadonlyVec3;
  /** Full extents of the panel. */
  readonly size: ReadonlyVec3;
  /** The vertical edge the door turns about. */
  readonly hinge: 'x-' | 'x+' | 'z-' | 'z+';
  /** How far it swings, in radians. Signed, so a door can open inward or out. */
  readonly openAngle: number;
  /** Whether the door starts open. */
  readonly open?: boolean;
}

/**
 * An elevator: a car in a shaft, serving the floors of a building.
 *
 * V0.7 replaced V0.5's platform - a slab that cycled up and down on a timer - with
 * these. The shape of the data is what the difference is: a platform has a `lowTop`
 * and a `highTop` and goes between them for ever, and an elevator has a *list of
 * floors* and goes where it is sent.
 *
 * The car, and one gate per floor, are props in the level like any other, and the
 * names are a contract: the car is `<id>`, and the gates are `<id>-gate-0`, `-1`, and
 * so on, one per entry in `floors`, lowest first. The system moves them.
 */
export interface ElevatorDefinition {
  readonly id: string;
  /** Centre of the car on X/Z. */
  readonly at: readonly [number, number];
  /** Footprint of the car (X by Z). */
  readonly size: readonly [number, number];
  /** Thickness of the car floor (m). The mesh and the collider must agree. */
  readonly thickness: number;
  /**
   * The floors it serves, in metres, lowest first.
   *
   * Each is the Y of a walkable surface the car's floor sits flush with when it is
   * docked there, so stepping out is a step and not a drop.
   */
  readonly floors: readonly number[];
  /** The floor it starts on, as an index into `floors`. */
  readonly start?: number;
  /** What each floor is called, low to high, for the in-car display. */
  readonly names?: readonly string[];
  /**
   * Which way the openings face, so the shaft knows where its doorways are.
   *
   * Not used by the car itself - the gate props are placed by the level - but it is
   * what tells the builder which walls to leave a hole in.
   */
  readonly facing?: 'x+' | 'x-' | 'z+' | 'z-';
}

/**
 * The suffixes a lift's gate prop ids may carry.
 *
 * A floor can open on two sides of a tower, and both shutters are the same opening seen from two
 * directions. The physics and the renderer both enumerate these suffixes when they look a gate up,
 * and they must agree - or one side of a doorway stays shut while its collider opens.
 */
export const GATE_FACE_SUFFIXES: readonly string[] = ['', '-back'];

/** A pickup: a thing to collect on the way, and part of the run's score. */
export interface CollectibleDefinition {
  readonly id: string;
  readonly position: ReadonlyVec3;
}

/**
 * The finishing line.
 *
 * It is only *armed* once the route has been completed - see `RunState` - so a
 * level cannot be finished by standing on the goal at the start.
 */
export interface GoalDefinition {
  readonly id: string;
  readonly position: ReadonlyVec3;
}

/**
 * A drifting plume of smoke, drawn as camera-facing sprites.
 *
 * Purely visual, so it lives entirely in the renderer; the level only says where
 * the plumes are and how they behave.
 */
export interface SmokeDefinition {
  readonly id: string;
  /** Centre of the plume's base. */
  readonly position: ReadonlyVec3;
  /** Radius of the plume (m). */
  readonly radius: number;
  /** How high the plume climbs before it fades (m). */
  readonly rise: number;
  /** How far it wanders sideways (m). */
  readonly drift: number;
  /** Seconds for one puff to complete its climb. */
  readonly period: number;
  /** How opaque the plume is at its thickest, 0 to 1. */
  readonly opacity: number;
  /** How many sprites make up the plume. */
  readonly count: number;
}

export interface BackdropDefinition {
  /** Radius of the cylinder the city skyline is painted on. */
  readonly radius: number;
  /** Height of that cylinder, in metres. */
  readonly height: number;
  /** Y of the skyline's ground line. */
  readonly baseY: number;
  /** How many times the skyline texture wraps around. */
  readonly repeat: number;
}

export interface EnvironmentDefinition {
  /** Flat colour used for the sky when the gradient texture is unavailable. */
  readonly skyColor: string;
  readonly fogColor: string;
  readonly fogNear: number;
  readonly fogFar: number;
  readonly ambientSkyColor: string;
  readonly ambientGroundColor: string;
  readonly ambientIntensity: number;
  readonly sunColor: string;
  readonly sunIntensity: number;
  /** Direction the sunlight travels *from*, as a ratio of the Y axis. */
  readonly sunDirection: ReadonlyVec3;
  readonly backdrop: BackdropDefinition;
}

export interface LevelDefinition {
  readonly id: string;
  readonly name: string;
  readonly spawn: SpawnPoint;
  /**
   * Fall detection threshold: if the player's feet reach this Y or below they
   * have fallen off the level and die. Must sit below the walkable surface and
   * above the world's emergency floor.
   */
  readonly killPlaneY: number;
  readonly environment: EnvironmentDefinition;
  readonly props: readonly PropDefinition[];
  readonly checkpoints: readonly CheckpointDefinition[];
  /** Doors in the level. Absent means a level with no doors. */
  readonly doors?: readonly DoorDefinition[];
  /** Point lights placed in the level. Absent means none. */
  readonly lights?: readonly LightDefinition[];
  /** Lifts. Absent means a level with none. */
  readonly elevators?: readonly ElevatorDefinition[];
  /** Pickups along the route. */
  readonly collectibles?: readonly CollectibleDefinition[];
  /** The finishing line. Absent means the level cannot be completed. */
  readonly goal?: GoalDefinition;
  /**
   * Somebody to talk to, who gives the run its shape.
   *
   * The alley cat. Nothing may be picked up until the player has found it and been asked to: a
   * quest you can finish before you are given it is not a quest, and eight shards scattered over a
   * kilometre are not findable on purpose. The finish is the *return* to this position.
   */
  readonly npc?: NpcDefinition;
  /** Time trials: a gate to walk through, and a gate to reach. */
  readonly trials?: readonly TrialDefinition[];
  /** Smoke plumes. Visual only. */
  readonly smoke?: readonly SmokeDefinition[];
}

// ---------------------------------------------------------------- authoring

export interface BoxSpec {
  /** Centre on X/Z; the top-level position is derived from `bottom` and `size`. */
  readonly at: readonly [number, number];
  /** Y of the prop's underside. Defaults to 0, i.e. resting on the deck. */
  readonly bottom?: number;
  readonly size: readonly [number, number, number];
  readonly kind?: ColliderKind;
  readonly model?: string;
  readonly tints?: Readonly<Record<string, string>>;
  readonly climbable?: boolean;
  readonly pipe?: boolean;
  readonly receiveShadow?: boolean;
}

/** Terse prop authoring: `bottom` and `size` in, a centred box out. */
export function box(id: string, spec: BoxSpec): PropDefinition {
  const [x, z] = spec.at;
  const [sx, sy, sz] = spec.size;
  const bottom = spec.bottom ?? 0;

  return {
    id,
    model: spec.model ?? 'slab',
    kind: spec.kind ?? 'prop',
    position: { x, y: bottom + sy / 2, z },
    size: { x: sx, y: sy, z: sz },
    ...(spec.tints ? { tints: spec.tints } : {}),
    ...(spec.climbable ? { climbable: true } : {}),
    ...(spec.pipe ? { pipe: true } : {}),
    ...(spec.receiveShadow === undefined ? {} : { receiveShadow: spec.receiveShadow }),
  };
}


/**
 * A lift tower, built in full: the shaft, a doorway and a gate at every floor below the
 * top, the car to go in it, and the roof it opens onto.
 *
 * V0.5's lift was two floors and a footprint; V0.7's is a building. The difference is
 * not decoration - it is that this one has a *doorway on every floor*, and a gate on
 * each doorway that is only open when the car is docked there. That is what makes it a
 * lift you use rather than a platform you happen to be standing on.
 *
 * Three details are worth knowing before changing anything here:
 *
 *  - **The top floor has no gate.** The shaft's walls stop just under the roof, so the
 *    car arrives in the open air at roof level and stepping out of it is stepping onto
 *    the roof. A gate up there would be a gate for nothing.
 *  - **The roof is a ring.** Four slabs round the shaft's footprint rather than one big
 *    deck, because a deck across the whole tower would bury the car in itself on the
 *    last half-metre of its travel - and because a roof with a lift shaft coming up
 *    through it is what the top of a building looks like.
 *  - **Everything is derived from the floors**, so an opening lines up with the car at
 *    every level by construction rather than by four numbers agreeing.
 */
export function liftTower(spec: {
  readonly id: string;
  /** Centre of the car on X/Z. */
  readonly at: readonly [number, number];
  /** Footprint of the car. The shaft is this plus a wall on every side. */
  readonly size: readonly [number, number];
  /** Floors served, lowest first. The top one is the roof. */
  readonly floors: readonly number[];
  readonly names?: readonly string[];
  /** Which side the doorways are on. */
  readonly facing: 'x+' | 'x-' | 'z+' | 'z-';
  /**
   * A second side to put doorways on.
   *
   * For a tower whose floors are on opposite sides of it: one shaft, two ways out of
   * every floor, and both gates open together because there is one car behind them.
   */
  readonly alsoFacing?: 'x+' | 'x-' | 'z+' | 'z-';
  /** Where the tower's solid body starts, below the lowest floor. */
  readonly base: number;
  readonly tint?: string;
  readonly tintDark?: string;
  /** Wall thickness. Thick enough for a doorway to read as a doorway. */
  readonly wall?: number;
}): { readonly props: PropDefinition[]; readonly elevator: ElevatorDefinition } {
  const [cx, cz] = spec.at;
  const [carWidth, carDepth] = spec.size;
  const wall = spec.wall ?? 0.4;
  /** One storey: how tall a doorway is, and how far apart the floors can be. */
  const opening = 2.5;
  /** How far below the lowest floor the shaft's floor sits. */
  const pit = 0.9;
  /** The roof slab's own thickness. */
  const cap = 0.9;

  const floors = spec.floors;
  const lowest = floors[0] as number;
  const top = floors[floors.length - 1] as number;
  /** The shaft's walls stop here, so the car arrives at roof level in the open. */
  const wallTop = top - cap;
  const outerWidth = carWidth + wall * 2;
  const outerDepth = carDepth + wall * 2;
  const bottom = lowest - pit;

  const tints = {
    concrete: spec.tint ?? '#5f6874',
    'concrete-dark': spec.tintDark ?? '#4d5560',
    metal: '#77808d',
    'metal-dark': '#454e5c',
  };
  const props: PropDefinition[] = [];
  const panel = (
    id: string,
    x: number,
    z: number,
    size: readonly [number, number, number],
    bottomY: number,
  ): void => {
    props.push(box(`${spec.id}-${id}`, { at: [x, z], bottom: bottomY, size, kind: 'wall', model: 'slab', tints }));
  };

  // ---- the body: a pillar from wherever the tower stands, up to the shaft's floor
  const pillar = lowest - spec.base - pit;
  if (pillar > 0.05) {
    panel('body', cx, cz, [outerWidth - 0.7, pillar, outerDepth - 0.7], spec.base);
  }

  // ---- the shaft: solid sides, and doorways cut into one or two of them
  //
  // The two walls that run the full depth are the ones the others fit *between*: two
  // panels that both spanned the whole footprint would put their outer faces on the same
  // plane at every corner, and a corner drawn twice at one depth is a flickering seam.
  const sideX = outerWidth / 2 - wall / 2;
  const sideZ = outerDepth / 2 - wall / 2;
  const height = wallTop - bottom;
  const onZ = spec.facing === 'z+' || spec.facing === 'z-';
  if (onZ) {
    panel('wall-w', cx - sideX, cz, [wall, height, outerDepth], bottom);
    panel('wall-e', cx + sideX, cz, [wall, height, outerDepth], bottom);
  } else {
    panel('wall-n', cx, cz - sideZ, [outerWidth, height, wall], bottom);
    panel('wall-s', cx, cz + sideZ, [outerWidth, height, wall], bottom);
  }
  // A doorway panel sits *inside* the two side walls rather than overlapping them, or
  // its faces land on theirs and the corners flicker.
  const pierWidth = outerWidth - wall * 2;
  const pierDepth = outerDepth - wall * 2;

  /**
   * The sides that carry doorways.
   *
   * A lift in a building serves floors on *different* sides of it: the east tower's
   * service level opens south onto the works deck and its home roof opens north onto the
   * old town. A shaft with one doorway would have a floor nobody could walk out of, so a
   * tower may name a second side, and both of a floor's gates open together - there is
   * one car behind them.
   */
  const faces = [
    { key: '', facing: spec.facing },
    ...(spec.alsoFacing ? [{ key: '-back', facing: spec.alsoFacing }] : []),
  ];

  /** The wall bands on a doorway side: everything that is not a doorway. */
  const bands: number[] = [bottom];
  for (const floor of floors) {
    bands.push(floor);
    bands.push(floor + opening);
  }

  for (const face of faces) {
    const alongZ = face.facing === 'z+' || face.facing === 'z-';
    const atX = alongZ ? cx : cx + (face.facing === 'x+' ? sideX : -sideX);
    const atZ = alongZ ? cz + (face.facing === 'z+' ? sideZ : -sideZ) : cz;

    for (let index = 0; index < bands.length - 1; index += 1) {
      const from = bands[index] as number;
      const to = Math.min(bands[index + 1] as number, wallTop);
      if (to - from < 0.05) continue;
      if (floors.some((floor) => Math.abs(from - floor) < 1e-6)) continue;
      panel(
        `${alongZ ? 'pier' : 'pierx'}-${index}${face.key}`,
        atX,
        atZ,
        alongZ ? [pierWidth, to - from, wall] : [wall, to - from, pierDepth],
        from,
      );
    }

    // ---- a shutter for every doorway, which is every floor but the roof
    for (let index = 0; index < floors.length - 1; index += 1) {
      const floor = floors[index] as number;
      props.push(
        box(`${spec.id}-gate-${index}${face.key}`, {
          at: [atX, atZ],
          bottom: floor,
          size: alongZ ? [carWidth + 0.1, opening, 0.22] : [0.22, opening, carDepth + 0.1],
          kind: 'wall',
          model: 'elevator-gate',
          tints,
        }),
      );
    }
  }

  // ---- the roof: four slabs round the shaft, resting on the walls below
  const clearHalfX = outerWidth / 2;
  const clearHalfZ = outerDepth / 2;
  /** How far the roof reaches past the shaft. */
  const lip = 1.6;
  // Each cap reaches *into* the wall below it, so the two overlap in plan and the roof
  // is resting on something. Its outer faces then sit a wall's thickness inside the
  // shaft's own, which is also what keeps the two off each other's planes.
  // The caps are a frame the same way the walls are: the two that run the full depth
  // of the ring, and two that fit between them. Each reaches half a wall's thickness
  // *inwards*, so the roof rests on the shaft rather than beside it.
  const capReach = lip + wall / 2;
  panel('cap-w', cx - clearHalfX - (lip - wall) / 2, cz, [capReach, cap, outerDepth + lip * 2], wallTop);
  panel('cap-e', cx + clearHalfX + (lip - wall) / 2, cz, [capReach, cap, outerDepth + lip * 2], wallTop);
  panel('cap-n', cx, cz - clearHalfZ - (lip - wall) / 2, [outerWidth - wall, cap, capReach], wallTop);
  panel('cap-s', cx, cz + clearHalfZ + (lip - wall) / 2, [outerWidth - wall, cap, capReach], wallTop);
  // No parapet. Every roof in this game is bare at its edges - V0.0 walled them in
  // because a fall had no consequence, and fall damage, respawn and checkpoints all
  // exist now, so the drop *is* the obstacle. A rail here would be a railing round the
  // best thing about being up here.

  return {
    props,
    elevator: {
      id: spec.id,
      at: spec.at,
      size: spec.size,
      thickness: 0.6,
      floors,
      ...(spec.names ? { names: spec.names } : {}),
      facing: spec.facing,
    },
  };
}

