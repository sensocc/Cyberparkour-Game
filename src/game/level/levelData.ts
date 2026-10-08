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
   * Whether this prop is a *pipe* the player can climb up and down.
   *
   * Separate from `climbable` because a pipe is two-way: a face is only ever
   * ascended, a pipe is also descended and slid down.
   */
  readonly pipe?: boolean;
  readonly castShadow?: boolean;
  readonly receiveShadow?: boolean;
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
 * A lift: a platform that travels between two heights, carrying whoever is
 * standing on it.
 *
 * Defined by the two *top surface* heights rather than by a position, because
 * that is what matters: a lift's job is to arrive flush with the floor at each
 * end, so the numbers a level author cares about are the two floors.
 */
export interface ElevatorDefinition {
  readonly id: string;
  /** Centre of the platform on X/Z. */
  readonly at: readonly [number, number];
  /** Footprint of the platform (X by Z). */
  readonly size: readonly [number, number];
  /** Thickness of the platform (m). The mesh and the collider must agree. */
  readonly thickness: number;
  /** Y of the platform's top surface at the bottom of its travel. */
  readonly lowTop: number;
  /** Y of the platform's top surface at the top of its travel. */
  readonly highTop: number;
  /** Where it starts, and therefore where the phase is measured from. */
  readonly start?: 'low' | 'high';
  /** Seconds of offset into its cycle, so a bank of lifts is not in lockstep. */
  readonly phase?: number;
}

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
  /** Smoke plumes. Visual only. */
  readonly smoke?: readonly SmokeDefinition[];
}

// ---------------------------------------------------------------- authoring

interface BoxSpec {
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
function box(id: string, spec: BoxSpec): PropDefinition {
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
 * A flight of steps.
 *
 * Steps are separate props rather than one model, because collision is per-prop:
 * a single stair-shaped prop would collide as a solid box and be unclimbable.
 * Individual risers also mean mantling walks the player up automatically.
 */
function steps(
  prefix: string,
  spec: {
    readonly from: readonly [number, number];
    readonly riser: number;
    readonly count: number;
    readonly tread: number;
    /** The axis the flight ascends along. Steps always march in +X or +Z. */
    readonly axis: 'x' | 'z';
    readonly depth: number;
  },
): PropDefinition[] {
  return Array.from({ length: spec.count }, (_unused, index) => {
    const height = spec.riser * (index + 1);
    const distance = (index + 0.5) * spec.tread;
    const at: [number, number] =
      spec.axis === 'x'
        ? [spec.from[0] + distance, spec.from[1]]
        : [spec.from[0], spec.from[1] + distance];

    return box(`${prefix}-${index + 1}`, {
      at,
      size: spec.axis === 'x' ? [spec.tread, height, spec.depth] : [spec.depth, height, spec.tread],
      model: 'block',
      tints: { concrete: '#5f6874', 'concrete-dark': '#4c545e', metal: '#6f7a8a' },
    });
  });
}

/** A checkpoint, with its id derived from its name. */
function checkpoint(id: string, at: readonly [number, number, number], yaw?: number): CheckpointDefinition {
  return { id: `checkpoint-${id}`, position: { x: at[0], y: at[1], z: at[2] }, ...(yaw === undefined ? {} : { yaw }) };
}

/**
 * A lift, as a level author thinks of one: two floors and a footprint.
 *
 * The thickness is the one number that is not about the *idea* of the lift - it
 * is how deep the platform is - so it is filled in here rather than repeated at
 * every call site, and the mesh and the collider are guaranteed to agree.
 */
function lift(spec: {
  readonly id: string;
  readonly at: readonly [number, number];
  readonly size: readonly [number, number];
  readonly lowTop: number;
  readonly highTop: number;
  readonly start?: 'low' | 'high';
  readonly phase?: number;
}): ElevatorDefinition {
  return { ...spec, thickness: 0.6 };
}

/**
 * A roof, as the two props every roof needs: a deck to stand on and a body
 * holding it up over the street.
 *
 * The body is inset by a metre on each side so that neighbouring buildings read as
 * separate blocks with a canyon between them rather than as one mass, which is
 * what makes the gaps legible as gaps.
 */
function roof(spec: {
  readonly id: string;
  readonly at: readonly [number, number];
  readonly size: readonly [number, number];
  readonly top: number;
  readonly bodyTint?: string;
  readonly bodyTintDark?: string;
}): PropDefinition[] {
  const [x, z] = spec.at;
  const [width, depth] = spec.size;
  const deckBottom = spec.top - 0.8;

  return [
    box(spec.id === 'home' ? 'deck' : `${spec.id}-deck`, {
      at: [x, z],
      bottom: deckBottom,
      size: [width, 0.8, depth],
      kind: 'floor',
      model: 'deck',
    }),
    box(`${spec.id}-body`, {
      at: [x, z],
      bottom: -34.8,
      // Up to the underside of the deck, so the two never fight for the surface.
      size: [width - 2, deckBottom + 34.8, depth - 2],
      kind: 'wall',
      model: 'slab',
      tints: {
        concrete: spec.bodyTint ?? '#3b4557',
        'concrete-dark': spec.bodyTintDark ?? '#2f3846',
      },
      receiveShadow: true,
    }),
  ];
}

/**
 * A walk-in interior: four walls, a ceiling, a doorway, and the door in it.
 *
 * The floor is deliberately the deck the room stands on - adding a raised floor
 * would put a lip across the doorway, and a lip is a step the mantle band will
 * not take (its floor is 0.4 m) but a walk into it will not either. So the room
 * is walls and a roof, and the deck is the floor.
 *
 * The doorway wall is split into two segments with a lintel over the gap, because
 * collision is per-prop boxes: a wall with a hole needs two walls and a beam, not
 * a hole.
 */
function room(spec: {
  readonly id: string;
  /** Centre of the room's interior, on X/Z. */
  readonly at: readonly [number, number];
  /** Interior width (X) and depth (Z). */
  readonly size: readonly [number, number];
  /** Y of the floor: the deck top the room stands on. */
  readonly bottom: number;
  /** Interior height, floor to the underside of the ceiling. */
  readonly height: number;
  /** Which wall carries the doorway. Rooms here open to +Z or -Z. */
  readonly entry: 'z+' | 'z-';
  readonly tint?: string;
  readonly tintDark?: string;
}): { readonly props: PropDefinition[]; readonly door: DoorDefinition } {
  const [cx, cz] = spec.at;
  const [width, depth] = spec.size;
  const wall = 0.3;
  const ceiling = 0.25;
  const doorWidth = 1.4;
  const doorHeight = 2.2;
  /** Width of the door jambs, which is what the lintel rests on. */
  const jamb = 0.3;
  const openingHalf = doorWidth / 2 + jamb;
  /** Top of the walls. The roof sits on this, so nothing floats. */
  const top = spec.bottom + spec.height;

  const tints = {
    concrete: spec.tint ?? '#5a636f',
    'concrete-dark': spec.tintDark ?? '#49515c',
    metal: '#77808d',
  };
  const panel = (
    id: string,
    x: number,
    z: number,
    size: readonly [number, number, number],
    bottom: number,
  ): PropDefinition => box(`${spec.id}-${id}`, { at: [x, z], bottom, size, kind: 'wall', model: 'slab', tints });

  const sideX = (width + wall) / 2;
  const sideDepth = depth + wall;
  // The doorway wall is at `depth / 2 + wall / 2` from the centre, and which of
  // the two it is depends on which way the room opens.
  const openingZ = depth / 2 + wall / 2;
  const frontZ = cz + (spec.entry === 'z+' ? openingZ : -openingZ);
  const backZ = cz - (spec.entry === 'z+' ? openingZ : -openingZ);
  const frontSegment = sideX - openingHalf;
  // A small overhang, so the roof reads as a roof and there is a lip to land on
  // when something climbs up the outside.
  const overhang = 0.4;

  const props: PropDefinition[] = [
    panel('wall-w', cx - sideX, cz, [wall, spec.height, sideDepth], spec.bottom),
    panel('wall-e', cx + sideX, cz, [wall, spec.height, sideDepth], spec.bottom),
    panel('wall-back', cx, backZ, [width + wall * 2, spec.height, wall], spec.bottom),
    panel('wall-front-l', cx - openingHalf - frontSegment / 2, frontZ, [frontSegment, spec.height, wall], spec.bottom),
    panel('wall-front-r', cx + openingHalf + frontSegment / 2, frontZ, [frontSegment, spec.height, wall], spec.bottom),
    // The jambs stop at the door head, and the lintel then rests on them - which
    // is both how a real doorway is built and what keeps the level's "nothing
    // floats" rule satisfied, since a lintel supported only by the wall beside it
    // shares no top face with anything.
    panel('jamb-l', cx - doorWidth / 2 - jamb / 2, frontZ, [jamb, doorHeight, wall], spec.bottom),
    panel('jamb-r', cx + doorWidth / 2 + jamb / 2, frontZ, [jamb, doorHeight, wall], spec.bottom),
    panel('lintel', cx, frontZ, [openingHalf * 2, spec.height - doorHeight, wall], spec.bottom + doorHeight),
    // The roof: its top is the room's roof, which is walkable like any other.
    panel('roof', cx, cz, [width + wall * 2 + overhang, ceiling, sideDepth + overhang], top),
  ];

  const door: DoorDefinition = {
    id: `${spec.id}-door`,
    position: { x: cx, y: spec.bottom + doorHeight / 2, z: frontZ },
    size: { x: doorWidth, y: doorHeight, z: wall },
    hinge: 'x-',
    // Swings inward, which is why the sign flips with the wall it is on.
    openAngle: spec.entry === 'z+' ? 2.1 : -2.1,
  };

  return { props, door };
}

/** A neon sign, hung on a wall. The lit face looks along +Z. */
function sign(spec: {
  readonly id: string;
  readonly at: readonly [number, number, number];
  readonly size: readonly [number, number];
  readonly tint: string;
}): PropDefinition {
  return box(spec.id, {
    at: [spec.at[0], spec.at[2]],
    bottom: spec.at[1],
    size: [spec.size[0], spec.size[1], 0.25],
    model: 'neon-sign',
    tints: { neon: spec.tint },
  });
}

/** The two walk-in rooms, so their props and doors are authored together. */
const EAST_ROOM = room({
  id: 'east-room',
  at: [36, -1],
  size: [7, 5],
  bottom: 1.2,
  height: 3.2,
  entry: 'z+',
  tint: '#5f6a76',
  tintDark: '#4b5560',
});

const FAR_ROOM = room({
  id: 'far-room',
  at: [94, -3],
  size: [7, 5],
  bottom: 1.2,
  height: 3,
  entry: 'z+',
  tint: '#59616d',
  tintDark: '#464e59',
});

/**
 * The technical demo's rooftop district.
 *
 * V0.1 was one flat 48 x 40 m deck. V0.2 made it bigger and vertical. V0.3 turns
 * it into a *district*: five furnished roofs with real gaps between them, crossed
 * by the movement abilities rather than by a lift. Nothing here is a corridor -
 * the route is a chain of decisions, and the gaps are the reason each move exists:
 *
 *   home  (0 m)   -- 6 m gap, +1.2 m ---->  east (1.2 m)   the warm-up
 *   home  (0 m)   -- 6 m gap, +2.0 m ---->  annex (2.0 m)  jump and grab
 *   east  (1.2 m) -- 6 m gap, +2.4 m ---->  high (3.6 m)   jump, grab, haul up
 *   high  (3.6 m) -- 12 m canyon ------>   far (1.2 m)     wall run, or the beam
 *
 * The 12 m canyon is wider than a sprint jump can clear (about 6.4 m at the
 * configured gravity and sprint speed) and it has a tall facade along its north
 * side, so the fast route across it is a wall run from the edge of `high`. There
 * is a second, slower route - a narrow service beam - because a route that can
 * only be taken one way is a checkpoint rather than a decision.
 *
 * Heights are chosen from the movement config, not by eye: a 6 m gap with a
 * 2.4 m rise is inside what a jump plus a grab reaches, a 12 m gap is outside it,
 * and the tests assert those relationships rather than the metres.
 */
export const DEMO_DISTRICT: LevelDefinition = {
  id: 'demo-district',
  name: 'Rooftop District — Technical Demo',
  spawn: {
    // On the home roof, facing north up the roof, with room to run in every
    // direction and 6 m of clear floor to the east edge.
    position: { x: 0, y: 0.5, z: 3 },
    yaw: 0,
    pitch: 0,
  },
  // Twelve metres below the lowest roof: every drop into a canyon is fatal, well
  // before the street, so a fall reads as fatal rather than as a long, silent one.
  killPlaneY: -12,
  environment: {
    skyColor: '#0b1020',
    // The fog colour is picked to match the sky's horizon glow rather than to be a
    // neutral grey: the skyline is painted on a cylinder 240 m out, and it has to
    // dissolve into the haze rather than into a line. V0.5 pulls the far plane in
    // and warms the colour, so the district has depth instead of just distance.
    fogColor: '#3d3355',
    fogNear: 90,
    fogFar: 480,
    ambientSkyColor: '#8399c9',
    ambientGroundColor: '#131a26',
    ambientIntensity: 0.95,
    sunColor: '#dfe9ff',
    sunIntensity: 3.2,
    sunDirection: { x: 0.55, y: 0.9, z: 0.35 },
    backdrop: {
      radius: 240,
      height: 190,
      baseY: -34.8,
      repeat: 2,
    },
  },
  checkpoints: [
    // In route order, which is the order a player naturally meets them: the annex
    // is the first gap to cross, then the chain runs east, then down into the
    // works and back along it. The last one arms the finish.
    checkpoint('annex', [6, 2, -21]),
    checkpoint('east', [24, 1.2, 0]),
    checkpoint('high', [53, 3.6, 0]),
    checkpoint('far', [87, 1.2, -6]),
    checkpoint('works', [22, -4.8, 24]),
  ],
  props: [
    // -------------------------------------------------------------- structure
    box('city-ground', {
      at: [40, 0],
      bottom: -35.8,
      size: [700, 1, 700],
      kind: 'floor',
      model: 'slab',
      tints: { concrete: '#232c3a', 'concrete-dark': '#1b2230' },
      receiveShadow: false,
    }),

    // -------------------------------------------------------------- the roofs
    ...roof({ id: 'home', at: [-1, 0], size: [30, 24], top: 0 }),
    ...roof({ id: 'annex', at: [6, -25], size: [20, 14], top: 2, bodyTint: '#414d63', bodyTintDark: '#333d4e' }),
    ...roof({ id: 'east', at: [32, 0], size: [24, 22], top: 1.2, bodyTint: '#3d4759', bodyTintDark: '#313a49' }),
    ...roof({ id: 'high', at: [61, 0], size: [22, 22], top: 3.6, bodyTint: '#4a5468', bodyTintDark: '#3a4354' }),
    ...roof({ id: 'far', at: [95, 0], size: [22, 22], top: 1.2, bodyTint: '#394354', bodyTintDark: '#2d3543' }),

    // ------------------------------------------------------- the wall-run canyon
    // Tall enough to be run along from any height a fall from `high` reaches, and
    // flush with the north edge of the roofs on either side.
    box('facade-canyon', {
      at: [78, -11.7],
      bottom: -6,
      size: [12, 18, 1],
      kind: 'wall',
      model: 'slab',
      tints: { 'metal-light': '#5c6779', 'metal-dark': '#3a4250', 'metal-warm': '#6b6350' },
    }),
    // The slow route: a 1 m service beam, which a 0.7 m player box can walk.
    box('canyon-beam', { at: [78, 4], bottom: 2.3, size: [12, 0.5, 1], model: 'deck' }),
    // Signage on the canyon facade, read from the roofs on either side. The lit
    // face looks +Z, back across the gap.
    sign({ id: 'sign-canyon', at: [78, 5.4, -11.05], size: [4.4, 1.6], tint: '#57e0ff' }),

    // ------------------------------------------------------------- home roof
    box('penthouse', {
      at: [-6.5, -8],
      size: [6, 3.8, 5],
      kind: 'wall',
      model: 'stair-bulkhead',
      tints: { concrete: '#5a636f', 'concrete-dark': '#49515c', metal: '#77808d' },
    }),
    // Four 0.6 m risers, then a mantle onto the penthouse roof: the flight is the
    // only route up there, and every riser is inside the mantle band by design.
    ...steps('penthouse-step', { from: [-13.5, -8], riser: 0.6, count: 4, tread: 1, axis: 'x', depth: 5 }),
    box('riser-pipe', { at: [-14, -3], size: [0.8, 6, 0.8], model: 'pipe-vertical', climbable: true }),
    box('antenna-mast', { at: [-6, 8], size: [1.6, 5.5, 1.6], model: 'antenna-mast', climbable: true }),
    // A rail across the eastern half: 1.1 m from the deck, thin enough to vault.
    box('barrier-home', { at: [10, 5], size: [0.5, 1.1, 6], model: 'barrier' }),
    // 1.4 m of clearance: passable only crouched, or slid under at speed.
    box('duct', { at: [4, 6], bottom: 1.4, size: [1.2, 1.2, 8], model: 'duct' }),
    box('duct-support-north', { at: [4, 9.7], size: [1.2, 1.4, 0.6], model: 'support-post' }),
    box('duct-support-south', { at: [4, 2.3], size: [1.2, 1.4, 0.6], model: 'support-post' }),
    box('crate-home-a', { at: [2, 4], size: [1.4, 1.4, 1.4], model: 'crate' }),
    box('crate-home-b', { at: [3.7, 4.8], size: [1.4, 1.4, 1.4], model: 'crate' }),
    box('crate-home-c', { at: [2, 4], bottom: 1.4, size: [1.4, 1.4, 1.4], model: 'crate' }),
    box('skylight', { at: [10, -6], size: [5, 0.5, 4], model: 'skylight' }),
    box('ac-unit-home-a', { at: [-6, -4], size: [3.2, 1.7, 2.4], model: 'ac-unit' }),
    box('ac-unit-home-b', { at: [-2.4, -4], size: [3.2, 1.7, 2.4], model: 'ac-unit' }),

    // ------------------------------------------------------------- annex roof
    box('water-tank-annex', { at: [2, -26], size: [3.2, 3.4, 3.2], model: 'water-tank', bottom: 2 }),
    box('vent-stack-annex', { at: [12, -22], size: [1.6, 2.8, 1.6], model: 'vent-stack', bottom: 2, climbable: true }),
    box('satellite-annex', { at: [11, -29], size: [3, 2.4, 3], model: 'satellite-dish', bottom: 2 }),
    box('barrier-annex', { at: [6, -30.5], size: [0.5, 1.1, 4], model: 'barrier', bottom: 2 }),
    box('crate-annex', { at: [0, -20], size: [1.4, 1.4, 1.4], model: 'crate', bottom: 2 }),

    // -------------------------------------------------------------- east roof
    box('ac-unit-east-a', { at: [26, 5], size: [3.2, 1.7, 2.4], model: 'ac-unit', bottom: 1.2 }),
    box('ac-unit-east-b', { at: [30, 5], size: [3.2, 1.7, 2.4], model: 'ac-unit', bottom: 1.2 }),
    // Moved clear of the machine room, which now takes the middle of the roof.
    box('vent-stack-east', { at: [42, -6], size: [1.8, 3, 1.8], model: 'vent-stack', bottom: 1.2, climbable: true }),
    box('barrier-east', { at: [24, -4], size: [0.5, 1.1, 6], model: 'barrier', bottom: 1.2 }),
    box('skylight-east', { at: [28, -6], size: [5, 0.5, 4], model: 'skylight', bottom: 1.2 }),
    box('crate-east-a', { at: [36, 7], size: [1.4, 1.4, 1.4], model: 'crate', bottom: 1.2 }),
    box('crate-east-b', { at: [37.7, 7.8], size: [1.4, 1.4, 1.4], model: 'crate', bottom: 1.2 }),
    box('junction-east', { at: [33, -8], size: [1.6, 1.8, 1.6], model: 'junction-box', bottom: 1.2 }),

    // The east room: a machine room you can walk into. Walls and roof of its own,
    // a door you open with E, fittings inside, a sign on the back wall, and a pipe
    // up the outside that reaches the roof.
    ...EAST_ROOM.props,
    box('pipe-east', { at: [40, -1], bottom: 1.2, size: [0.4, 3.45, 0.4], model: 'pipe-vertical', pipe: true }),
    box('junction-east-inner', { at: [34, -2.6], size: [1.4, 1.6, 1.4], model: 'junction-box', bottom: 1.2 }),
    box('crate-east-inner', { at: [38.4, -2.4], size: [1.4, 1.4, 1.4], model: 'crate', bottom: 1.2 }),
    sign({ id: 'sign-east-room', at: [36, 2.9, -3.35], size: [3.2, 1], tint: '#ff4fd8' }),

    // -------------------------------------------------------------- high roof
    box('water-tank-high', { at: [56, 4], size: [3.2, 3.4, 3.2], model: 'water-tank', bottom: 3.6 }),
    box('barrier-high', { at: [53, -5], size: [0.5, 1.1, 6], model: 'barrier', bottom: 3.6 }),
    box('satellite-high', { at: [56, -6], size: [3, 2.4, 3], model: 'satellite-dish', bottom: 3.6 }),
    box('ac-unit-high', { at: [62, 6], size: [3.2, 1.7, 2.4], model: 'ac-unit', bottom: 3.6 }),
    box('vent-stack-high', { at: [68, -8], size: [1.8, 3, 1.8], model: 'vent-stack', bottom: 3.6, climbable: true }),
    // 1.4 m of clearance above the high roof's own deck.
    box('duct-high', { at: [64, 0], bottom: 5, size: [1.2, 1.2, 8], model: 'duct' }),
    box('duct-high-support-north', { at: [64, 3.7], size: [1.2, 1.4, 0.6], model: 'support-post', bottom: 3.6 }),
    box('duct-high-support-south', { at: [64, -3.7], size: [1.2, 1.4, 0.6], model: 'support-post', bottom: 3.6 }),
    box('crate-high', { at: [69, 8], size: [1.4, 1.4, 1.4], model: 'crate', bottom: 3.6 }),

    // --------------------------------------------------------------- far roof
    box('vent-stack-far', { at: [88, -5], size: [1.8, 3, 1.8], model: 'vent-stack', bottom: 1.2, climbable: true }),
    // An older unit, in a different grey: the same model, re-tinted.
    box('ac-unit-far-a', {
      at: [92, 4],
      bottom: 1.2,
      size: [3.2, 1.7, 2.4],
      model: 'ac-unit',
      tints: { metal: '#5b6472', 'metal-light': '#6c7788', 'metal-dark': '#3f4753' },
    }),
    box('ac-unit-far-b', { at: [96, 4], size: [3.2, 1.7, 2.4], model: 'ac-unit', bottom: 1.2 }),
    box('barrier-far', { at: [90, 7], size: [0.5, 1.1, 6], model: 'barrier', bottom: 1.2 }),
    box('pipe-run-far', { at: [99, 0], bottom: 1.2, size: [0.6, 0.6, 10], model: 'pipe-run' }),
    box('crate-far-a', { at: [101, -4], size: [1.4, 1.4, 1.4], model: 'crate', bottom: 1.2 }),
    box('crate-far-b', { at: [102.7, -4.8], size: [1.4, 1.4, 1.4], model: 'crate', bottom: 1.2 }),
    box('cable-spool-far', { at: [101, 7], size: [2, 2, 2], model: 'cable-spool', bottom: 1.2 }),

    // The far room: the same idea as the east one, a floor lower, so entering a
    // building is a thing the district does rather than a one-off on one roof.
    ...FAR_ROOM.props,
    box('junction-far-inner', { at: [92, -1.8], size: [1.4, 1.6, 1.4], model: 'junction-box', bottom: 1.2 }),
    box('crate-far-inner', { at: [95.6, -1.4], size: [1.4, 1.4, 1.4], model: 'crate', bottom: 1.2 }),
    sign({ id: 'sign-far-room', at: [94, 2.8, -5.35], size: [3, 1], tint: '#ffc247' }),

    // ---------------------------------------------------- V0.5: the works
    // A second level of the district: the service side, six metres below the
    // roofs and south of them. It is what the rooftop route *came from* - the
    // plant, the ducts, the stuff that keeps the buildings alive - and it is
    // reached by a lift down from `far` and left by a lift back up to `home`, so
    // the district closes into a loop rather than running out at one end.
    //
    // The four roofs are the same 4 m apart as the east-west spine, but their
    // heights wander by a metre or so: not enough to be an obstacle, enough that
    // the run has a rhythm.
    ...roof({ id: 'works-1', at: [95, 24], size: [20, 16], top: -5, bodyTint: '#3a4454', bodyTintDark: '#2e3642' }),
    ...roof({ id: 'works-2', at: [71, 24], size: [20, 16], top: -4.2, bodyTint: '#3d4756', bodyTintDark: '#303845' }),
    ...roof({ id: 'works-3', at: [47, 24], size: [20, 16], top: -5.6, bodyTint: '#37414f', bodyTintDark: '#2b323d' }),
    ...roof({ id: 'works-4', at: [22, 24], size: [22, 16], top: -4.8, bodyTint: '#3b4553', bodyTintDark: '#2f3743' }),

    // Plant on works-1, so the roof you land on is clearly a working one.
    box('duct-works-1', { at: [95, 22.5], bottom: -3.6, size: [1.4, 1.4, 12], model: 'duct' }),
    box('duct-works-1-support-n', { at: [95, 16.8], size: [1.4, 1.4, 0.6], model: 'support-post', bottom: -5 }),
    box('duct-works-1-support-s', { at: [95, 28.2], size: [1.4, 1.4, 0.6], model: 'support-post', bottom: -5 }),
    box('vent-stack-works-1', { at: [89, 30], size: [1.8, 3, 1.8], model: 'vent-stack', bottom: -5, climbable: true }),
    box('pipe-works-1', { at: [102, 28], bottom: -5, size: [0.5, 4.2, 0.5], model: 'pipe-vertical', pipe: true }),
    box('barrier-works-1', { at: [90, 18], size: [0.5, 1.1, 5], model: 'barrier', bottom: -5 }),
    box('crate-works-1-a', { at: [100, 30], size: [1.4, 1.4, 1.4], model: 'crate', bottom: -5 }),
    box('crate-works-1-b', { at: [101.7, 30.8], size: [1.4, 1.4, 1.4], model: 'crate', bottom: -5 }),

    // Works-2 carries the big plant: a water tank, a cable run and a rail.
    box('tank-works-2', { at: [66, 29], size: [3.2, 3.4, 3.2], model: 'water-tank', bottom: -4.2 }),
    box('pipe-run-works-2', { at: [78, 27], bottom: -4.2, size: [0.6, 0.6, 10], model: 'pipe-run' }),
    box('vent-stack-works-2', { at: [78, 29], size: [1.8, 3.2, 1.8], model: 'vent-stack', bottom: -4.2, climbable: true }),
    box('barrier-works-2', { at: [66, 18], size: [0.5, 1.1, 5], model: 'barrier', bottom: -4.2 }),
    box('cable-spool-works-2', { at: [63, 22], size: [2, 2, 2], model: 'cable-spool', bottom: -4.2 }),

    // Works-3 is the low point, with a gantry duct and a climbable riser.
    box('duct-works-3', { at: [47, 24], bottom: -4.2, size: [1.4, 1.4, 12], model: 'duct' }),
    box('duct-works-3-support-n', { at: [47, 18.3], size: [1.4, 1.4, 0.6], model: 'support-post', bottom: -5.6 }),
    box('duct-works-3-support-s', { at: [47, 29.7], size: [1.4, 1.4, 0.6], model: 'support-post', bottom: -5.6 }),
    box('riser-works-3', { at: [55, 30], bottom: -5.6, size: [0.7, 5, 0.7], model: 'pipe-vertical', pipe: true }),
    box('junction-works-3', { at: [42, 19], size: [1.6, 1.8, 1.6], model: 'junction-box', bottom: -5.6 }),
    box('crate-works-3', { at: [49, 19], size: [1.4, 1.4, 1.4], model: 'crate', bottom: -5.6 }),

    // Works-4 is the way out: the lift up to `home` is at its north edge.
    box('tank-works-4', { at: [28, 29], size: [3.2, 3.4, 3.2], model: 'water-tank', bottom: -4.8 }),
    box('ac-unit-works-4', { at: [14, 20], size: [3.2, 1.7, 2.4], model: 'ac-unit', bottom: -4.8 }),
    box('barrier-works-4', { at: [20, 19], size: [0.5, 1.1, 5], model: 'barrier', bottom: -4.8 }),
    box('crate-works-4', { at: [25, 20], size: [1.4, 1.4, 1.4], model: 'crate', bottom: -4.8 }),

    // ---------------------------------------------------- V0.5: neon signage
    // Lit bands across the canyon facade, read from both roofs on either side of
    // the gap, and along the machine rooms. `neon-strip` glows on +Z, so each is
    // mounted on a wall that faces the district rather than lying flat.
    box('strip-canyon-low', { at: [78, -11.07], bottom: 3.2, size: [11, 0.4, 0.25], model: 'neon-strip', tints: { neon: '#57e0ff' } }),
    box('strip-canyon-mid', { at: [78, -11.07], bottom: 6.4, size: [11, 0.4, 0.25], model: 'neon-strip', tints: { neon: '#ff4fd8' } }),
    box('strip-canyon-high', { at: [78, -11.07], bottom: 9.6, size: [11, 0.4, 0.25], model: 'neon-strip', tints: { neon: '#ffc247' } }),
    box('strip-east-room', { at: [36, 1.83], bottom: 3.9, size: [6.6, 0.35, 0.25], model: 'neon-strip', tints: { neon: '#ff4fd8' } }),
    box('strip-works-1', { at: [95, 31.4], bottom: -5, size: [18, 0.4, 0.5], model: 'neon-strip', tints: { neon: '#57e0ff' } }),
    // Big signs on the towers *north* of the district, because a sign glows out of
    // its front face: only a facade facing back towards the roofs will read.
    sign({ id: 'sign-tower-a', at: [-58, 8, -41.87], size: [6, 2.2], tint: '#ff4fd8' }),
    sign({ id: 'sign-tower-b', at: [124, 6, -47.87], size: [5.5, 2], tint: '#57e0ff' }),
    sign({ id: 'sign-tower-e', at: [40, 5, -70.87], size: [6, 2.2], tint: '#ffc247' }),

    // ---------------------------------------------------- background massing
    box('tower-a', {
      at: [-58, -52],
      bottom: -34.8,
      size: [20, 52, 20],
      model: 'slab',
      tints: { concrete: '#414d63', 'concrete-dark': '#333d4e' },
      receiveShadow: false,
    }),
    box('tower-b', {
      at: [124, -60],
      bottom: -34.8,
      size: [24, 74, 24],
      model: 'slab',
      tints: { concrete: '#37425a', 'concrete-dark': '#2c3547' },
      receiveShadow: false,
    }),
    box('tower-c', {
      at: [104, 56],
      bottom: -34.8,
      size: [18, 42, 18],
      model: 'slab',
      tints: { concrete: '#45516a', 'concrete-dark': '#37415a' },
      receiveShadow: false,
    }),
    box('tower-d', {
      at: [-34, 58],
      bottom: -34.8,
      size: [22, 30, 22],
      model: 'slab',
      tints: { concrete: '#3f4a5f', 'concrete-dark': '#313a4b' },
      receiveShadow: false,
    }),
    box('tower-e', {
      at: [40, -84],
      bottom: -34.8,
      size: [26, 60, 26],
      model: 'slab',
      tints: { concrete: '#323d51', 'concrete-dark': '#28303f' },
      receiveShadow: false,
    }),
  ],
  doors: [EAST_ROOM.door, FAR_ROOM.door],
  elevators: [
    // The two lifts are what turn the district into a loop. One drops you from the
    // roof route into the works, the other brings you back up to `home`; both
    // arrive flush with the floor at each end, and both start at the end the
    // player meets first.
    lift({ id: 'lift-down', at: [95, 13.5], size: [8, 5], lowTop: -5, highTop: 1.2, start: 'high' }),
    lift({ id: 'lift-up', at: [14, 14], size: [8, 4], lowTop: -4.8, highTop: 0, start: 'low' }),
  ],
  collectibles: [
    // Eight shards, spread so that taking them all means using the district
    // rather than just crossing it: two need the climbable routes, one needs the
    // pipe, one sits over the canyon beam, and three are out on the works.
    { id: 'shard-penthouse', position: { x: -6.5, y: 4.6, z: -8 } },
    { id: 'shard-room-east', position: { x: 36, y: 5.5, z: -1 } },
    { id: 'shard-tank-high', position: { x: 56, y: 7.6, z: 4 } },
    { id: 'shard-canyon', position: { x: 78, y: 3.6, z: 4 } },
    { id: 'shard-room-far', position: { x: 94, y: 5.2, z: -3 } },
    { id: 'shard-works-1', position: { x: 95, y: -4.2, z: 24 } },
    { id: 'shard-works-2', position: { x: 71, y: -3.4, z: 24 } },
    { id: 'shard-works-3', position: { x: 47, y: -4.8, z: 24 } },
  ],
  goal: { id: 'goal', position: { x: -8, y: 0, z: -2 } },
  smoke: [
    // Plumes rising off the plant, and one in the canyon where the towers' vent
    // stack is. Drifting, never still: a still plume reads as a texture.
    { id: 'smoke-home', position: { x: 10, y: 0, z: 9 }, radius: 2.6, rise: 7, drift: 2, period: 7, opacity: 0.34, count: 6 },
    { id: 'smoke-high', position: { x: 61, y: 3.6, z: -6 }, radius: 3, rise: 9, drift: 2.6, period: 8.5, opacity: 0.4, count: 8 },
    { id: 'smoke-works-2', position: { x: 66, y: -4.2, z: 29 }, radius: 4, rise: 13, drift: 3.4, period: 10, opacity: 0.5, count: 10 },
    { id: 'smoke-works-4', position: { x: 28, y: -4.8, z: 29 }, radius: 3.4, rise: 11, drift: 3, period: 9, opacity: 0.45, count: 8 },
    { id: 'smoke-canyon', position: { x: 78, y: -6, z: 6 }, radius: 5, rise: 17, drift: 4, period: 12, opacity: 0.38, count: 12 },
  ],
  lights: [
    // An interior lamp in each room: the sun cannot reach inside a building, and
    // without one a room is a black hole you can hear your footsteps in.
    { id: 'lamp-east-room', position: { x: 36, y: 3.6, z: -1 }, color: '#ffd9a0', intensity: 9, distance: 14 },
    { id: 'lamp-far-room', position: { x: 94, y: 3.1, z: -3 }, color: '#ffd9a0', intensity: 8, distance: 12 },
    // Spill from the signs, so a neon sign lights the wall it is on rather than
    // being a glowing rectangle on a black one.
    { id: 'glow-canyon', position: { x: 78, y: 5.6, z: -10.1 }, color: '#57e0ff', intensity: 11, distance: 20 },
    { id: 'glow-east-sign', position: { x: 36, y: 3.1, z: -2.7 }, color: '#ff4fd8', intensity: 5, distance: 10 },
    { id: 'glow-far-sign', position: { x: 94, y: 3, z: -4.5 }, color: '#ffc247', intensity: 4, distance: 9 },
    // V0.5: the works are lit like a plant rather than like a roof - worklamps
    // under the ducts, cold light on the machinery, and the lift wells lit so they
    // read as somewhere to go.
    { id: 'lamp-works-1', position: { x: 95, y: -3.8, z: 24 }, color: '#cfe6ff', intensity: 7, distance: 16 },
    { id: 'lamp-works-2', position: { x: 71, y: -3, z: 24 }, color: '#cfe6ff', intensity: 7, distance: 16 },
    { id: 'lamp-works-3', position: { x: 47, y: -4.4, z: 24 }, color: '#cfe6ff', intensity: 7, distance: 16 },
    { id: 'lamp-works-4', position: { x: 22, y: -3.6, z: 24 }, color: '#cfe6ff', intensity: 7, distance: 16 },
    { id: 'lamp-lift-down', position: { x: 95, y: -1.8, z: 13.5 }, color: '#7dffd7', intensity: 6, distance: 12 },
    { id: 'lamp-lift-up', position: { x: 14, y: -2, z: 14 }, color: '#7dffd7', intensity: 6, distance: 12 },
    // And a glow around the finish, so the pad is not the only thing marking it.
    { id: 'glow-goal', position: { x: -8, y: 1.6, z: -2 }, color: '#4ff0c8', intensity: 8, distance: 14 },
  ],
};
