/**
 * Simplistic roof models.
 *
 * V0.1's props were single boxes. V0.2 gives them *shape*: a model is a handful of
 * axis-aligned parts, and the scene builder emits one mesh per part.
 *
 * Parts are expressed in **normalised** coordinates: `[0, 1]` across the prop's
 * own bounding box, with `y` running from the prop's underside to its top. That
 * one decision means any model can be fitted to any prop size, so the same
 * `ac-unit` model works at 3 x 1.7 x 2.4 m and at any other size, and a `slab`
 * works for a 48 m deck and a 0.6 m kerb. A part may exceed `[0, 1]`, which is
 * how detail is added that deliberately sticks out past the collider (a duct's
 * stiffener, a pipe's brackets).
 *
 * Collision stays the prop's box. The parts are surface detail - inset grilles,
 * flush trim, overhanging lips - and a box collider is the right approximation
 * for all of them; V0.6 is where collision gets better.
 */

import type { ReadonlyVec3 } from '../../core/vec3.js';

export interface ModelPart {
  /** Lower corner in normalised prop space, per axis. */
  readonly min: ReadonlyVec3;
  /** Upper corner in normalised prop space, per axis. */
  readonly max: ReadonlyVec3;
  /** Which surface material to texture this part with. */
  readonly surface: string;
  readonly castShadow?: boolean;
  readonly receiveShadow?: boolean;
}

export interface ModelDefinition {
  readonly id: string;
  /** Human-facing note about which way the model is oriented. */
  readonly note?: string;
  /**
   * Whether the model hangs on a wall rather than standing on something.
   *
   * A flag rather than a list of ids in every test that needs it: mounted props do
   * not follow the "stacked on a top face" rule that the rest of the district does, so
   * anything that checks that rule has to be able to ask.
   */
  readonly mounted?: boolean;
  readonly parts: readonly ModelPart[];
}

function part(
  min: readonly [number, number, number],
  max: readonly [number, number, number],
  surface: string,
  flags: { castShadow?: boolean; receiveShadow?: boolean } = {},
): ModelPart {
  return {
    min: { x: min[0], y: min[1], z: min[2] },
    max: { x: max[0], y: max[1], z: max[2] },
    surface,
    ...flags,
  };
}

/** A band across the whole footprint, for trims and flanges. */
function band(from: number, to: number, surface: string, overhang = 0): ModelPart {
  return part([-overhang, from, -overhang], [1 + overhang, to, 1 + overhang], surface);
}

/** Four corner posts, for legs and frames. */
function corners(surface: string, thickness: number, from: number, to: number): ModelPart[] {
  const t = thickness;
  return [
    part([0, from, 0], [t, to, t], surface),
    part([1 - t, from, 0], [1, to, t], surface),
    part([0, from, 1 - t], [t, to, 1], surface),
    part([1 - t, from, 1 - t], [1, to, 1], surface),
  ];
}

// --------------------------------------------------------------- structural

const slab: ModelDefinition = {
  id: 'slab',
  note: 'A plain Platform: catches everything from a roof deck to a kerb.',
  parts: [
    part([0, 0, 0], [1, 1, 1], 'concrete'),
    band(0.9, 0.98, 'concrete-dark', 0.01),
    band(0, 0.04, 'concrete-dark'),
  ],
};

const deck: ModelDefinition = {
  id: 'deck',
  note: 'A walkable deck: tread plate with a hazard-striped lip.',
  parts: [
    part([0, 0, 0], [1, 1, 1], 'deck'),
    band(0.86, 0.98, 'deck-dark', 0.006),
    band(0, 0.03, 'deck-dark'),
  ],
};

const crate: ModelDefinition = {
  id: 'crate',
  note: 'A shipping crate, banded and rusted.',
  parts: [
    part([0, 0, 0], [1, 1, 1], 'rust'),
    band(0.84, 0.96, 'metal-dark', 0.012),
    band(0.02, 0.1, 'metal-dark', 0.012),
    part([0.46, 0.02, -0.006], [0.54, 0.84, 1.006], 'metal-dark'),
    part([-0.006, 0.02, 0.46], [1.006, 0.84, 0.54], 'metal-dark'),
  ],
};

const ledge: ModelDefinition = {
  id: 'ledge',
  note: 'A step or block, with a hazard-marked nosing so its edge reads.',
  parts: [
    part([0, 0, 0], [1, 1, 1], 'concrete'),
    band(0.84, 1, 'hazard', 0.008),
    band(0, 0.06, 'concrete-dark'),
  ],
};

const supportPost: ModelDefinition = {
  id: 'support-post',
  note: 'A pair of legs with a cross beam, for carrying a duct or pipe.',
  parts: [
    part([0, 0, 0], [0.22, 1, 1], 'metal-dark'),
    part([0.78, 0, 0], [1, 1, 1], 'metal-dark'),
    band(0.82, 1, 'metal'),
    part([0, 0.42, -0.02], [1, 0.52, 1.02], 'metal'),
  ],
};

const block: ModelDefinition = {
  id: 'block',
  note: 'A low plinth or bulkhead.',
  parts: [
    part([0, 0, 0], [1, 1, 1], 'concrete-dark'),
    band(0.88, 1, 'metal-dark', 0.01),
    part([0.1, 0.3, 0.98], [0.9, 0.7, 1.01], 'metal'),
  ],
};

// ------------------------------------------------------------------- plant

const acUnit: ModelDefinition = {
  id: 'ac-unit',
  note: 'Faces +Z: the grille and fan are on that side.',
  parts: [
    part([0, 0.05, 0], [1, 0.95, 1], 'metal'),
    band(0, 0.05, 'metal-dark'),
    band(0.95, 1, 'metal-light', 0.008),
    // Grille panel across the +Z face.
    part([0.03, 0.14, 0.985], [0.97, 0.86, 1.01], 'grille'),
    // Fan housing and hub inside it.
    part([0.3, 0.24, 1.005], [0.7, 0.76, 1.02], 'metal-dark'),
    part([0.45, 0.45, 1.015], [0.55, 0.55, 1.03], 'metal-light'),
    // Service pipes rising from the top.
    part([0.12, 0.95, 0.16], [0.22, 1.16, 0.26], 'rust'),
    part([0.12, 0.95, 0.42], [0.22, 1.08, 0.52], 'rust'),
  ],
};

const ventStack: ModelDefinition = {
  id: 'vent-stack',
  parts: [
    band(0, 0.08, 'metal-dark', 0.1),
    part([0.06, 0.06, 0.06], [0.94, 0.84, 0.94], 'metal'),
    band(0.84, 0.94, 'metal-light', 0.05),
    part([0.2, 0.94, 0.2], [0.8, 1, 0.8], 'metal-dark'),
    band(0.28, 0.33, 'metal-light', 0.02),
    band(0.6, 0.65, 'metal-light', 0.02),
    part([0.4, 0.65, 0.4], [0.6, 0.84, 0.6], 'rust'),
  ],
};

const duct: ModelDefinition = {
  id: 'duct',
  note: 'A raised trunk: passable underneath if the prop box clears the player.',
  parts: [
    band(0.02, 0.98, 'metal-light'),
    part([-0.05, -0.05, 0.22], [1.05, 1.05, 0.28], 'metal'),
    part([-0.05, -0.05, 0.68], [1.05, 1.05, 0.74], 'metal'),
    band(0.98, 1.04, 'metal-dark'),
  ],
};

const pipeRun: ModelDefinition = {
  id: 'pipe-run',
  note: 'Runs along Z: the prop should be longest on that axis.',
  parts: [
    part([0.26, 0.26, 0], [0.74, 0.74, 1], 'rust'),
    part([0.2, 0.2, 0.24], [0.8, 0.8, 0.3], 'metal-dark'),
    part([0.2, 0.2, 0.62], [0.8, 0.8, 0.68], 'metal-dark'),
    part([0.2, 0.2, 0.94], [0.8, 0.8, 0.99], 'metal-dark'),
    part([0, 0, 0.12], [1, 0.3, 0.2], 'metal-dark'),
    part([0, 0, 0.74], [1, 0.3, 0.82], 'metal-dark'),
  ],
};

const pipeVertical: ModelDefinition = {
  id: 'pipe-vertical',
  note: 'A climbable riser: brackets all the way up.',
  parts: [
    part([0.3, 0.04, 0.3], [0.7, 1, 0.7], 'rust'),
    part([0.24, 0, 0.24], [0.76, 0.06, 0.76], 'metal-dark'),
    part([0.22, 0.3, 0.22], [0.78, 0.36, 0.78], 'metal-dark'),
    part([0.22, 0.63, 0.22], [0.78, 0.69, 0.78], 'metal-dark'),
    part([0.22, 0.96, 0.22], [0.78, 1, 0.78], 'metal-dark'),
    // A single rung ladder on the -X face, to read as climbable.
    part([-0.03, 0.08, 0.36], [-0.01, 0.98, 0.44], 'metal-light'),
    part([-0.03, 0.08, 0.56], [-0.01, 0.98, 0.64], 'metal-light'),
    part([-0.03, 0.2, 0.34], [-0.01, 0.26, 0.66], 'metal-light'),
    part([-0.03, 0.5, 0.34], [-0.01, 0.56, 0.66], 'metal-light'),
    part([-0.03, 0.8, 0.34], [-0.01, 0.86, 0.66], 'metal-light'),
  ],
};

const stairBulkhead: ModelDefinition = {
  id: 'stair-bulkhead',
  note: 'Roof access: walls with a door on the +Z face and vents on the roof.',
  parts: [
    part([0, 0, 0], [1, 1, 1], 'concrete'),
    band(0.93, 1, 'concrete-dark', 0.02),
    band(0, 0.07, 'concrete-dark', 0.01),
    part([0.36, 0.02, 0.985], [0.64, 0.68, 1.005], 'metal-dark'),
    part([0.33, 0.02, 0.99], [0.67, 0.72, 1.012], 'metal'),
    part([0.34, 0.3, 1.006], [0.66, 0.34, 1.016], 'metal-light'),
    part([-0.04, 0, 0.93], [1.04, 0.09, 1.06], 'concrete-dark'),
    part([0.12, 1, 0.16], [0.3, 1.1, 0.34], 'metal'),
    part([0.66, 1, 0.62], [0.84, 1.1, 0.8], 'metal'),
  ],
};

const antennaMast: ModelDefinition = {
  id: 'antenna-mast',
  note: 'A climbable mast with cross-arms and a dish.',
  parts: [
    band(0, 0.04, 'metal-dark', 0.25),
    band(0, 0.1, 'concrete-dark', 0.2),
    part([0.4, 0.1, 0.4], [0.6, 1, 0.6], 'metal-light'),
    part([-0.5, 0.62, 0.44], [1.5, 0.66, 0.56], 'metal-dark'),
    part([-0.3, 0.8, 0.44], [1.3, 0.84, 0.56], 'metal-dark'),
    part([-0.15, 0.86, 0.3], [0.4, 0.96, 0.7], 'metal'),
    part([0.42, 1, 0.42], [0.58, 1.05, 0.58], 'hazard'),
  ],
};

const satelliteDish: ModelDefinition = {
  id: 'satellite-dish',
  parts: [
    band(0, 0.06, 'metal-dark', 0.3),
    part([0.44, 0.06, 0.44], [0.56, 0.55, 0.56], 'metal-light'),
    part([-0.2, 0.5, 0.16], [1.2, 1, 0.66], 'metal'),
    part([0.36, 0.62, 0.1], [0.64, 0.74, 0.22], 'metal-dark'),
    part([-0.2, 0.5, 0.58], [1.2, 0.56, 0.62], 'metal-dark'),
  ],
};

const junctionBox: ModelDefinition = {
  id: 'junction-box',
  parts: [
    part([0, 0, 0], [1, 0.74, 1], 'metal-dark'),
    band(0.74, 0.82, 'metal', 0.02),
    part([0.28, 0.82, 0.32], [0.72, 1, 0.68], 'rust'),
    part([0.1, 0.2, 0.985], [0.9, 0.6, 1.01], 'hazard'),
  ],
};

const waterTank: ModelDefinition = {
  id: 'water-tank',
  parts: [
    ...corners('metal-dark', 0.14, 0, 0.3),
    part([0.02, 0.28, 0.02], [0.98, 0.88, 0.98], 'metal-warm'),
    band(0.88, 0.96, 'metal-light', 0.03),
    part([0.36, 0.96, 0.36], [0.64, 1, 0.64], 'metal-dark'),
    band(0.42, 0.47, 'metal-light', 0.015),
    band(0.62, 0.67, 'metal-light', 0.015),
  ],
};

const cableSpool: ModelDefinition = {
  id: 'cable-spool',
  parts: [
    band(0.02, 0.12, 'metal-warm', 0.04),
    band(0.86, 0.96, 'metal-warm', 0.04),
    part([0.26, 0.12, 0.26], [0.74, 0.86, 0.74], 'rust'),
    part([0.44, 0.02, 0.44], [0.56, 0.12, 0.56], 'metal-dark'),
  ],
};

const skylight: ModelDefinition = {
  id: 'skylight',
  parts: [
    band(0, 0.34, 'concrete-dark'),
    part([0.06, 0.34, 0.06], [0.94, 0.96, 0.94], 'glass'),
    part([0.44, 0.34, 0.44], [0.56, 1, 0.56], 'metal-dark'),
    part([0.06, 0.96, 0.06], [0.94, 1, 0.94], 'metal'),
    part([0.02, 0.34, 0.02], [0.06, 0.44, 0.06], 'metal'),
    part([0.94, 0.34, 0.94], [0.98, 0.44, 0.98], 'metal'),
  ],
};

const barrier: ModelDefinition = {
  id: 'barrier',
  parts: [
    part([0, 0, 0.34], [1, 0.2, 0.66], 'concrete-dark'),
    part([0.04, 0.2, 0.02], [1, 1, 0.98], 'hazard'),
    band(0.86, 0.94, 'metal-dark', 0.02),
  ],
};

// ------------------------------------------------------- signage and doors

const neonSign: ModelDefinition = {
  id: 'neon-sign',
  mounted: true,
  note: 'A lit sign panel on a frame. The glowing face is +Z.',
  parts: [
    // The dark housing, so a sign is a solid object and not a floating plane.
    part([0, 0, 0], [1, 1, 0.72], 'metal-dark'),
    band(0, 0.05, 'metal', 0.015),
    band(0.95, 1, 'metal', 0.015),
    // The lit face, proud of the housing so it catches the eye from the side too.
    part([0.06, 0.06, 0.72], [0.94, 0.94, 1], 'neon'),
    // A bracket on the back, for mounting to a facade.
    part([0.36, 0.36, -0.22], [0.64, 0.64, 0], 'metal-dark'),
  ],
};

/**
 * A wide fascia light: one long tube in a slim housing with capped ends.
 *
 * `neon-sign` is a *panel*, and a district of panels is a district of the same sign
 * at different sizes. V0.6.1 added this and the three below so the signage has
 * silhouettes as well as colours: a bar for a shopfront, a blade for the corner of a
 * building, a frame for a facade, a badge for a doorway.
 */
const neonBar: ModelDefinition = {
  id: 'neon-bar',
  mounted: true,
  note: 'A wide light bar with capped ends. The glowing face is +Z.',
  parts: [
    part([0, 0, 0], [1, 1, 0.6], 'metal-dark'),
    part([0.04, 0.24, 0.6], [0.96, 0.76, 0.92], 'neon'),
    part([0, 0.08, 0.6], [0.04, 0.92, 1], 'metal'),
    part([0.96, 0.08, 0.6], [1, 0.92, 1], 'metal'),
    // Brackets, so the bar stands off the wall rather than being glued to it.
    part([0.16, 0.34, -0.16], [0.26, 0.66, 0], 'metal-dark'),
    part([0.74, 0.34, -0.16], [0.84, 0.66, 0], 'metal-dark'),
  ],
};

/**
 * A projecting blade: the tall sign on the corner of a building.
 *
 * The blade itself is inset in X, so a prop sized 2 x 6 m gives a 1.2 m blade standing
 * a metre off the facade rather than a 2 m slab against it.
 */
const neonBlade: ModelDefinition = {
  id: 'neon-blade',
  mounted: true,
  note: 'A tall projecting blade on a bracket. The glowing face is +Z.',
  parts: [
    part([0.2, 0, 0], [0.8, 1, 0.5], 'metal-dark'),
    part([0.26, 0.05, 0.5], [0.74, 0.95, 0.74], 'neon'),
    // The arm that carries it, reaching back to the wall.
    part([0.34, 0.86, -0.42], [0.66, 1, 0], 'metal'),
    part([0.28, 0.8, -0.12], [0.72, 1, 0.06], 'metal-dark'),
  ],
};

/** A neon tube frame: four lit bars round a dark backing, so the wall shows through. */
const neonFrame: ModelDefinition = {
  id: 'neon-frame',
  mounted: true,
  note: 'A tube frame round a dark backing. The glowing face is +Z.',
  parts: [
    part([0, 0, 0], [1, 1, 0.34], 'metal-dark'),
    part([0, 0, 0.34], [1, 0.14, 0.6], 'neon'),
    part([0, 0.86, 0.34], [1, 1, 0.6], 'neon'),
    part([0, 0.14, 0.34], [0.14, 0.86, 0.6], 'neon'),
    part([0.86, 0.14, 0.34], [1, 0.86, 0.6], 'neon'),
    part([0.44, 0.44, -0.16], [0.56, 0.56, 0], 'metal-dark'),
  ],
};

/** A badge: a lit rim round a dark centre, for a doorway or a hatch. */
const neonBadge: ModelDefinition = {
  id: 'neon-badge',
  mounted: true,
  note: 'A small badge with a lit rim and a dark centre. The glowing face is +Z.',
  parts: [
    part([0, 0, 0], [1, 1, 0.4], 'metal-dark'),
    part([0, 0, 0.4], [1, 1, 0.62], 'neon'),
    part([0.18, 0.18, 0.62], [0.82, 0.82, 0.72], 'metal-dark'),
  ],
};

const doorPanel: ModelDefinition = {
  id: 'door-panel',
  note: 'A swinging door leaf. Hinges about its -X edge, which is the origin.',
  parts: [
    part([0, 0, 0], [1, 1, 1], 'metal'),
    band(0.02, 0.14, 'metal-dark', 0.03),
    band(0.86, 0.98, 'metal-dark', 0.03),
    // A window in the upper half, so a door reads as a door at a glance.
    part([0.24, 0.5, 0.44], [0.76, 0.84, 0.58], 'glass'),
    // A handle on the far edge.
    part([0.82, 0.42, 0.9], [0.94, 0.54, 1.16], 'metal-light'),
    part([0.82, 0.32, 0.96], [0.94, 0.64, 1.04], 'metal-warm'),
  ],
};

// --------------------------------------------------- V0.5: lighting and lifts

const neonStrip: ModelDefinition = {
  id: 'neon-strip',
  mounted: true,
  note: 'A neon tube on a slim housing: lit all round, so it works flat or on a wall.',
  parts: [
    part([0, 0, 0], [1, 1, 1], 'neon'),
    // A dark base, so the tube reads as mounted on something rather than floating.
    part([0, 0, 0], [1, 0.18, 1], 'metal-dark'),
  ],
};

const liftPlatform: ModelDefinition = {
  id: 'lift-platform',
  note: 'A lift car: a hazard-edged deck over a machinery box.',
  parts: [
    part([0, 0, 0], [1, 0.34, 1], 'metal-dark'),
    band(0, 0.05, 'hazard', 0.008),
    // The walking surface, inset so the hazard lip frames it.
    part([0.035, 0.34, 0.035], [0.965, 0.88, 0.965], 'deck'),
    band(0.88, 1, 'hazard', 0.02),
    // Under-slung rails, so the car reads as hanging in its shaft.
    part([0.1, -0.06, 0.42], [0.9, 0.04, 0.58], 'metal'),
    part([0.42, -0.06, 0.1], [0.58, 0.04, 0.9], 'metal'),
  ],
};

const dataShard: ModelDefinition = {
  id: 'data-shard',
  note: 'A pickup: a lit core between two dark caps. Spins in the scene.',
  parts: [
    part([0.24, 0.24, 0.24], [0.76, 0.76, 0.76], 'neon'),
    part([0.36, 0.06, 0.36], [0.64, 0.3, 0.64], 'metal-dark'),
    part([0.36, 0.7, 0.36], [0.64, 0.94, 0.64], 'metal-dark'),
  ],
};

// ------------------------------------------------------------------ V0.7: city

/**
 * A ladder.
 *
 * Climbing it needs no new movement code: the climb ability already ascends a
 * `climbable` face and hands over to a mantle at the top, which is exactly what a
 * ladder is. What a ladder *does* need is rungs close enough together to read - which
 * is why rungs are a fixed count per model rather than a fraction of the height, and
 * why the city stacks several short ladders up a tall wall instead of stretching one.
 */
const ladder: ModelDefinition = {
  id: 'ladder',
  note: 'A rung ladder with rails. Climb the face that faces +Z.',
  mounted: true,
  parts: [
    part([0, 0, 0], [0.09, 1, 0.09], 'metal-light'),
    part([0.91, 0, 0], [1, 1, 0.09], 'metal-light'),
    // Ten rungs, so a 5 m ladder has them half a metre apart.
    ...[0.04, 0.14, 0.24, 0.34, 0.44, 0.54, 0.64, 0.74, 0.84, 0.94].map((y): ModelPart =>
      part([0.09, y, 0], [0.91, y + 0.035, 0.07], 'metal-warm'),
    ),
    // Stand-offs, so the rails are not flush against the wall.
    part([0, 0.02, -0.06], [0.09, 0.08, 0], 'metal-dark'),
    part([0.91, 0.02, -0.06], [1, 0.08, 0], 'metal-dark'),
  ],
};

/** A solar array: a dark cell grid in an aluminium frame, raised on a kerb. */
const solarPanel: ModelDefinition = {
  id: 'solar-panel',
  note: 'A photovoltaic array: cells in a frame, clear of the roof on a kerb.',
  parts: [
    part([0, 0, 0], [1, 0.22, 1], 'metal-dark'),
    part([0.02, 0.22, 0.02], [0.98, 0.3, 0.98], 'glass'),
    // Cell gaps: one bar each way across the glass, so it reads as an array.
    part([0.49, 0.3, 0.02], [0.51, 0.31, 0.98], 'metal-dark'),
    part([0.02, 0.3, 0.49], [0.98, 0.31, 0.51], 'metal-dark'),
    part([0, 0.3, 0.02], [0.98, 0.34, 0.06], 'metal-light'),
    part([0, 0.3, 0.94], [0.98, 0.34, 0.98], 'metal-light'),
  ],
};

/**
 * A giant billboard.
 *
 * The whole face is the emissive surface, so it glows edge to edge - which is what
 * separates a billboard from a sign: a sign has glyphs on a dark panel, a billboard
 * *is* the light. The truss behind it is what stops it looking like a floating sheet.
 */
const billboard: ModelDefinition = {
  id: 'billboard',
  note: 'A lit hoarding on a truss, glowing out of +Z.',
  mounted: true,
  parts: [
    part([0, 0, 0], [1, 1, 0.14], 'metal-dark'),
    part([0.015, 0.02, 0.14], [0.985, 0.98, 0.2], 'neon'),
    // The frame, proud of the face, so the light has an edge.
    part([0, 0, 0.14], [1, 0.045, 0.24], 'metal'),
    part([0, 0.955, 0.14], [1, 1, 0.24], 'metal'),
    part([0, 0.045, 0.14], [0.045, 0.955, 0.24], 'metal'),
    part([0.955, 0.045, 0.14], [1, 0.955, 0.24], 'metal'),
    // A truss: two posts and two chords, reaching back to the wall.
    part([0.12, 0.34, -0.5], [0.2, 0.66, 0], 'metal-dark'),
    part([0.8, 0.34, -0.5], [0.88, 0.66, 0], 'metal-dark'),
    part([0.12, 0.44, -0.5], [0.88, 0.56, -0.42], 'metal'),
  ],
};

/**
 * A tower crane: mast, jib, counterweight and hook.
 *
 * The one model in the library that is deliberately an L, because that is what a
 * crane is - so the prop's box covers the whole swing and the parts place themselves
 * inside it.
 */
const crane: ModelDefinition = {
  id: 'crane',
  note: 'A tower crane: lattice mast, jib and hook. The mast is at the +X end.',
  parts: [
    // Mast: four posts and a few horizontal ties.
    part([0.44, 0, 0.44], [0.5, 1, 0.5], 'hazard'),
    part([0.5, 0, 0.44], [0.56, 1, 0.5], 'hazard'),
    part([0.44, 0, 0.5], [0.5, 1, 0.56], 'hazard'),
    part([0.5, 0, 0.5], [0.56, 1, 0.56], 'hazard'),
    ...[0.08, 0.24, 0.4, 0.56, 0.72, 0.88].map((y): ModelPart =>
      part([0.43, y, 0.43], [0.57, y + 0.02, 0.57], 'metal-light'),
    ),
    // The jib, running out from the mast head.
    part([0, 0.94, 0.46], [1, 0.99, 0.54], 'hazard'),
    part([0, 0.86, 0.48], [1, 0.88, 0.52], 'metal-light'),
    part([0.02, 0.88, 0.46], [0.04, 0.94, 0.54], 'metal-light'),
    part([0.3, 0.88, 0.46], [0.32, 0.94, 0.54], 'metal-light'),
    part([0.6, 0.88, 0.46], [0.62, 0.94, 0.54], 'metal-light'),
    part([0.88, 0.88, 0.46], [0.9, 0.94, 0.54], 'metal-light'),
    // Counterweight, and the hook hanging off the working end.
    part([0, 0.82, 0.42], [0.1, 0.9, 0.58], 'concrete-dark'),
    part([0.99, 0.34, 0.48], [1, 0.86, 0.52], 'metal-dark'),
    part([0.94, 0.24, 0.44], [1, 0.34, 0.56], 'metal-warm'),
  ],
};

/** Scaffolding: standards, ledgers and three boarded lifts. */
const scaffold: ModelDefinition = {
  id: 'scaffold',
  note: 'Scaffolding with three boarded levels. Open on the +Z side.',
  parts: [
    ...corners('metal-light', 0.06, 0, 1),
    ...[0.0, 0.33, 0.66].map((y): ModelPart =>
      part([-0.01, y, -0.01], [1.01, y + 0.03, 1.01], 'metal-light'),
    ),
    ...[0.32, 0.65, 0.98].map((y): ModelPart =>
      part([0, y, 0], [1, y + 0.05, 0.94], 'metal-warm'),
    ),
    ...[0.32, 0.65, 0.98].map((y): ModelPart =>
      part([0, y + 0.05, 0], [1, y + 0.09, 0.06], 'hazard'),
    ),
  ],
};

/** An unfinished floor: a slab with column stubs and starter bars. */
const constructionSlab: ModelDefinition = {
  id: 'construction-slab',
  note: 'A poured floor with column stubs and starter bars poking out of it.',
  parts: [
    part([0, 0, 0], [1, 1, 1], 'concrete-dark'),
    band(0.94, 1, 'concrete'),
    // Columns that stop dead, which is what makes a carcass a carcass.
    ...[
      [0.06, 0.06],
      [0.84, 0.06],
      [0.06, 0.84],
      [0.84, 0.84],
      [0.45, 0.06],
      [0.45, 0.84],
    ].map(([x, z]): ModelPart =>
      part([x as number, 1, z as number], [(x as number) + 0.1, 1.5, (z as number) + 0.1], 'concrete'),
    ),
    ...[
      [0.11, 0.11],
      [0.89, 0.11],
      [0.11, 0.89],
    ].map(([x, z]): ModelPart =>
      part([x as number, 1.5, z as number], [(x as number) + 0.02, 1.66, (z as number) + 0.02], 'rust'),
    ),
  ],
};

/** A bare concrete column, for the frame of a building under construction. */
const constructionColumn: ModelDefinition = {
  id: 'construction-column',
  note: 'A bare column: shuttered concrete with a rough cap.',
  parts: [
    part([0, 0, 0], [1, 1, 1], 'concrete'),
    band(0, 0.04, 'concrete-dark'),
    band(0.96, 1, 'concrete-dark'),
    part([0.1, 1, 0.1], [0.9, 1.02, 0.9], 'rust'),
  ],
};

/** A crown: the stepped top of a megablock, with its aerial cluster. */
const crown: ModelDefinition = {
  id: 'crown',
  note: 'A stepped roof crown with masts, for the tallest buildings.',
  parts: [
    part([0, 0, 0], [1, 0.42, 1], 'metal-dark'),
    part([0.12, 0.42, 0.12], [0.88, 0.72, 0.88], 'metal'),
    part([0.26, 0.72, 0.26], [0.74, 0.92, 0.74], 'metal-dark'),
    part([0.46, 0.92, 0.44], [0.54, 1, 0.56], 'metal-light'),
    part([0.16, 0.72, 0.46], [0.2, 0.98, 0.54], 'rust'),
    part([0.8, 0.72, 0.46], [0.84, 0.92, 0.54], 'rust'),
    part([0.46, 0.62, 0.1], [0.54, 0.78, 0.18], 'hazard'),
  ],
};

/** An elevator cab: floor, ceiling, three walls, a lit strip, a rail. */
const elevatorCab: ModelDefinition = {
  id: 'elevator-cab',
  note: 'A lift car, open on +Z. Its collider is the car floor.',
  parts: [
    part([0, 0, 0], [1, 1, 1], 'metal-dark'),
    part([0.04, 0.06, 0.04], [0.96, 0.12, 0.96], 'deck'),
    part([0.04, 0.88, 0.04], [0.96, 0.94, 0.96], 'metal-light'),
    // A lit panel in the ceiling: the one thing you see while you wait.
    part([0.22, 0.92, 0.28], [0.78, 0.96, 0.72], 'neon'),
    part([0.04, 0.4, 0.9], [0.96, 0.46, 0.96], 'metal-warm'),
  ],
};

/** An elevator gate: a slatted shutter that rolls up out of the way. */
const elevatorGate: ModelDefinition = {
  id: 'elevator-gate',
  note: 'A rolling shutter for a lift opening. Slides up its own face.',
  parts: [
    part([0, 0, 0], [1, 1, 1], 'metal-dark'),
    ...Array.from({ length: 8 }, (_, row): ModelPart =>
      part([0.03, row / 8, 0.5], [0.97, row / 8 + 0.1, 0.62], 'metal-light'),
    ),
    part([0, 0.96, 0.5], [1, 1, 0.7], 'hazard'),
  ],
};

const MODELS: readonly ModelDefinition[] = [
  slab,
  deck,
  crate,
  ledge,
  block,
  supportPost,
  acUnit,
  ventStack,
  duct,
  pipeRun,
  pipeVertical,
  stairBulkhead,
  antennaMast,
  satelliteDish,
  junctionBox,
  waterTank,
  cableSpool,
  skylight,
  barrier,
  neonSign,
  neonBar,
  neonBlade,
  neonFrame,
  neonBadge,
  doorPanel,
  neonStrip,
  liftPlatform,
  dataShard,
  ladder,
  solarPanel,
  billboard,
  crane,
  scaffold,
  constructionSlab,
  constructionColumn,
  crown,
  elevatorCab,
  elevatorGate,
];

const BY_ID = new Map(MODELS.map((model) => [model.id, model]));

/** Whether a prop of this model hangs on a wall. */
export function isMountedModel(id: string): boolean {
  return BY_ID.get(id)?.mounted === true;
}

export function modelById(id: string): ModelDefinition | undefined {
  return BY_ID.get(id);
}

export function modelIds(): string[] {
  return MODELS.map((model) => model.id).sort();
}

/**
 * The surface you would stand on if the model were a floor.
 *
 * The topmost part by normalised height: because parts scale linearly with the
 * prop, the part that is highest in model space is highest in world space too,
 * so this needs no prop size. V0.4 uses it to give every collider a footstep
 * sound derived from what it is actually made of.
 */
export function topSurface(model: ModelDefinition): string | undefined {
  let best: ModelPart | undefined;
  for (const entry of model.parts) {
    if (best === undefined || entry.max.y > best.max.y) best = entry;
  }
  return best?.surface;
}

export interface ResolvedPart {
  readonly min: ReadonlyVec3;
  readonly max: ReadonlyVec3;
  readonly surface: string;
  readonly castShadow: boolean;
  readonly receiveShadow: boolean;
}

/**
 * Fits a model into a prop's world-space box.
 *
 * Every part coordinate is normalised against the prop's bounds, so the same
 * model works at any scale.
 */
export function resolveModelParts(
  model: ModelDefinition,
  origin: ReadonlyVec3,
  size: ReadonlyVec3,
): ResolvedPart[] {
  return model.parts.map((entry) => ({
    min: {
      x: origin.x + entry.min.x * size.x,
      y: origin.y + entry.min.y * size.y,
      z: origin.z + entry.min.z * size.z,
    },
    max: {
      x: origin.x + entry.max.x * size.x,
      y: origin.y + entry.max.y * size.y,
      z: origin.z + entry.max.z * size.z,
    },
    surface: entry.surface,
    castShadow: entry.castShadow ?? true,
    receiveShadow: entry.receiveShadow ?? true,
  }));
}
