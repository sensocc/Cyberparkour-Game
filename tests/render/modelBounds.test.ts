/**
 * `DRESSING` is measured from the model files, and this is what keeps it that way.
 *
 * The generator declares a box for every imported prop: the space it occupies, used by the
 * placement pass to decide whether a piece of furniture fits where it is being put. That table is
 * the one place in the codebase where a **hand-written number stands in for art**, so it drifts the
 * moment a model is replaced - and it did. Before V2.0.5 it declared `cable-small` 3 m tall (it
 * draws at 2.85 m, with its geometry starting 2.84 m *below* its own origin), `antenna-1` 3.9 m (it
 * is 4.97 m) and sixteen others up to 0.45 m too tall.
 *
 * `tools/models/bounds.ts` reads the glTF/GLB directly, and this holds the table to it.
 *
 * **Two things are deliberately not compared.**
 *
 *  - The characters. Their files are stored in a bind pose whose arms span 3.24 units, so the raw
 *    box is about 2 m wide at the scales used; the table keeps a hand-tuned person-sized footprint
 *    because the placement pass needs one, and only the *height* is taken from the file. That
 *    exception is stated here rather than being a hole in the test.
 *  - Exactness. The table is rounded to centimetres for readability, so the comparison is on a
 *    2 cm tolerance - tight enough that a replaced model fails, loose enough that the rounding is
 *    not what is being tested.
 */

import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DRESSING } from '../../src/game/level/city.js';
import type { GltfPropModelId } from '../../src/game/level/levelData.js';
import { PROP_MODEL_URLS } from '../../src/render/propModels.js';
import { readModelBounds } from '../../tools/models/bounds.ts';

/** Repository root, from this file's own location. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** The assets folder the model URLs point into, as a real path. */
const MODELS = join(ROOT, 'src/assets/models');

/** Models whose declared footprint is a design decision rather than a measurement. */
const HAND_SIZED: ReadonlySet<GltfPropModelId> = new Set(['npc-a', 'npc-b']);

/** How far the declared box may differ from the measured one, in metres. */
const TOLERANCE = 0.02;

/**
 * The file on disk for a model id.
 *
 * `PROP_MODEL_URLS` holds the bundler's URL for each model, which in a test is a path relative to
 * the source tree (`../assets/models/ac.gltf?url` → `/src/assets/models/ac.gltf`). Rather than
 * parse that, the id is looked up with both extensions, which is simpler and cannot silently match
 * the wrong file.
 */
function fileFor(id: GltfPropModelId): string | null {
  for (const extension of ['.gltf', '.glb']) {
    const path = join(MODELS, `${id}${extension}`);
    if (existsSync(path)) return path;
  }
  return null;
}

describe('the declared size of every imported model', () => {
  const ids = Object.keys(DRESSING) as GltfPropModelId[];

  it('covers every model the renderer can load, and nothing else', () => {
    // A model added to `PROP_MODEL_URLS` but not to `DRESSING` would place with an undefined box;
    // one in `DRESSING` with no file would be a stray. Both are worth failing on.
    expect([...ids].sort()).toEqual([...Object.keys(PROP_MODEL_URLS)].sort());
    expect(ids.length).toBeGreaterThan(20);
  });

  it('matches the geometry in the file it names', () => {
    const mismatches: string[] = [];

    for (const id of ids) {
      const file = fileFor(id);
      if (!file) {
        mismatches.push(`${id}: no model file on disk`);
        continue;
      }

      const bounds = readModelBounds(file);
      const { size, scale } = DRESSING[id];

      for (const [axis, index] of [['x', 0], ['y', 1], ['z', 2]] as const) {
        const drawn = bounds.size[index] * scale;
        const declared = size[index];

        // Characters: the footprint is hand-set, so only their height is held to the file.
        if (HAND_SIZED.has(id) && axis !== 'y') continue;

        if (Math.abs(drawn - declared) > TOLERANCE) {
          mismatches.push(
            `${id}.${axis}: declared ${declared.toFixed(2)} m, drawn ${drawn.toFixed(2)} m ` +
              `(${Math.abs(drawn - declared).toFixed(2)} m out)`,
          );
        }
      }
    }

    expect(mismatches, 'DRESSING has drifted from the model files').toEqual([]);
  });

  it('keeps a person-sized footprint for the characters', () => {
    // The one deliberate departure from the measurement, asserted so it cannot quietly become a
    // 2 m-wide citizen again: the bind pose is a T-pose and its arm span is not a footprint.
    for (const id of ['npc-a', 'npc-b'] as const) {
      const { size } = DRESSING[id];
      expect(size[0], `${id} width`).toBeLessThan(1.2);
      expect(size[2], `${id} depth`).toBeLessThan(1.2);
      expect(size[1], `${id} height`).toBeGreaterThan(1.5);
    }
  });
});
