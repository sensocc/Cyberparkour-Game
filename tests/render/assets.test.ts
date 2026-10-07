/**
 * Texture loading.
 *
 * `TextureLoader` reports through callbacks, and a missing texture must degrade
 * to a flat colour rather than stopping the demo - so every failure path here
 * matters as much as the happy one.
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
  TEXTURE_URLS,
  disposeSceneAssets,
  loadSceneAssets,
  loadTexture,
  type TextureLoaderLike,
} from '../../src/render/assets.js';
import { NO_ASSETS } from '../../src/render/types.js';
import { logsFrom, logsFromAsync, messages } from '../helpers/logs.js';

/** A loader that answers immediately, the way a cached fetch would. */
function immediateLoader(outcomes: ReadonlyMap<string, THREE.Texture | Error>): TextureLoaderLike {
  return {
    load(url, onLoad, onError) {
      const outcome = outcomes.get(url);
      if (outcome instanceof Error) onError?.(outcome);
      else if (outcome) onLoad(outcome);
      else onError?.(new Error(`nothing registered for ${url}`));
      return undefined;
    },
  };
}

const okLoader = (): TextureLoaderLike =>
  immediateLoader(
    new Map<string, THREE.Texture | Error>([
      [TEXTURE_URLS.cityBackdrop, new THREE.Texture()],
      [TEXTURE_URLS.skyGradient, new THREE.Texture()],
    ]),
  );

describe('texture urls', () => {
  it('points at the two committed PNGs', () => {
    expect(TEXTURE_URLS.cityBackdrop).toMatch(/city-backdrop\.png$/);
    expect(TEXTURE_URLS.skyGradient).toMatch(/sky-gradient\.png$/);
  });
});

describe('loadTexture', () => {
  it('resolves the texture and tags it as sRGB', async () => {
    const texture = new THREE.Texture();
    const loader = immediateLoader(new Map([['a.png', texture]]));

    const loaded = await loadTexture(loader, 'a.png', 'a');

    expect(loaded).toBe(texture);
    // Without this the sky and skyline render noticeably too bright.
    expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(texture.name).toBe('a');
  });

  it('resolves null instead of rejecting when the load fails', async () => {
    const loader = immediateLoader(new Map([['missing.png', new Error('404')]]));

    const { result: loaded, logs } = await logsFromAsync(() =>
      loadTexture(loader, 'missing.png', 'missing'),
    );

    expect(loaded).toBeNull();
    expect(messages(logs)[0]).toContain('texture "missing" failed to load');
  });

  it('resolves null when the loader itself throws synchronously', async () => {
    const loader: TextureLoaderLike = {
      load() {
        throw new Error('no DOM');
      },
    };

    const { result: loaded, logs } = await logsFromAsync(() =>
      loadTexture(loader, 'a.png', 'a'),
    );

    expect(loaded).toBeNull();
    expect(messages(logs)[0]).toContain('could not be requested');
  });
});

describe('loadSceneAssets', () => {
  it('loads both textures in parallel', async () => {
    const assets = await loadSceneAssets(okLoader());

    expect(assets.cityBackdrop).toBeInstanceOf(THREE.Texture);
    expect(assets.skyGradient).toBeInstanceOf(THREE.Texture);
    expect(assets.cityBackdrop?.name).toBe('city-backdrop');
    expect(assets.skyGradient?.name).toBe('sky-gradient');
  });

  it('warns once when one texture is missing but keeps the other', async () => {
    const loader = immediateLoader(
      new Map<string, THREE.Texture | Error>([
        [TEXTURE_URLS.cityBackdrop, new Error('404')],
        [TEXTURE_URLS.skyGradient, new THREE.Texture()],
      ]),
    );

    const { result: assets, logs } = await logsFromAsync(() => loadSceneAssets(loader));

    expect(assets.cityBackdrop).toBeNull();
    expect(assets.skyGradient).toBeInstanceOf(THREE.Texture);
    expect(messages(logs).join('\n')).toContain('1 scene texture(s) unavailable');
  });

  it('degrades entirely rather than throwing when nothing loads', async () => {
    const loader = immediateLoader(
      new Map<string, THREE.Texture | Error>([
        [TEXTURE_URLS.cityBackdrop, new Error('offline')],
        [TEXTURE_URLS.skyGradient, new Error('offline')],
      ]),
    );

    const { result: assets, logs } = await logsFromAsync(() => loadSceneAssets(loader));

    expect(assets.cityBackdrop).toBeNull();
    expect(assets.skyGradient).toBeNull();
    expect(messages(logs).join('\n')).toContain('2 scene texture(s) unavailable');
  });

  it('does not warn when everything loads', async () => {
    const { logs } = await logsFromAsync(() => loadSceneAssets(okLoader()));
    expect(logs).toEqual([]);
  });
});

describe('disposeSceneAssets', () => {
  it('releases both textures', () => {
    const assets = {
      cityBackdrop: new THREE.Texture(),
      skyGradient: new THREE.Texture(),
    };
    let count = 0;
    assets.cityBackdrop.addEventListener('dispose', () => {
      count += 1;
    });
    assets.skyGradient.addEventListener('dispose', () => {
      count += 1;
    });

    disposeSceneAssets(assets);

    expect(count).toBe(2);
  });

  it('copes with missing textures', () => {
    expect(() => disposeSceneAssets(NO_ASSETS)).not.toThrow();
  });

  it('is safe to call twice', () => {
    const assets = { cityBackdrop: new THREE.Texture(), skyGradient: null };
    disposeSceneAssets(assets);
    expect(() => disposeSceneAssets(assets)).not.toThrow();
  });
});

describe('NO_ASSETS', () => {
  it('is an all-null default, so the scene can always be built', () => {
    expect(NO_ASSETS).toEqual({ cityBackdrop: null, skyGradient: null });
    // Reassuring for the "textures failed" path in main.ts.
    expect(logsFrom(() => NO_ASSETS).logs).toEqual([]);
  });
});
