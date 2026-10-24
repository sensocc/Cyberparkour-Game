/**
 * Loading the imported prop models.
 *
 * The Kenney and Quaternius kits are committed as files under `assets/models`;
 * this module owns the id-to-file map and the loading. Loading is per model and
 * non-fatal: a model that cannot be fetched simply is not in the map, and the
 * scene builder falls back to the prop's ordinary box parts - a missing model
 * must never stop the demo from starting, exactly like a missing texture.
 *
 * The loader is injected so this can be unit-tested without a browser.
 */

import * as THREE from 'three';

import { logger } from '../core/log.js';
import type { GltfPropModelId } from '../game/level/levelData.js';
import acUrl from '../assets/models/ac.gltf?url';
import acSideUrl from '../assets/models/ac-side.gltf?url';
import antenna1Url from '../assets/models/antenna-1.gltf?url';
import antenna2Url from '../assets/models/antenna-2.gltf?url';
import cableSmallUrl from '../assets/models/cable-small.gltf?url';
import computerUrl from '../assets/models/computer.gltf?url';
import doorUrl from '../assets/models/door.gltf?url';
import fenceUrl from '../assets/models/fence.gltf?url';
import lightSquareUrl from '../assets/models/light-square.gltf?url';
import waterTowerUrl from '../assets/models/water-tower.glb?url';
import solarFlatUrl from '../assets/models/solar-flat.glb?url';
import solarLandscapeUrl from '../assets/models/solar-landscape.glb?url';
import chimneySmallUrl from '../assets/models/chimney-small.glb?url';
import chimneyMediumUrl from '../assets/models/chimney-medium.glb?url';
import detailTankUrl from '../assets/models/detail-tank.glb?url';
import windmillLowUrl from '../assets/models/windmill-low.glb?url';
import containerAUrl from '../assets/models/container-a.glb?url';
import dumpsterUrl from '../assets/models/dumpster.glb?url';
import streetLightUrl from '../assets/models/street-light.glb?url';
import poleSingleUrl from '../assets/models/pole-single.glb?url';
import barrierUrl from '../assets/models/barrier.glb?url';
import npcAUrl from '../assets/models/npc-a.gltf?url';
import npcBUrl from '../assets/models/npc-b.gltf?url';

/** One parsed model: its scene, and the clips a character carries. */
export interface PropModel {
  readonly scene: THREE.Group;
  readonly animations: readonly THREE.AnimationClip[];
}

/** The part of three's `GLTFLoader` this module uses. */
export interface GLTFLoaderLike {
  load(
    url: string,
    onLoad: (gltf: { scene: THREE.Group; animations: THREE.AnimationClip[] }) => void,
    onProgress?: (event: unknown) => void,
    onError?: (error: unknown) => void,
  ): unknown;
}

/** Where each model lives in the bundle. */
export const PROP_MODEL_URLS: Readonly<Record<GltfPropModelId, string>> = {
  ac: acUrl,
  'ac-side': acSideUrl,
  'antenna-1': antenna1Url,
  'antenna-2': antenna2Url,
  'cable-small': cableSmallUrl,
  computer: computerUrl,
  door: doorUrl,
  fence: fenceUrl,
  'light-square': lightSquareUrl,
  'water-tower': waterTowerUrl,
  'solar-flat': solarFlatUrl,
  'solar-landscape': solarLandscapeUrl,
  'chimney-small': chimneySmallUrl,
  'chimney-medium': chimneyMediumUrl,
  'detail-tank': detailTankUrl,
  'windmill-low': windmillLowUrl,
  'container-a': containerAUrl,
  dumpster: dumpsterUrl,
  'street-light': streetLightUrl,
  'pole-single': poleSingleUrl,
  barrier: barrierUrl,
  'npc-a': npcAUrl,
  'npc-b': npcBUrl,
};

/** Loads one model, resolving to `null` instead of rejecting. */
export function loadPropModel(
  loader: GLTFLoaderLike,
  id: GltfPropModelId,
  url: string,
): Promise<PropModel | null> {
  return new Promise((resolve) => {
    try {
      loader.load(
        url,
        (gltf) => {
          gltf.scene.name = `prop-${id}`;
          resolve({ scene: gltf.scene, animations: gltf.animations ?? [] });
        },
        undefined,
        (error) => {
          logger.warn('render', `prop model "${id}" failed to load`, { url, error: String(error) });
          resolve(null);
        },
      );
    } catch (error) {
      logger.warn('render', `prop model "${id}" could not be requested`, { url, error: String(error) });
      resolve(null);
    }
  });
}

/** Loads every prop model the level may reference, skipping whatever fails. */
export async function loadPropModels(loader: GLTFLoaderLike): Promise<ReadonlyMap<GltfPropModelId, PropModel>> {
  const entries = Object.entries(PROP_MODEL_URLS) as [GltfPropModelId, string][];

  const loaded = await Promise.all(
    entries.map(async ([id, url]) => {
      const model = await loadPropModel(loader, id, url);
      return model ? ([id, model] as const) : null;
    }),
  );

  const missing = loaded.filter((entry) => entry === null).length;
  if (missing > 0) {
    logger.warn('render', `${missing} prop model(s) unavailable - falling back to box parts`);
  }

  return new Map(loaded.filter((entry): entry is readonly [GltfPropModelId, PropModel] => entry !== null));
}

/** Releases the parsed models: their geometries and materials, once. */
export function disposePropModels(models: ReadonlyMap<GltfPropModelId, PropModel>): void {
  for (const model of models.values()) {
    model.scene.traverse((node) => {
      if (!(node as THREE.Mesh).isMesh) return;
      const mesh = node as THREE.Mesh;
      mesh.geometry.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) for (const entry of material) entry.dispose();
      else material.dispose();
    });
  }
}
