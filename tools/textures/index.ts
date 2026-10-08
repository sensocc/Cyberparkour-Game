/**
 * The asset registry.
 *
 * One list of everything the renderer loads. `npm run assets` writes it;
 * `tests/render/textures.test.ts` regenerates it and compares pixels, so the
 * committed PNGs can never silently go stale.
 */

import { generateCityBackdrop } from './city.ts';
import type { RgbaImage } from './png.ts';
import { SKYBOX_FACES, generateSkyboxFace } from './skybox.ts';
import { SURFACE_TEXTURES } from './surfaces.ts';

export interface AssetDefinition {
  /** File name inside the texture directory. */
  readonly name: string;
  /** World metres covered by one tile, for surfaces the renderer repeats. */
  readonly metresPerTile?: number;
  readonly generate: () => RgbaImage;
}

/** Edge length of a skybox face, in pixels. */
export const SKYBOX_FACE_SIZE = 256;

/** The two flat backdrop textures from V0.1. */
export const BACKDROP_TEXTURES: readonly AssetDefinition[] = [
  { name: 'city-backdrop.png', generate: () => generateCityBackdrop() },
];

/** The six faces of the V0.2 cube skybox, in three.js order. */
export const SKYBOX_TEXTURES: readonly AssetDefinition[] = SKYBOX_FACES.map((face) => ({
  name: `sky-${face}.png`,
  generate: () => generateSkyboxFace(face, SKYBOX_FACE_SIZE),
}));

/** The tileable object surfaces. */
export const OBJECT_TEXTURES: readonly AssetDefinition[] = SURFACE_TEXTURES.map((surface) => ({
  name: `surface-${surface.id}.png`,
  metresPerTile: surface.metresPerTile,
  generate: () => surface.generate(),
}));

/** Everything the demo ships, in a stable order. */
export const TEXTURES: readonly AssetDefinition[] = [
  ...BACKDROP_TEXTURES,
  ...SKYBOX_TEXTURES,
  ...OBJECT_TEXTURES,
];
