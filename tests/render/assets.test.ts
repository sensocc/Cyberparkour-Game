/**
 * Texture loading.
 *
 * three.js reports through callbacks, and a missing texture must degrade to a
 * flat colour rather than stopping the demo - so every failure path here matters
 * as much as the happy one.
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
  TEXTURE_URLS,
  applyAnisotropy,
  disposeSceneAssets,
  loadSceneAssets,
  loadSkybox,
  loadSurfaceTextures,
  loadTexture,
  type CubeTextureLoaderLike,
  type TextureLoaderLike,
} from '../../src/render/assets.js';
import { NO_ASSETS } from '../../src/render/types.js';
import { SURFACES, surfaceTextureIds } from '../../src/game/level/surfaces.js';
import { logsFrom, logsFromAsync, messages } from '../helpers/logs.js';

type Outcome = THREE.Texture | Error;

/** A loader that answers immediately, the way a cached fetch would. */
function immediateLoader(outcomes: ReadonlyMap<string, Outcome>): TextureLoaderLike {
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

const surfaceEntries = (): [string, THREE.Texture][] =>
  Object.values(TEXTURE_URLS.surfaces).map((url) => [url, new THREE.Texture()]);

const okLoader = (): TextureLoaderLike =>
  immediateLoader(
    new Map<string, Outcome>([
      [TEXTURE_URLS.cityBackdrop, new THREE.Texture()],
      [TEXTURE_URLS.smoke, new THREE.Texture()],
      ...surfaceEntries(),
    ]),
  );

const okCubeLoader = (): CubeTextureLoaderLike => ({
  load(_urls, onLoad) {
    onLoad(new THREE.CubeTexture());
    return undefined;
  },
});

describe('texture urls', () => {
  it('points at the skyline, six skybox faces and every surface', () => {
    expect(TEXTURE_URLS.cityBackdrop).toMatch(/city-backdrop\.png$/);
    expect(TEXTURE_URLS.skybox).toHaveLength(6);
    for (const url of TEXTURE_URLS.skybox) expect(url).toMatch(/sky-[a-z]{2}\.png$/);
    for (const url of Object.values(TEXTURE_URLS.surfaces)) {
      expect(url).toMatch(/surface-[a-z-]+\.png$/);
    }
  });

  it('covers every texture id the surface table uses', () => {
    expect(Object.keys(TEXTURE_URLS.surfaces).sort()).toEqual(surfaceTextureIds());
    for (const surface of SURFACES) {
      expect(TEXTURE_URLS.surfaces[surface.texture]).toBeDefined();
    }
  });
});

describe('loadTexture', () => {
  it('resolves the texture and tags it as sRGB', async () => {
    const texture = new THREE.Texture();
    const loaded = await loadTexture(immediateLoader(new Map([['a.png', texture]])), 'a.png', 'a');

    expect(loaded).toBe(texture);
    expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(texture.name).toBe('a');
  });

  it('resolves null instead of rejecting when the load fails', async () => {
    const { result, logs } = await logsFromAsync(() =>
      loadTexture(immediateLoader(new Map([['missing.png', new Error('404')]])), 'missing.png', 'missing'),
    );

    expect(result).toBeNull();
    expect(messages(logs)[0]).toContain('texture "missing" failed to load');
  });

  it('resolves null when the loader itself throws synchronously', async () => {
    const loader: TextureLoaderLike = {
      load() {
        throw new Error('no DOM');
      },
    };

    const { result, logs } = await logsFromAsync(() => loadTexture(loader, 'a.png', 'a'));
    expect(result).toBeNull();
    expect(messages(logs)[0]).toContain('could not be requested');
  });
});

describe('loadSkybox', () => {
  it('resolves a cube texture', async () => {
    const skybox = await loadSkybox(okCubeLoader());
    expect(skybox).toBeInstanceOf(THREE.CubeTexture);
    expect(skybox?.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(skybox?.name).toBe('skybox');
  });

  it('resolves null when the faces fail to load', async () => {
    const failing: CubeTextureLoaderLike = {
      load(_urls, _onLoad, onError) {
        onError?.(new Error('404'));
        return undefined;
      },
    };

    const { result, logs } = await logsFromAsync(() => loadSkybox(failing));
    expect(result).toBeNull();
    expect(messages(logs)[0]).toContain('skybox failed to load');
  });

  it('resolves null when the loader throws synchronously', async () => {
    const hostile: CubeTextureLoaderLike = {
      load() {
        throw new Error('no canvas');
      },
    };
    const { result } = await logsFromAsync(() => loadSkybox(hostile));
    expect(result).toBeNull();
  });
});

describe('loadSurfaceTextures', () => {
  it('loads every surface and makes it repeat', async () => {
    const surfaces = await loadSurfaceTextures(okLoader());

    expect(surfaces.size).toBe(surfaceTextureIds().length);
    for (const [id, texture] of surfaces) {
      expect(texture.wrapS, id).toBe(THREE.RepeatWrapping);
      expect(texture.wrapT, id).toBe(THREE.RepeatWrapping);
      expect(texture.name, id).toBe(`surface-${id}`);
    }
  });

  it('drops only the surfaces that failed', async () => {
    const [firstUrl] = Object.values(TEXTURE_URLS.surfaces);
    const entries = surfaceEntries().map(
      ([url, texture]) => [url, url === firstUrl ? new Error('404') : texture] as const,
    );

    const surfaces = await loadSurfaceTextures(immediateLoader(new Map(entries)));

    expect(surfaces.size).toBe(surfaceTextureIds().length - 1);
  });
});

describe('loadSceneAssets', () => {
  it('loads everything together', async () => {
    const assets = await loadSceneAssets(okLoader(), okCubeLoader());

    expect(assets.cityBackdrop).toBeInstanceOf(THREE.Texture);
    expect(assets.skybox).toBeInstanceOf(THREE.CubeTexture);
    expect(assets.surfaces.size).toBe(surfaceTextureIds().length);
  });

  it('warns once when anything is missing, and keeps the rest', async () => {
    const failingCity = immediateLoader(
      new Map<string, Outcome>([
        [TEXTURE_URLS.cityBackdrop, new Error('404')],
        ...surfaceEntries(),
      ]),
    );

    const { result, logs } = await logsFromAsync(() => loadSceneAssets(failingCity, okCubeLoader()));

    expect(result.cityBackdrop).toBeNull();
    expect(result.skybox).toBeInstanceOf(THREE.CubeTexture);
    expect(messages(logs).join('\n')).toContain('scene texture(s) unavailable');
  });

  it('degrades entirely rather than throwing when nothing loads', async () => {
    const nothing = immediateLoader(new Map());
    const noCube: CubeTextureLoaderLike = {
      load(_urls, _onLoad, onError) {
        onError?.(new Error('offline'));
        return undefined;
      },
    };

    const { result, logs } = await logsFromAsync(() => loadSceneAssets(nothing, noCube));

    expect(result.cityBackdrop).toBeNull();
    expect(result.skybox).toBeNull();
    expect(result.surfaces.size).toBe(0);
    expect(messages(logs).join('\n')).toContain('scene texture(s) unavailable');
  });

  it('does not warn when everything loads', async () => {
    const { logs } = await logsFromAsync(() => loadSceneAssets(okLoader(), okCubeLoader()));
    expect(logs).toEqual([]);
  });
});

describe('disposeSceneAssets', () => {
  it('releases every texture it was given', () => {
    const assets = {
      cityBackdrop: new THREE.Texture(),
      skybox: new THREE.CubeTexture(),
      surfaces: new Map([['hazard' as const, new THREE.Texture()]]),
      smoke: new THREE.Texture(),
    };

    let disposed = 0;
    assets.cityBackdrop.addEventListener('dispose', () => {
      disposed += 1;
    });
    assets.skybox.addEventListener('dispose', () => {
      disposed += 1;
    });
    assets.smoke.addEventListener('dispose', () => {
      disposed += 1;
    });
    for (const texture of assets.surfaces.values()) {
      texture.addEventListener('dispose', () => {
        disposed += 1;
      });
    }

    disposeSceneAssets(assets);
    expect(disposed).toBe(4);
  });

  it('copes with nothing loaded', () => {
    expect(() => disposeSceneAssets(NO_ASSETS)).not.toThrow();
  });

  it('is safe to call twice', () => {
    const assets = { cityBackdrop: new THREE.Texture(), skybox: null, surfaces: new Map(), smoke: null };
    disposeSceneAssets(assets);
    expect(() => disposeSceneAssets(assets)).not.toThrow();
  });
});

describe('NO_ASSETS', () => {
  it('is an all-empty default, so the scene can always be built', () => {
    expect(NO_ASSETS.cityBackdrop).toBeNull();
    expect(NO_ASSETS.skybox).toBeNull();
    expect(NO_ASSETS.surfaces.size).toBe(0);
    expect(logsFrom(() => NO_ASSETS).logs).toEqual([]);
  });
});

describe('applyAnisotropy', () => {
  /** The textures a scene can hold, with only the ones that matter filled in. */
  function assets(): { cityBackdrop: THREE.Texture | null; skybox: THREE.Texture | null; surfaces: Map<string, THREE.Texture>; smoke: THREE.Texture | null } {
    return {
      cityBackdrop: new THREE.Texture(),
      skybox: new THREE.CubeTexture(),
      surfaces: new Map([
        ['deck-plate', new THREE.Texture()],
        ['concrete', new THREE.Texture()],
      ]),
      smoke: new THREE.Texture(),
    };
  }

  it('raises every texture to the sample count the GPU offers', () => {
    const scene = assets();
    applyAnisotropy(scene as never, 16);

    for (const texture of [
      scene.cityBackdrop,
      scene.skybox,
      scene.smoke,
      ...scene.surfaces.values(),
    ]) {
      expect(texture?.anisotropy).toBe(16);
    }
  });

  it('asks for mipmaps rather than leaving the filters to chance', () => {
    // Mipmaps are what stop minified detail aliasing, and blending between three
    // levels is what stops the seams between them showing as bands.
    const scene = assets();
    applyAnisotropy(scene as never, 8);

    expect(scene.cityBackdrop?.generateMipmaps).toBe(true);
    expect(scene.cityBackdrop?.minFilter).toBe(THREE.LinearMipmapLinearFilter);
    expect(scene.cityBackdrop?.magFilter).toBe(THREE.LinearFilter);
    // `needsUpdate` is a write-only setter; what it does is bump the version, which
    // is what makes three.js re-upload the texture and take the new parameters.
    expect(scene.cityBackdrop?.version).toBeGreaterThan(0);
  });

  it('never asks for less than one sample, whatever it is handed', () => {
    // A headless or software renderer can report zero, and an anisotropy of 0 is
    // not "no filtering" - it is an invalid parameter.
    for (const reported of [0, -4, 0.5]) {
      const scene = assets();
      applyAnisotropy(scene as never, reported);
      expect(scene.cityBackdrop?.anisotropy, String(reported)).toBe(1);
    }
  });

  it('copes with the textures that failed to load', () => {
    const scene = { ...assets(), cityBackdrop: null, skybox: null, smoke: null, surfaces: new Map() };
    expect(() => applyAnisotropy(scene as never, 16)).not.toThrow();
    expect(() => applyAnisotropy(NO_ASSETS, 16)).not.toThrow();
  });
});
