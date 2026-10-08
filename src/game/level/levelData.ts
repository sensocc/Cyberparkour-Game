/**
 * Declarative definition of the V0.3 demo district.
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
    fogColor: '#2b2a4a',
    fogNear: 110,
    fogFar: 620,
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
    // is the first gap to cross, then the chain runs east.
    checkpoint('annex', [6, 2, -21]),
    checkpoint('east', [24, 1.2, 0]),
    checkpoint('high', [53, 3.6, 0]),
    checkpoint('far', [87, 1.2, -6]),
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
    box('vent-stack-east', { at: [40, -5], size: [1.8, 3, 1.8], model: 'vent-stack', bottom: 1.2, climbable: true }),
    box('barrier-east', { at: [24, -4], size: [0.5, 1.1, 6], model: 'barrier', bottom: 1.2 }),
    box('skylight-east', { at: [28, -6], size: [5, 0.5, 4], model: 'skylight', bottom: 1.2 }),
    box('crate-east-a', { at: [36, 7], size: [1.4, 1.4, 1.4], model: 'crate', bottom: 1.2 }),
    box('crate-east-b', { at: [37.7, 7.8], size: [1.4, 1.4, 1.4], model: 'crate', bottom: 1.2 }),
    box('junction-east', { at: [33, -8], size: [1.6, 1.8, 1.6], model: 'junction-box', bottom: 1.2 }),

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
    box('pipe-run-far', { at: [98, 0], bottom: 1.2, size: [0.6, 0.6, 10], model: 'pipe-run' }),
    box('crate-far-a', { at: [101, -4], size: [1.4, 1.4, 1.4], model: 'crate', bottom: 1.2 }),
    box('crate-far-b', { at: [102.7, -4.8], size: [1.4, 1.4, 1.4], model: 'crate', bottom: 1.2 }),
    box('cable-spool-far', { at: [101, 7], size: [2, 2, 2], model: 'cable-spool', bottom: 1.2 }),

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
};
