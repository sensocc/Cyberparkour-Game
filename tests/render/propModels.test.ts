/**
 * Prop model loading.
 *
 * Same contract as the texture loader: GLTF files are fetched through a
 * callback-shaped loader, every failure degrades to a missing model rather
 * than a stopped demo, and the parsed scenes own their GPU resources.
 */

import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

import {
  PROP_MODEL_URLS,
  disposePropModels,
  loadPropModel,
  loadPropModels,
  type GLTFLoaderLike,
} from '../../src/render/propModels.js';
import type { GltfPropModelId } from '../../src/game/level/levelData.js';
import { logsFromAsync, messages } from '../helpers/logs.js';

/** A loader that answers immediately, the way a cached fetch would. */
function immediateLoader(outcomes: ReadonlyMap<string, THREE.Group | Error>): GLTFLoaderLike {
  return {
    load(url, onLoad, _onProgress, onError) {
      const outcome = outcomes.get(url);
      if (outcome instanceof Error) onError?.(outcome);
      else if (outcome) onLoad({ scene: outcome, animations: [] });
      else onError?.(new Error(`nothing registered for ${url}`));
      return undefined;
    },
  };
}

const modelIds = (): GltfPropModelId[] => Object.keys(PROP_MODEL_URLS) as GltfPropModelId[];

describe('loadPropModel', () => {
  it('resolves a group when the loader succeeds', async () => {
    const group = new THREE.Group();
    const model = await loadPropModel(
      immediateLoader(new Map([['ac.gltf', group]])),
      'ac',
      'ac.gltf',
    );
    expect(model?.scene).toBe(group);
  });

  it('names the scene after the model', async () => {
    const model = await loadPropModel(
      immediateLoader(new Map([['door.gltf', new THREE.Group()]])),
      'door',
      'door.gltf',
    );
    expect(model?.scene.name).toBe('prop-door');
  });

  it('resolves to null when the loader reports an error, with a warning', async () => {
    const { result, logs } = await logsFromAsync(() =>
      loadPropModel(
        immediateLoader(new Map([['ac.gltf', new Error('gone')]])),
        'ac',
        'ac.gltf',
      ),
    );
    expect(result).toBeNull();
    expect(messages(logs).filter((message) => message.includes('ac'))).toHaveLength(1);
  });

  it('resolves to null when the loader itself throws', async () => {
    const throwing: GLTFLoaderLike = {
      load() {
        throw new Error('no loader today');
      },
    };
    await expect(loadPropModel(throwing, 'ac', 'ac.gltf')).resolves.toBeNull();
  });
});

describe('loadPropModels', () => {
  it('loads every registered model', async () => {
    const groups = new Map(modelIds().map((id) => [PROP_MODEL_URLS[id], new THREE.Group()]));
    const models = await loadPropModels(immediateLoader(groups));
    expect(models.size).toBe(modelIds().length);
    for (const id of modelIds()) {
      expect(models.get(id)?.scene, id).toBe(groups.get(PROP_MODEL_URLS[id]));
    }
  });

  it('keeps the ones that loaded when some fail', async () => {
    const ids = modelIds();
    const first = ids[0]!;
    const groups = new Map([[PROP_MODEL_URLS[first], new THREE.Group()]]);
    const models = await loadPropModels(immediateLoader(groups));
    expect(models.size).toBe(1);
    expect(models.has(first)).toBe(true);
  });
});

describe('disposePropModels', () => {
  it('disposes every geometry and material the models own', () => {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshBasicMaterial();
    const disposeGeometry = vi.spyOn(geometry, 'dispose');
    const disposeMaterial = vi.spyOn(material, 'dispose');
    const group = new THREE.Group();
    group.add(new THREE.Mesh(geometry, material));
    disposePropModels(new Map([['ac', { scene: group, animations: [] }]]));
    expect(disposeGeometry).toHaveBeenCalledOnce();
    expect(disposeMaterial).toHaveBeenCalledOnce();
  });
});
