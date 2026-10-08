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
      // A baseline that does not depend on the hardware. `applyAnisotropy` raises
      // this to whatever the GPU reports once there is a renderer to ask; this is
      // what anything that never reaches a renderer will use.
      texture.anisotropy = 4;
      return [id, texture] as const;
    }),
  );

  return new Map(loaded.filter((entry): entry is readonly [SurfaceTextureId, THREE.Texture] => entry !== null));
}

/** Every texture a scene can hand to the renderer. */
function sceneTextures(assets: SceneAssets): THREE.Texture[] {
  const textures: THREE.Texture[] = [...assets.surfaces.values()];
  if (assets.cityBackdrop) textures.push(assets.cityBackdrop);
  if (assets.skybox) textures.push(assets.skybox);
  if (assets.smoke) textures.push(assets.smoke);
  return textures;
}

/**
 * Raises every scene texture to the sharpest filtering the GPU offers.
 *
 * Grazing angles are where a tiled surface falls apart. A deck plate seen from the
 * far side of the district covers hundreds of texels along the view direction for
 * every one it covers across it, so no single mip level is right for both, and
 * trilinear sampling picks one that is wrong for the pair. What the eye sees is
 * sparkle and crawl over every surface whenever the camera moves - worst exactly
 * when the player is running, which is when it matters most.
 *
 * Anisotropic filtering samples along the line the pixel actually covers instead.
 * It is the cheapest fix there is: one texture parameter, no extra pass, and the
 * hardware does the work at a cost bounded by the sample count the GPU reports.
 *
 * Must run before the first render. three.js applies these parameters when it
 * uploads a texture and nothing re-uploads one afterwards, so this is called from
 * the view's constructor with the renderer's own limit.
 */
export function applyAnisotropy(assets: SceneAssets, maxAnisotropy: number): void {
  const samples = Math.max(1, Math.floor(maxAnisotropy));
  for (const texture of sceneTextures(assets)) {
    texture.anisotropy = samples;
    // Mipmaps are what stop minified detail aliasing at all, and blending
    // between three levels (rather than picking one) is what stops the seams
    // between them showing up as bands across a receding surface.
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
  }
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
