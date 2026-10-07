/**
 * Declarative definition of the V0.0 demo roof.
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

export interface EnvironmentDefinition {
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
}

export interface LevelDefinition {
  readonly id: string;
  readonly name: string;
  readonly spawn: SpawnPoint;
  readonly environment: EnvironmentDefinition;
  readonly props: readonly PropDefinition[];
}

/**
 * The technical demo's rooftop.
 *
 * The roof is ringed by a parapet on purpose. V0.1 introduces fall detection
 * and respawn; until then an unguarded edge would drop the player onto the
 * ground with no way back up (there is no jump yet either), which would end
 * the demo. The parapet also happens to be what a real roof looks like.
 */
export const DEMO_ROOF: LevelDefinition = {
  id: 'demo-roof',
  name: 'Rooftop — Technical Demo',
  spawn: {
    position: { x: 0, y: 0.5, z: 11 },
    yaw: 0,
    pitch: 0,
  },
  environment: {
    skyColor: '#121b2c',
    fogColor: '#141d2f',
    fogNear: 55,
    fogFar: 380,
    ambientSkyColor: '#7d95c6',
    ambientGroundColor: '#131a26',
    ambientIntensity: 0.95,
    sunColor: '#dfe9ff',
    sunIntensity: 3.4,
    sunDirection: { x: 0.55, y: 0.9, z: 0.35 },
  },
  props: [
    // ---------------------------------------------------------------- structure
    {
      id: 'roof-deck',
      kind: 'floor',
      position: { x: 0, y: -0.4, z: 0 },
      size: { x: 34, y: 0.8, z: 30 },
      color: '#3c4657',
    },
    {
      id: 'tower-body',
      kind: 'wall',
      position: { x: 0, y: -17.8, z: 0 },
      size: { x: 32, y: 34, z: 28 },
      color: '#2b3341',
    },
    {
      id: 'city-ground',
      kind: 'floor',
      position: { x: 0, y: -35.3, z: 0 },
      size: { x: 300, y: 1, z: 300 },
      color: '#1a2130',
    },

    // --------------------------------------------------- roof edge (parapets)
    {
      id: 'parapet-north',
      kind: 'wall',
      position: { x: 0, y: 0.45, z: -14.8 },
      size: { x: 34, y: 0.9, z: 0.4 },
      color: '#4a5568',
    },
    {
      id: 'parapet-south',
      kind: 'wall',
      position: { x: 0, y: 0.45, z: 14.8 },
      size: { x: 34, y: 0.9, z: 0.4 },
      color: '#4a5568',
    },
    {
      id: 'parapet-west',
      kind: 'wall',
      position: { x: -16.8, y: 0.45, z: 0 },
      size: { x: 0.4, y: 0.9, z: 30 },
      color: '#4a5568',
    },
    {
      id: 'parapet-east',
      kind: 'wall',
      position: { x: 16.8, y: 0.45, z: 0 },
      size: { x: 0.4, y: 0.9, z: 30 },
      color: '#4a5568',
    },

    // ------------------------------------------------------- rooftop clutter
    {
      id: 'crate-a',
      kind: 'prop',
      position: { x: -5, y: 0.7, z: 4.5 },
      size: { x: 1.4, y: 1.4, z: 1.4 },
      color: '#c2410c',
    },
    {
      id: 'crate-b',
      kind: 'prop',
      position: { x: -3.3, y: 0.7, z: 5.4 },
      size: { x: 1.4, y: 1.4, z: 1.4 },
      color: '#a16207',
    },
    {
      id: 'crate-c',
      kind: 'prop',
      position: { x: -5, y: 2.1, z: 4.5 },
      size: { x: 1.4, y: 1.4, z: 1.4 },
      color: '#c2410c',
    },
    {
      id: 'ac-unit-a',
      kind: 'prop',
      position: { x: 6, y: 0.85, z: 3 },
      size: { x: 3.2, y: 1.7, z: 2.4 },
      color: '#5c6b7f',
    },
    {
      id: 'ac-unit-b',
      kind: 'prop',
      position: { x: 11, y: 0.75, z: 8 },
      size: { x: 2.6, y: 1.5, z: 2.6 },
      color: '#4f5d6f',
    },
    {
      id: 'vent-stack',
      kind: 'prop',
      position: { x: 7.5, y: 1.3, z: -2.5 },
      size: { x: 1.5, y: 2.6, z: 1.5 },
      color: '#7c8798',
    },
    {
      id: 'roof-hatch',
      kind: 'prop',
      position: { x: -10, y: 0.6, z: -9 },
      size: { x: 2.2, y: 1.2, z: 2.2 },
      color: '#465062',
    },
    {
      id: 'low-block',
      kind: 'prop',
      position: { x: -8, y: 0.35, z: -3 },
      size: { x: 4, y: 0.7, z: 4 },
      color: '#4a5567',
    },
    {
      id: 'step-block',
      kind: 'prop',
      position: { x: -4, y: 0.75, z: -9 },
      size: { x: 2.6, y: 1.5, z: 2.6 },
      color: '#53627d',
    },
    {
      id: 'ledge-beam',
      kind: 'prop',
      position: { x: 12.5, y: 0.55, z: -6 },
      size: { x: 0.9, y: 1.1, z: 9 },
      color: '#3d4759',
    },

    // -------------------------------------------------- background massing
    {
      id: 'tower-a',
      kind: 'prop',
      position: { x: -38, y: 0.2, z: -34 },
      size: { x: 14, y: 70, z: 14 },
      color: '#232b38',
      receiveShadow: false,
    },
    {
      id: 'tower-b',
      kind: 'prop',
      position: { x: 36, y: 12.7, z: -40 },
      size: { x: 18, y: 95, z: 18 },
      color: '#1e2530',
      receiveShadow: false,
    },
    {
      id: 'tower-c',
      kind: 'prop',
      position: { x: 44, y: -10.8, z: 26 },
      size: { x: 12, y: 48, z: 12 },
      color: '#28313f',
      receiveShadow: false,
    },
  ],
};
