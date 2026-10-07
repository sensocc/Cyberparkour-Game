/**
 * Declarative definition of the V0.1 demo roof.
 *
 * Keeping the level as plain data (rather than as three.js objects) means it
 * can be validated, collision-tested and rendered from a single source of
 * truth.
 *
 * Coordinate conventions
 *  - Y is up, and the **top surface of the roof deck is Y = 0**.
 *  - `position` is the centre of a box, `size` its full extents.
 *  - The player spawns at `spawn.position`, which is the position of their
 *    feet (centre of the bottom face).
 */

import type { ReadonlyVec3 } from '../../core/vec3.js';
import type { ColliderKind } from '../physics/collision.js';

export interface PropDefinition {
  readonly id: string;
  readonly kind: ColliderKind;
  /** Centre of the box in world units. */
  readonly position: ReadonlyVec3;
  /** Full extents (width, height, depth). */
  readonly size: ReadonlyVec3;
  /** Base colour, as a hex string. */
  readonly color: string;
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
  readonly skyRadius: number;
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

/**
 * The technical demo's rooftop.
 *
 * V0.0 ringed this roof with a parapet because there was no way to handle a
 * fall. Now that fall detection and respawn exist, the edges are open: the deck
 * is a bare, walkable platform and stepping off it is fatal.
 *
 * Named landmarks, so tests and code can refer to them:
 *  - `deck`       the walkable surface, top at Y = 0, 48 x 40 m
 *  - `penthouse`  the roof access block, 3.2 m tall
 *  - `ledge-low`  a 0.6 m step, jumpable straight from the deck
 *  - `ledge-mid`  a 1.2 m step, reachable from `ledge-low`
 *  - `duct`       a service duct whose underside is 1.4 m up, so it can only be
 *                 passed while crouched
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
    skyRadius: 500,
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
    // --------------------------------------------------------------- structure
    {
      id: 'deck',
      kind: 'floor',
      position: { x: 0, y: -0.4, z: 0 },
      size: { x: 48, y: 0.8, z: 40 },
      color: '#3c4657',
    },
    {
      id: 'tower-body',
      kind: 'wall',
      position: { x: 0, y: -17.8, z: 0 },
      size: { x: 46, y: 34, z: 38 },
      color: '#2b3341',
    },
    {
      // Large, so its edge is never visible through the fog.
      id: 'city-ground',
      kind: 'floor',
      position: { x: 0, y: -35.3, z: 0 },
      size: { x: 600, y: 1, z: 600 },
      color: '#1a2130',
      receiveShadow: false,
    },

    // -------------------------------------------------------- roof access block
    {
      id: 'penthouse',
      kind: 'wall',
      position: { x: -15, y: 1.6, z: -12 },
      size: { x: 7, y: 3.2, z: 6 },
      color: '#414d61',
    },
    {
      id: 'penthouse-vent',
      kind: 'prop',
      position: { x: 5, y: 1.4, z: -15 },
      size: { x: 2.4, y: 2.8, z: 2.4 },
      color: '#6b7280',
    },

    // ---------------------------------------------------------------- plant row
    {
      id: 'ac-unit-a',
      kind: 'prop',
      position: { x: -8, y: 0.85, z: -15 },
      size: { x: 3.2, y: 1.7, z: 2.4 },
      color: '#5c6b7f',
    },
    {
      id: 'ac-unit-b',
      kind: 'prop',
      position: { x: -3.5, y: 0.85, z: -15 },
      size: { x: 3.2, y: 1.7, z: 2.4 },
      color: '#525f72',
    },
    {
      id: 'ac-unit-c',
      kind: 'prop',
      position: { x: 1, y: 0.85, z: -15 },
      size: { x: 3.2, y: 1.7, z: 2.4 },
      color: '#5c6b7f',
    },
    {
      id: 'ac-unit-d',
      kind: 'prop',
      position: { x: 12, y: 0.8, z: 9 },
      size: { x: 3, y: 1.6, z: 2.6 },
      color: '#525f72',
    },

    // ------------------------------------------------------- jumpable ledges
    {
      id: 'ledge-low',
      kind: 'prop',
      position: { x: -8, y: 0.3, z: 6 },
      size: { x: 5, y: 0.6, z: 5 },
      color: '#4a5567',
    },
    {
      id: 'ledge-mid',
      kind: 'prop',
      position: { x: -8, y: 0.6, z: 0 },
      size: { x: 4, y: 1.2, z: 4 },
      color: '#53627d',
    },
    {
      id: 'ledge-high',
      kind: 'prop',
      position: { x: -15, y: 0.9, z: 5 },
      size: { x: 3, y: 1.8, z: 3 },
      color: '#465062',
    },

    // ---------------------------------------------------- crouch-only passage
    {
      // Underside at 1.4 m: too low to walk through, comfortable crouched.
      id: 'duct',
      kind: 'prop',
      position: { x: 18, y: 2, z: 0 },
      size: { x: 1.2, y: 1.2, z: 8 },
      color: '#7c8798',
    },
    {
      id: 'duct-support-north',
      kind: 'prop',
      position: { x: 18, y: 0.7, z: 3.7 },
      size: { x: 1.2, y: 1.4, z: 0.6 },
      color: '#5c6b7f',
    },
    {
      id: 'duct-support-south',
      kind: 'prop',
      position: { x: 18, y: 0.7, z: -3.7 },
      size: { x: 1.2, y: 1.4, z: 0.6 },
      color: '#5c6b7f',
    },

    // ------------------------------------------------------------------ clutter
    {
      id: 'crate-a',
      kind: 'prop',
      position: { x: 6, y: 0.7, z: 13 },
      size: { x: 1.4, y: 1.4, z: 1.4 },
      color: '#c2410c',
    },
    {
      id: 'crate-b',
      kind: 'prop',
      position: { x: 7.7, y: 0.7, z: 13.8 },
      size: { x: 1.4, y: 1.4, z: 1.4 },
      color: '#a16207',
    },
    {
      id: 'crate-c',
      kind: 'prop',
      position: { x: 6, y: 2.1, z: 13 },
      size: { x: 1.4, y: 1.4, z: 1.4 },
      color: '#c2410c',
    },
    {
      id: 'skylight',
      kind: 'prop',
      position: { x: 10, y: 0.25, z: 3 },
      size: { x: 5, y: 0.5, z: 4 },
      color: '#2f4a5c',
    },
    {
      id: 'pipe-run',
      kind: 'prop',
      position: { x: -22, y: 0.25, z: 0 },
      size: { x: 0.5, y: 0.5, z: 24 },
      color: '#5a4a3a',
    },
    {
      id: 'antenna-mast',
      kind: 'prop',
      position: { x: 19, y: 2.75, z: -17 },
      size: { x: 0.6, y: 5.5, z: 0.6 },
      color: '#6b7280',
    },

    // ------------------------------------------------------ background massing
    {
      id: 'tower-a',
      kind: 'prop',
      position: { x: -70, y: -10.8, z: -48 },
      size: { x: 18, y: 48, z: 18 },
      color: '#39455c',
      receiveShadow: false,
    },
    {
      id: 'tower-b',
      kind: 'prop',
      position: { x: 64, y: -1.8, z: -72 },
      size: { x: 22, y: 66, z: 22 },
      color: '#2f3a4e',
      receiveShadow: false,
    },
    {
      id: 'tower-c',
      kind: 'prop',
      position: { x: 74, y: -15.8, z: 46 },
      size: { x: 16, y: 38, z: 16 },
      color: '#3d4a61',
      receiveShadow: false,
    },
  ],
};
