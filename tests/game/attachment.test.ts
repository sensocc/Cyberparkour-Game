/**
 * Nothing floats.
 *
 * The rule this file enforces: **every visible object is attached, through a chain of touching
 * boxes, to the ground or to a building.** Not "something is roughly underneath it" - a transitive
 * connection, because a ceiling lamp hanging from a bracket that is bolted to a wall is attached,
 * and a crate standing on a pallet standing on a deck is attached, and neither is attached if the
 * chain does not reach the street.
 *
 * **Why a graph and not a per-object check.** A per-object "is there something under me?" test is
 * exactly the test that misses the bugs this file exists for. A balcony deck has its bracket
 * underneath it and its bracket has the deck on top of it, so each answers "yes" while the pair
 * hangs in the air together. Only a connected-components search over the whole city answers the
 * question that was actually asked.
 *
 * **Why the tolerance is 0.25 m.** The city is full of props that meet exactly or overlap by a few
 * centimetres on purpose - a deck on its body, a ladder flush against a wall, a bush inside its
 * planter. A strict "overlap by more than zero" test would fail on floating-point noise at every
 * one of those joints. A quarter of a metre is far smaller than any prop and far larger than any
 * rounding, so it is a property of the *specification* rather than a knob to turn when the test
 * goes red. If this test fails, the geometry is wrong; do not widen the tolerance.
 *
 * The first run of this test on V2.0.4 found **508** props in ungrounded islands, in four
 * families, all of them placement faults in the generator. See `FLOATING-OBJECTS-ANALYSIS.md`.
 */

import { describe, expect, it } from 'vitest';

import { buildCity } from '../../src/game/level/city.js';
import { CITY_ENVIRONMENT } from '../../src/game/level/environment.js';
import type { PropDefinition } from '../../src/game/level/levelData.js';

/** How close two boxes must be to count as touching, in metres. See the header. */
const CONTACT_TOLERANCE = 0.25;

/** Side of a broadphase cell, in metres. Same order as the collision grid's. */
const CELL = 12;

/** Props wider than this go in the "always test me" list rather than the grid. */
const OVERSIZED = 40;

interface Box {
  readonly id: string;
  readonly model: string;
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
  readonly z0: number;
  readonly z1: number;
}

function boxOf(prop: PropDefinition): Box {
  return {
    id: prop.id,
    model: prop.model,
    x0: prop.position.x - prop.size.x / 2,
    x1: prop.position.x + prop.size.x / 2,
    y0: prop.position.y - prop.size.y / 2,
    y1: prop.position.y + prop.size.y / 2,
    z0: prop.position.z - prop.size.z / 2,
    z1: prop.position.z + prop.size.z / 2,
  };
}

/**
 * A spatial hash over the props, so the whole city is not compared with itself.
 *
 * Twelve thousand props against twelve thousand is 144 million pairs, and the ground slab alone is
 * 1200 m across - which is why the oversized ones are kept in a list that every query gets. This is
 * the same shape as the collision world's broadphase, for the same reason.
 */
function buildIndex(boxes: readonly Box[]): (index: number) => number[] {
  const grid = new Map<string, number[]>();
  const oversized: number[] = [];

  boxes.forEach((box, index) => {
    if (Math.max(box.x1 - box.x0, box.z1 - box.z0) > OVERSIZED) {
      oversized.push(index);
      return;
    }
    for (let gx = Math.floor(box.x0 / CELL); gx <= Math.floor(box.x1 / CELL); gx += 1) {
      for (let gz = Math.floor(box.z0 / CELL); gz <= Math.floor(box.z1 / CELL); gz += 1) {
        const key = `${gx},${gz}`;
        const bucket = grid.get(key);
        if (bucket) bucket.push(index);
        else grid.set(key, [index]);
      }
    }
  });

  return (index: number): number[] => {
    const box = boxes[index] as Box;
    const found = new Set<number>(oversized);
    for (let gx = Math.floor(box.x0 / CELL); gx <= Math.floor(box.x1 / CELL); gx += 1) {
      for (let gz = Math.floor(box.z0 / CELL); gz <= Math.floor(box.z1 / CELL); gz += 1) {
        for (const other of grid.get(`${gx},${gz}`) ?? []) found.add(other);
      }
    }
    found.delete(index);
    return [...found];
  };
}

/** Whether two boxes touch or overlap on every axis, within the tolerance. */
function touches(a: Box, b: Box): boolean {
  return (
    Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) >= -CONTACT_TOLERANCE &&
    Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) >= -CONTACT_TOLERANCE &&
    Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0) >= -CONTACT_TOLERANCE
  );
}

/** The prop family a floating id belongs to, for a failure message someone can act on. */
function familyOf(id: string): string {
  if (/-balcony-\d+(-bracket)?$/.test(id)) return 'tower balcony';
  if (/-part-\d+-\d+$/.test(id)) return 'corridor partition';
  if (/-(solar-[ab]-panel|tank)$/.test(id)) return 'interior rooftop kit';
  if (/-billboard$/.test(id)) return 'billboard';
  if (/^dress-/.test(id)) return 'imported furniture';
  return 'other';
}

describe('every visible object is attached to something attached to the ground', () => {
  const city = buildCity({
    id: 'neon-grid',
    name: 'Neon Grid',
    spawn: { position: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0 },
    killPlaneY: CITY_ENVIRONMENT.backdrop.baseY - 9,
    environment: CITY_ENVIRONMENT,
    props: [],
    checkpoints: [],
  });

  const boxes = city.props.map(boxOf);
  const neighbours = buildIndex(boxes);

  // Union-find: two props are in the same island if a chain of contacts joins them.
  const parent = boxes.map((_box, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) {
      parent[root] = parent[parent[root] as number] as number;
      root = parent[root] as number;
    }
    return root;
  };

  let unions = 0;
  for (let index = 0; index < boxes.length; index += 1) {
    for (const other of neighbours(index)) {
      if (other <= index) continue;
      if (!touches(boxes[index] as Box, boxes[other] as Box)) continue;
      const a = find(index);
      const b = find(other);
      if (a !== b) {
        parent[a] = b;
        unions += 1;
      }
    }
  }

  /** Roots with at least one member reaching the street. */
  const grounded = new Set<number>();
  const streetY = CITY_ENVIRONMENT.backdrop.baseY;
  for (let index = 0; index < boxes.length; index += 1) {
    if ((boxes[index] as Box).y0 <= streetY + 0.6) grounded.add(find(index));
  }

  /** How many props live in a grounded island - nearly all of them, when the city is sound. */
  let groundedMembers = 0;
  for (let index = 0; index < boxes.length; index += 1) {
    if (grounded.has(find(index))) groundedMembers += 1;
  }

  const floating = boxes
    .map((box, index) => ({ box, index }))
    .filter(({ index }) => !grounded.has(find(index)));

  it('finds a city worth checking, so the assertion below means something', () => {
    // Guard against a generator change that quietly empties the test: if the city stops being
    // built, or the index collapses to one bucket, "no floating objects" would pass for nothing.
    expect(boxes.length).toBeGreaterThan(10000);
    expect(unions).toBeGreaterThan(10000);
    // **One island, not many.** The ground slab reaches every building, so the sound city is a
    // single connected component with a handful of stranded fragments beside it. Asserting a
    // *count of grounded roots* would be the wrong guard: it is 1 today and would still be 1 on a
    // city where everything floats together. What matters is that the grounded mass dominates.
    expect(grounded.size).toBeGreaterThanOrEqual(1);
    expect(groundedMembers, 'the grounded island should hold nearly the whole city').toBeGreaterThan(
      boxes.length * 0.9,
    );
  });

  it('leaves nothing in an island that never reaches the ground', () => {
    const byFamily = new Map<string, string[]>();
    for (const { box } of floating) {
      const family = familyOf(box.id);
      const list = byFamily.get(family);
      if (list) list.push(box.id);
      else byFamily.set(family, [box.id]);
    }

    const report = [...byFamily.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([family, ids]) => `${family} (${ids.length}): ${ids.slice(0, 6).join(', ')}${ids.length > 6 ? ', …' : ''}`);

    expect(report, `${floating.length} props are in islands that never reach the ground`).toEqual([]);
  });
});
