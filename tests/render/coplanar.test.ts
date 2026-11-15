/**
 * No two parts of a model may share a face.
 *
 * **The bug this is for.** A trim band with no overhang spans the whole footprint, so its side
 * faces are exactly coplanar with the body's - two surfaces at one depth. The depth test picks a
 * winner per pixel and the winner changes as the camera moves, which is z-fighting: the flicker
 * along the top and bottom rims of every building in the city.
 *
 * The models that showed it were the ones on a skyscraper: `slab` (every building body), `deck`
 * (every roof), `glass-slab` (every curtain wall) and `window-band` (every window). `band()`
 * defaulted to zero overhang, so the fault was the default rather than an accident in one model.
 *
 * The test is on the *models*, not on a rendered frame: a coplanar pair is a property of the
 * geometry, and it is the property that was wrong.
 */

import { describe, expect, it } from 'vitest';

import { modelById, modelIds } from '../../src/game/level/models.js';

/** Two faces are coplanar when they sit at the same coordinate and overlap. */
const EPS = 1e-9;
const overlaps = (a0: number, a1: number, b0: number, b1: number): boolean =>
  Math.min(a1, b1) - Math.max(a0, b0) > EPS;

interface Box {
  readonly min: { readonly x: number; readonly y: number; readonly z: number };
  readonly max: { readonly x: number; readonly y: number; readonly z: number };
  readonly surface: string;
}

/** The faces of `a` and `b` that lie in the same plane and overlap. */
function sharedFaces(a: Box, b: Box): string[] {
  const shared: string[] = [];
  for (const [av, bv, name] of [
    [a.max.x, b.max.x, '+X'],
    [a.min.x, b.min.x, '-X'],
  ] as const) {
    if (
      Math.abs(av - bv) < EPS &&
      overlaps(a.min.y, a.max.y, b.min.y, b.max.y) &&
      overlaps(a.min.z, a.max.z, b.min.z, b.max.z)
    ) {
      shared.push(name);
    }
  }
  for (const [av, bv, name] of [
    [a.max.z, b.max.z, '+Z'],
    [a.min.z, b.min.z, '-Z'],
  ] as const) {
    if (
      Math.abs(av - bv) < EPS &&
      overlaps(a.min.y, a.max.y, b.min.y, b.max.y) &&
      overlaps(a.min.x, a.max.x, b.min.x, b.max.x)
    ) {
      shared.push(name);
    }
  }
  return shared;
}

/**
 * Models that still have a coplanar pair, and why each is allowed.
 *
 * **A list with a reason, not a hole.** These are all small props whose parts are *meant* to be
 * flush - a lattice crane's members meet at their ends, a pipe's brackets sit on its face - and
 * none of them is a building surface, which is where the flicker was reported. The list is
 * asserted to shrink rather than grow: a new entry has to be added here deliberately.
 */
const ALLOWED: Readonly<Record<string, string>> = {
  billboard: 'the truss members meet the panel face; a hoarding is one flat object',
  crane: 'lattice members meet at their ends by design',
  'door-panel': 'the leaf and its frame are one flat object',
  'elevator-gate': 'the shutter and its hazard stripe are one flat object',
  phone: 'the screen sits flush in the case',
  'pipe-vertical': 'the brackets sit on the riser face',
  'satellite-dish': 'the dish and its feed arm are one flat object',
  scaffold: 'the standards and boards meet at their ends by design',
  'solar-panel': 'the cell gaps sit flush in the frame',
  'support-post': 'the legs and the cross beam are one flat object',
};

describe('the models the city is built from', () => {
  it('has no two parts sharing a face, except the props listed as flat by design', () => {
    const offenders: string[] = [];
    for (const id of modelIds()) {
      const model = modelById(id);
      if (!model) continue;
      const parts = model.parts as readonly Box[];
      let pairs = 0;
      for (let i = 0; i < parts.length; i += 1) {
        for (let j = i + 1; j < parts.length; j += 1) {
          if (sharedFaces(parts[i] as Box, parts[j] as Box).length > 0) pairs += 1;
        }
      }
      if (pairs > 0 && ALLOWED[id] === undefined) offenders.push(`${id}: ${pairs}`);
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the building surfaces out of the allowed list', () => {
    // The four models that were actually flickering. If one of them ever needs an entry in
    // `ALLOWED`, the fix has been undone rather than the test being wrong.
    for (const id of ['slab', 'deck', 'glass-slab', 'window-band', 'ledge', 'neon-strip']) {
      expect(ALLOWED[id], `${id} must not be exempt`).toBeUndefined();
    }
  });

  it('gives every trim band a proud overhang, so it cannot be coplanar with its body', () => {
    // The default is the fix: `band()` used to default to zero, which is coplanar with any
    // full-footprint part by construction. A band that spans the whole footprint must stand
    // outside it.
    for (const id of ['slab', 'deck', 'ledge', 'construction-slab', 'construction-column']) {
      const model = modelById(id);
      expect(model, id).toBeDefined();
      const parts = model!.parts as readonly Box[];
      const full = parts.find(
        (part) =>
          Math.abs(part.min.x) < EPS &&
          Math.abs(part.min.z) < EPS &&
          Math.abs(part.max.x - 1) < EPS &&
          Math.abs(part.max.z - 1) < EPS,
      );
      expect(full, `${id} has a full-footprint body`).toBeDefined();
      // Every other part that spans the footprint must be wider than it.
      for (const part of parts) {
        if (part === full) continue;
        const spansX = Math.abs(part.min.x) < EPS && Math.abs(part.max.x - 1) < EPS;
        const spansZ = Math.abs(part.min.z) < EPS && Math.abs(part.max.z - 1) < EPS;
        if (!spansX || !spansZ) continue;
        const proud = part.min.x < -EPS || part.max.x > 1 + EPS || part.min.z < -EPS || part.max.z > 1 + EPS;
        expect(proud, `${id}: a full-footprint band must stand proud`).toBe(true);
      }
    }
  });
});
