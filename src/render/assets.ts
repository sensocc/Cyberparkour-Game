/**
 * Loading the demo's flat textures.
 *
 * Loading is asynchronous but non-fatal: a texture that cannot be fetched
 * resolves to `null`, and `buildScene` falls back to a flat colour. A missing
 * backdrop must never stop the demo from starting.
 *
 * The loader is injected so this can be unit-tested without a browser.
 */

import * as THREE from 'three';

import { logger } from '../core/log.js';
import cityBackdropUrl from '../assets/textures/city-backdrop.png';
import skyGradientUrl from '../assets/textures/sky-gradient.png';
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

/** Where the two textures live in the bundle. */
export const TEXTURE_URLS = {
  cityBackdrop: cityBackdropUrl,
  skyGradient: skyGradientUrl,
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
          // Both source files are authored in sRGB; without this the sky and
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

/** Loads every scene texture in parallel. */
export async function loadSceneAssets(
  loader: TextureLoaderLike = new THREE.TextureLoader(),
): Promise<SceneAssets> {
  const [cityBackdrop, skyGradient] = await Promise.all([
    loadTexture(loader, TEXTURE_URLS.cityBackdrop, 'city-backdrop'),
    loadTexture(loader, TEXTURE_URLS.skyGradient, 'sky-gradient'),
  ]);

  const missing = [cityBackdrop, skyGradient].filter((texture) => texture === null).length;
  if (missing > 0) {
    logger.warn('render', `${missing} scene texture(s) unavailable - using flat colours`);
  }

  return { cityBackdrop, skyGradient };
}

/** Releases the loaded textures. */
export function disposeSceneAssets(assets: SceneAssets): void {
  assets.cityBackdrop?.dispose();
  assets.skyGradient?.dispose();
}
