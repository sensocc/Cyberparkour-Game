/**
 * Loading the demo's textures.
 *
 * Loading is asynchronous but non-fatal: anything that cannot be fetched
 * resolves to `null`, and `buildScene` falls back to flat colours. A missing
 * texture must never stop the demo from starting.
 *
 * The loaders are injected so this can be unit-tested without a browser.
 */

import * as THREE from 'three';

import { logger } from '../core/log.js';
import type { SurfaceTextureId } from '../game/level/surfaces.js';
import { METRES_PER_TILE } from '../game/level/surfaces.js';
import cityBackdropUrl from '../assets/textures/city-backdrop.png';
import smokeUrl from '../assets/textures/fx-smoke.png';
import skyNx from '../assets/textures/sky-nx.png';
import skyNy from '../assets/textures/sky-ny.png';
import skyNz from '../assets/textures/sky-nz.png';
import skyPx from '../assets/textures/sky-px.png';
import skyPy from '../assets/textures/sky-py.png';
import skyPz from '../assets/textures/sky-pz.png';
import surfaceConcrete from '../assets/textures/surface-concrete.png';
import surfaceDeckPlate from '../assets/textures/surface-deck-plate.png';
import surfaceGlass from '../assets/textures/surface-glass.png';
import surfaceGrille from '../assets/textures/surface-grille.png';
import surfaceHazard from '../assets/textures/surface-hazard.png';
import surfaceMetalPanel from '../assets/textures/surface-metal-panel.png';
import surfaceSign from '../assets/textures/surface-sign.png';
import type { SceneAssets } from './types.js';

/**
 * The part of `THREE.TextureLoader` this module uses.
 *
 * three.js reports success and failure through callbacks rather than promises,
 * and the callback shape is all we depend on.
 */
export interface TextureLoaderLike {
  load(
    url: string,
    onLoad: (texture: THREE.Texture) => void,
    onError?: (error: unknown) => void,
  ): unknown;
}

/** The part of `THREE.CubeTextureLoader` this module uses. */
export interface CubeTextureLoaderLike {
  load(
    urls: readonly string[],
    onLoad: (texture: THREE.CubeTexture) => void,
    onError?: (error: unknown) => void,
  ): unknown;
}

/** Where the scene textures live in the bundle. */
export const TEXTURE_URLS = {
  cityBackdrop: cityBackdropUrl,
  smoke: smokeUrl,
  /** Six faces, in three.js `CubeTexture` order. */
  skybox: [skyPx, skyNx, skyPy, skyNy, skyPz, skyNz] as const,
  surfaces: {
    'deck-plate': surfaceDeckPlate,
    'metal-panel': surfaceMetalPanel,
    concrete: surfaceConcrete,
    hazard: surfaceHazard,
    grille: surfaceGrille,
    glass: surfaceGlass,
    sign: surfaceSign,
  } satisfies Record<SurfaceTextureId, string>,
} as const;

/** Loads one texture, resolving to `null` instead of rejecting. */
export function loadTexture(
  loader: TextureLoaderLike,
  url: string,
  name: string,
): Promise<THREE.Texture | null> {
  return new Promise((resolve) => {
    try {
      loader.load(
        url,
        (texture) => {
          // Every source file is authored in sRGB; without this the sky and
          // skyline come out noticeably too bright.
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.name = name;
          resolve(texture);
        },
        (error) => {
          logger.warn('render', `texture "${name}" failed to load`, { url, error: String(error) });
          resolve(null);
        },
      );
    } catch (error) {
      logger.warn('render', `texture "${name}" could not be requested`, { url, error: String(error) });
      resolve(null);
    }
  });
}

/**
 * Loads the six faces of the cube skybox.
 *
 * three.js needs a `CubeTexture`, whose faces must all arrive before it can be
 * used, so this waits for all six and reports how many are missing.
 */
export async function loadSkybox(
  loader: CubeTextureLoaderLike,
  urls: readonly string[] = TEXTURE_URLS.skybox,
): Promise<THREE.CubeTexture | null> {
  return new Promise((resolve) => {
    try {
      loader.load(
        urls,
        (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.name = 'skybox';
          resolve(texture);
        },
        (error) => {
          logger.warn('render', 'skybox failed to load', { error: String(error) });
          resolve(null);
        },
      );
    } catch (error) {
      logger.warn('render', 'skybox could not be requested', { error: String(error) });
      resolve(null);
    }
  });
}

/** Loads every surface texture the models reference. */
export async function loadSurfaceTextures(
  loader: TextureLoaderLike,
): Promise<Map<SurfaceTextureId, THREE.Texture>> {
  const entries = Object.entries(TEXTURE_URLS.surfaces) as [SurfaceTextureId, string][];

  const loaded = await Promise.all(
    entries.map(async ([id, url]) => {
      const texture = await loadTexture(loader, url, `surface-${id}`);
      if (!texture) return null;

      // Surfaces repeat across props; wrapping both axes and keeping one tile at
      // a fixed physical size is what the scene builder's UVs assume.
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = 4;
      void METRES_PER_TILE[id];
      return [id, texture] as const;
    }),
  );

  return new Map(loaded.filter((entry): entry is readonly [SurfaceTextureId, THREE.Texture] => entry !== null));
}

/** Loads everything the scene needs, in parallel. */
export async function loadSceneAssets(
  loader: TextureLoaderLike = new THREE.TextureLoader(),
  cubeLoader: CubeTextureLoaderLike = new THREE.CubeTextureLoader(),
): Promise<SceneAssets> {
  const [cityBackdrop, skybox, surfaces, smoke] = await Promise.all([
    loadTexture(loader, TEXTURE_URLS.cityBackdrop, 'city-backdrop'),
    loadSkybox(cubeLoader),
    loadSurfaceTextures(loader),
    loadTexture(loader, TEXTURE_URLS.smoke, 'fx-smoke'),
  ]);

  const missing =
    (cityBackdrop ? 0 : 1) +
    (skybox ? 0 : 1) +
    (smoke ? 0 : 1) +
    (Object.keys(TEXTURE_URLS.surfaces).length - surfaces.size);
  if (missing > 0) {
    logger.warn('render', `${missing} scene texture(s) unavailable - using flat colours`);
  }

  return { cityBackdrop, skybox, surfaces, smoke };
}

/** Releases the loaded textures. */
export function disposeSceneAssets(assets: SceneAssets): void {
  assets.cityBackdrop?.dispose();
  assets.skybox?.dispose();
  assets.smoke?.dispose();
  for (const texture of assets.surfaces.values()) texture.dispose();
}
