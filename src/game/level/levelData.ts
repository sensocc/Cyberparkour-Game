/**
 * Declarative definition of the V0.2 demo roof.
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

/**
 * The technical demo's rooftop.
 *
 * V0.1 was a flat 48 x 40 m deck. V0.2 makes it bigger *and* vertical: 72 x 60 m,
 * with two stacked terraces, a roof access block, staircases, and climbable
 * risers. The reachability of every ledge is a consequence of the movement
 * config - 0.4-1.4 m is mantled, 1.4-2.6 m is grabbed while airborne - so
 * retuning gravity or jump speed changes which routes exist. The tests assert
 * the relationships rather than the numbers, so that stays honest.
 *
 * Named landmarks, so tests and code can refer to them:
 *  - `deck`        the walkable surface, top at Y = 0, 72 x 60 m
 *  - `penthouse`   the roof access block, 3.8 m tall
 *  - `ledge-low` / `ledge-mid`    0.6 m and 1.2 m: mantled from the deck
 *  - `ledge-high` / `block-a`     2.4 m and 1.8 m: need a jump and a grab
 *  - `terrace-l1` / `terrace-l2`  stacked platforms at 2.0 m and 4.2 m
 *  - `duct`        a service duct with 1.4 m of clearance: passable only crouched
 *  - `riser-pipe` / `antenna-mast` / `vent-stack-*`  climbable faces
 */
export const DEMO_ROOF: LevelDefinition = {
  id: 'demo-roof',
  name: 'Rooftop — Technical Demo',
  spawn: {
    // Middle of the deck, with room to run in every direction.
    position: { x: 0, y: 0.5, z: 13 },
    yaw: 0,
    pitch: 0,
  },
  // Twelve metres below the deck: you are dead well before reaching the city
  // ground, so a fall reads as fatal rather than as a long, silent drop.
  killPlaneY: -12,
  environment: {
    skyColor: '#0b1020',
    // The fog colour sits between the sky's horizon glow and the haze bank in
    // the city backdrop, so distance blends instead of banding.
    fogColor: '#2b2a4a',
    fogNear: 90,
    fogFar: 460,
    ambientSkyColor: '#8399c9',
    ambientGroundColor: '#131a26',
    ambientIntensity: 0.95,
    sunColor: '#dfe9ff',
    sunIntensity: 3.2,
    sunDirection: { x: 0.55, y: 0.9, z: 0.35 },
    backdrop: {
      radius: 150,
      height: 150,
      baseY: -34.8,
      repeat: 1,
    },
  },
  props: [
    // ------------------------------------------------------------- structure
    box('deck', { at: [0, 0], bottom: -0.8, size: [72, 0.8, 60], kind: 'floor', model: 'deck' }),
    box('tower-body', {
      at: [0, 0],
      bottom: -34.8,
      size: [70, 34, 58],
      kind: 'wall',
      model: 'slab',
      tints: { concrete: '#3b4557', 'concrete-dark': '#2f3846' },
      receiveShadow: true,
    }),
    box('city-ground', {
      at: [0, 0],
      bottom: -35.8,
      size: [600, 1, 600],
      kind: 'floor',
      model: 'slab',
      tints: { concrete: '#232c3a', 'concrete-dark': '#1b2230' },
      receiveShadow: false,
    }),

    // ------------------------------------------------- roof access and routes
    box('penthouse', {
      at: [-26, -21],
      size: [8, 3.8, 6],
      kind: 'wall',
      model: 'stair-bulkhead',
      tints: { concrete: '#5a636f', 'concrete-dark': '#49515c', metal: '#77808d' },
    }),
    // Four 0.6 m risers up the penthouse's west side, then a mantle onto its roof.
    ...steps('penthouse-step', {
      from: [-34, -21],
      riser: 0.6,
      count: 4,
      tread: 1,
      axis: 'x',
      depth: 6,
    }),
    box('riser-pipe', {
      at: [-31.2, -16],
      size: [0.8, 6, 0.8],
      model: 'pipe-vertical',
      climbable: true,
    }),

    // ---------------------------------------------------------- the terraces
    box('terrace-l1', { at: [18, -20], size: [20, 2, 16], kind: 'floor', model: 'ledge' }),
    box('terrace-l2', { at: [22, -23], bottom: 2, size: [12, 2.2, 10], kind: 'floor', model: 'ledge' }),
    // Three 0.5 m risers up to the first terrace.
    ...steps('terrace-step', {
      from: [5, -16],
      riser: 0.5,
      count: 3,
      tread: 1,
      axis: 'x',
      depth: 6,
    }),

    // ------------------------------------------------------------- jump targets
    box('ledge-low', { at: [-8, 6], size: [5, 0.6, 5], model: 'ledge' }),
    box('ledge-mid', { at: [-8, 0], size: [4, 1.2, 4], model: 'ledge' }),
    box('ledge-high', { at: [-16, 4], size: [4, 2.4, 4], model: 'ledge' }),
    box('block-a', { at: [-4, -6], size: [3, 1.8, 3], model: 'block' }),

    // ----------------------------------------------------- crouch-only passage
    // Underside at 1.4 m: too low to walk through, comfortable crouched.
    box('duct', { at: [18, 0], bottom: 1.4, size: [1.2, 1.2, 8], model: 'duct' }),
    box('duct-support-north', { at: [18, 3.7], size: [1.2, 1.4, 0.6], model: 'support-post' }),
    box('duct-support-south', { at: [18, -3.7], size: [1.2, 1.4, 0.6], model: 'support-post' }),

    // ------------------------------------------------------------------ plant
    box('ac-unit-a', { at: [-8, -15], size: [3.2, 1.7, 2.4], model: 'ac-unit' }),
    box('ac-unit-b', { at: [-3.5, -15], size: [3.2, 1.7, 2.4], model: 'ac-unit' }),
    box('ac-unit-c', { at: [1, -15], size: [3.2, 1.7, 2.4], model: 'ac-unit' }),
    box('ac-unit-d', {
      at: [-15, -26],
      size: [3, 1.6, 2.6],
      model: 'ac-unit',
      tints: { metal: '#5b6472', 'metal-light': '#6c7788', 'metal-dark': '#3f4753' },
    }),
    box('penthouse-vent', { at: [5, -22], size: [2.4, 2.8, 2.4], model: 'vent-stack' }),
    box('vent-stack-a', { at: [30, -20], size: [1.8, 3, 1.8], model: 'vent-stack', climbable: true }),
    box('vent-stack-b', { at: [-20, 8], size: [1.6, 2.8, 1.6], model: 'vent-stack', climbable: true }),

    // ---------------------------------------------------------------- clutter
    box('crate-a', { at: [6, 13], size: [1.4, 1.4, 1.4], model: 'crate' }),
    box('crate-b', { at: [7.7, 13.8], size: [1.4, 1.4, 1.4], model: 'crate' }),
    box('crate-c', { at: [6, 13], bottom: 1.4, size: [1.4, 1.4, 1.4], model: 'crate' }),
    box('crate-d', {
      at: [10, 9],
      size: [1.4, 1.4, 1.4],
      model: 'crate',
      tints: { rust: '#6d6a4a', 'metal-dark': '#3f4650' },
    }),
    box('skylight', { at: [10, 3], size: [5, 0.5, 4], model: 'skylight' }),
    box('pipe-run', { at: [-30, -2], size: [0.6, 0.6, 14], model: 'pipe-run' }),
    box('antenna-mast', { at: [20, 26], size: [1.6, 5.5, 1.6], model: 'antenna-mast', climbable: true }),
    box('water-tank', { at: [-16, 22], size: [3.2, 3.4, 3.2], model: 'water-tank' }),
    box('satellite-dish', { at: [28, 18], size: [3, 2.4, 3], model: 'satellite-dish' }),
    box('junction-box-a', { at: [-6, 20], size: [1.6, 1.8, 1.6], model: 'junction-box' }),
    box('junction-box-b', { at: [-26, 16], size: [1.4, 1.5, 1.4], model: 'junction-box' }),
    box('cable-spool-a', { at: [14, 24], size: [2, 2, 2], model: 'cable-spool' }),
    box('cable-spool-b', { at: [16.6, 24], size: [2, 2, 2], model: 'cable-spool' }),
    box('barrier-a', { at: [33, 8], size: [0.4, 1.2, 6], model: 'barrier' }),
    box('barrier-b', { at: [-34.6, -6], size: [0.4, 1.2, 5], model: 'barrier' }),

    // ------------------------------------------------------ background massing
    box('tower-a', {
      at: [-70, -48],
      bottom: -34.8,
      size: [18, 48, 18],
      model: 'slab',
      tints: { concrete: '#414d63', 'concrete-dark': '#333d4e' },
      receiveShadow: false,
    }),
    box('tower-b', {
      at: [64, -72],
      bottom: -34.8,
      size: [22, 66, 22],
      model: 'slab',
      tints: { concrete: '#37425a', 'concrete-dark': '#2c3547' },
      receiveShadow: false,
    }),
    box('tower-c', {
      at: [74, 46],
      bottom: -34.8,
      size: [16, 38, 16],
      model: 'slab',
      tints: { concrete: '#45516a', 'concrete-dark': '#37415a' },
      receiveShadow: false,
    }),
  ],
};
