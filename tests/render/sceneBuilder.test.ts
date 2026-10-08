/**
 * Scene construction.
 *
 * three.js scene objects are pure JavaScript - only `WebGLRenderer` needs a GPU -
 * so the whole scene graph is testable in Node. That covers the two things most
 * likely to break silently: the sky/backdrop wiring and resource disposal.
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { buildScene } from '../../src/render/sceneBuilder.js';
import { NO_ASSETS, type SceneAssets } from '../../src/render/types.js';
import { DEMO_DISTRICT } from '../../src/game/level/levelData.js';
import { surfaceTextureIds } from '../../src/game/level/surfaces.js';
import { modelById } from '../../src/game/level/models.js';
import { propBounds } from '../../src/game/level/level.js';
import type { PropDefinition } from '../../src/game/level/levelData.js';

function assetTextures(): SceneAssets {
  return {
    cityBackdrop: new THREE.Texture(),
    skybox: new THREE.CubeTexture(),
    surfaces: new Map(surfaceTextureIds().map((id) => [id, new THREE.Texture()])),
  };
}

/** All the meshes a prop was resolved into. */
function partsOf(built: ReturnType<typeof buildScene>, id: string): readonly THREE.Mesh[] {
  const meshes = built.meshes.get(id);
  expect(meshes, `expected meshes for ${id}`).toBeDefined();
  return meshes ?? [];
}

/** The first part's mesh, which is the prop's main mass in every model. */
function meshOf(built: ReturnType<typeof buildScene>, id: string): THREE.Mesh {
  const [first] = partsOf(built, id);
  expect(first, `expected a mesh for ${id}`).toBeDefined();
  return first as THREE.Mesh;
}

describe('buildScene geometry', () => {
  it('creates one mesh per model part, per prop', () => {
    const built = buildScene(DEMO_DISTRICT);
    try {
      expect(built.meshes.size).toBe(DEMO_DISTRICT.props.length);

      // V0.2's whole point: props are models, so most of them are several meshes.
      const multiPart = DEMO_DISTRICT.props.filter((prop) => partsOf(built, prop.id).length > 1);
      expect(multiPart.length).toBeGreaterThan(DEMO_DISTRICT.props.length / 2);

      for (const prop of DEMO_DISTRICT.props) {
        for (const mesh of partsOf(built, prop.id)) {
          expect(mesh.name.startsWith(`${prop.id}#`), mesh.name).toBe(true);
          expect(built.scene.getObjectByName(mesh.name)).toBe(mesh);
        }
      }
    } finally {
      built.dispose();
    }
  });

  it('bakes each part into its own geometry, sized and positioned in world space', () => {
    const built = buildScene(DEMO_DISTRICT);
    try {
      // Parts are normalised against the prop's box, so a part's world size is
      // its normalised extent times the prop's size.
      const prop = DEMO_DISTRICT.props.find((entry) => entry.id === 'duct');
      expect(prop).toBeDefined();
      const model = modelById(prop?.model ?? '');
      const first = model?.parts[0];
      expect(first).toBeDefined();

      const size = prop?.size ?? { x: 0, y: 0, z: 0 };
      const trunk = meshOf(built, 'duct');
      const parameters = (trunk.geometry as THREE.BoxGeometry).parameters;

      expect(parameters.width).toBeCloseTo(((first?.max.x ?? 0) - (first?.min.x ?? 0)) * size.x, 6);
      expect(parameters.height).toBeCloseTo(((first?.max.y ?? 0) - (first?.min.y ?? 0)) * size.y, 6);
      expect(parameters.depth).toBeCloseTo(((first?.max.z ?? 0) - (first?.min.z ?? 0)) * size.z, 6);

      // ...and the mesh is centred where that part lands in the world.
      const origin = propBounds(prop as PropDefinition).min;
      expect(trunk.position.x).toBeCloseTo(origin.x + (((first?.min.x ?? 0) + (first?.max.x ?? 0)) / 2) * size.x, 6);
      expect(trunk.position.y).toBeCloseTo(origin.y + (((first?.min.y ?? 0) + (first?.max.y ?? 0)) / 2) * size.y, 6);
    } finally {
      built.dispose();
    }
  });

  it('gives each part its own geometry rather than sharing one unit cube', () => {
    const built = buildScene(DEMO_DISTRICT);
    try {
      const geometries = new Set(
        [...built.meshes.values()].flatMap((list) => list.map((mesh) => mesh.geometry)),
      );
      const meshCount = [...built.meshes.values()].reduce((total, list) => total + list.length, 0);
      expect(geometries.size).toBe(meshCount);
    } finally {
      built.dispose();
    }
  });

  it('scales texture repeats in world space, so density does not depend on size', () => {
    const built = buildScene(DEMO_DISTRICT, assetTextures());
    try {
      // The deck is far bigger than the pipe run, but both should show the same
      // texels per metre, which means very different UV ranges.
      const span = (mesh: THREE.Mesh): number => {
        const uv = mesh.geometry.getAttribute('uv');
        let min = Infinity;
        let max = -Infinity;
        for (let index = 0; index < uv.count; index += 1) {
          min = Math.min(min, uv.getX(index));
          max = Math.max(max, uv.getX(index));
        }
        return max - min;
      };

      const deck = span(meshOf(built, 'deck'));
      const pipe = span(meshOf(built, 'pipe-run-far'));
      expect(deck).toBeGreaterThan(pipe * 1.5);
      expect(pipe).toBeGreaterThan(0);
    } finally {
      built.dispose();
    }
  });

  it('caches materials by surface and tint', () => {
    const built = buildScene(DEMO_DISTRICT);
    try {
      // The three AC units in the home roof's plant row are identical, so they
      // share all their materials; the recoloured one elsewhere does not.
      const first = partsOf(built, 'ac-unit-home-a').map((mesh) => mesh.material);
      const second = partsOf(built, 'ac-unit-home-b').map((mesh) => mesh.material);
      const recoloured = partsOf(built, 'ac-unit-far-a').map((mesh) => mesh.material);

      expect(first).toEqual(second);
      expect(first[0]).not.toBe(recoloured[0]);

      // Far fewer materials than meshes.
      const materials = new Set(
        [...built.meshes.values()].flatMap((list) => list.map((mesh) => mesh.material)),
      );
      const meshCount = [...built.meshes.values()].reduce((total, list) => total + list.length, 0);
      expect(materials.size).toBeLessThan(meshCount / 4);
    } finally {
      built.dispose();
    }
  });

  it('applies the prop tints to the material colours', () => {
    const built = buildScene(DEMO_DISTRICT);
    try {
      const tower = meshOf(built, 'tower-a');
      const material = tower.material as THREE.MeshLambertMaterial;
      const tint = DEMO_DISTRICT.props.find((entry) => entry.id === 'tower-a')?.tints?.concrete;
      expect(tint).toBeDefined();
      expect(material.color.getHexString()).toBe((tint ?? '').replace('#', ''));
    } finally {
      built.dispose();
    }
  });

  it('honours the per-prop shadow flags', () => {
    const built = buildScene(DEMO_DISTRICT);
    try {
      expect(meshOf(built, 'deck').receiveShadow).toBe(true);
      // The background towers opt out of receiving shadows.
      expect(meshOf(built, 'tower-a').receiveShadow).toBe(false);
    } finally {
      built.dispose();
    }
  });

  it('sets up the fog and the background from the environment', () => {
    const built = buildScene(DEMO_DISTRICT);
    try {
      const fog = built.scene.fog as THREE.Fog;
      expect(fog).toBeInstanceOf(THREE.Fog);
      expect(fog.near).toBe(DEMO_DISTRICT.environment.fogNear);
      expect(fog.far).toBe(DEMO_DISTRICT.environment.fogFar);

      const background = built.scene.background as THREE.Color;
      expect(background.getHexString()).toBe(DEMO_DISTRICT.environment.skyColor.replace('#', ''));
    } finally {
      built.dispose();
    }
  });
});

describe('buildScene lighting', () => {
  it('creates an ambient light and a shadow-casting sun', () => {
    const built = buildScene(DEMO_DISTRICT);
    try {
      const ambient = built.scene.getObjectByName('ambient');
      expect(ambient).toBeInstanceOf(THREE.HemisphereLight);

      expect(built.sun).toBeInstanceOf(THREE.DirectionalLight);
      expect(built.sun.castShadow).toBe(true);
      expect(built.sun.shadow.mapSize.width).toBe(2048);
      expect(built.sun.target.parent).toBe(built.scene);
    } finally {
      built.dispose();
    }
  });

  it('places the sun along the configured direction', () => {
    const built = buildScene(DEMO_DISTRICT);
    try {
      const direction = new THREE.Vector3(
        DEMO_DISTRICT.environment.sunDirection.x,
        DEMO_DISTRICT.environment.sunDirection.y,
        DEMO_DISTRICT.environment.sunDirection.z,
      ).normalize();

      const actual = built.sun.position.clone().normalize();
      expect(actual.x).toBeCloseTo(direction.x, 9);
      expect(actual.y).toBeCloseTo(direction.y, 9);
      expect(actual.z).toBeCloseTo(direction.z, 9);
    } finally {
      built.dispose();
    }
  });

  it('sizes the shadow camera to cover the roof', () => {
    const built = buildScene(DEMO_DISTRICT);
    try {
      const camera = built.sun.shadow.camera;
      const deck = DEMO_DISTRICT.props.find((prop) => prop.id === 'deck');
      const halfWidth = (deck?.size.x ?? 0) / 2;
      const halfDepth = (deck?.size.z ?? 0) / 2;

      expect(camera.right).toBeGreaterThanOrEqual(halfWidth);
      expect(camera.left).toBeLessThanOrEqual(-halfWidth);
      expect(camera.top).toBeGreaterThanOrEqual(halfDepth);
      expect(camera.bottom).toBeLessThanOrEqual(-halfDepth);
      expect(camera.far).toBeGreaterThan(0);
    } finally {
      built.dispose();
    }
  });
});

describe('buildScene sky dome', () => {
  it('uses the cube skybox as the scene background', () => {
    const assets = assetTextures();
    const built = buildScene(DEMO_DISTRICT, assets);
    try {
      // A cube skybox needs no geometry at all, which is the upgrade from V0.1's
      // gradient dome.
      expect(built.scene.background).toBe(assets.skybox);
      expect(built.scene.getObjectByName('sky')).toBeUndefined();
    } finally {
      built.dispose();
    }
  });

  it('falls back to a flat colour when the skybox is missing', () => {
    const built = buildScene(DEMO_DISTRICT, { cityBackdrop: null, skybox: null, surfaces: new Map() });
    try {
      const background = built.scene.background as THREE.Color;
      expect(background).toBeInstanceOf(THREE.Color);
      expect(background.getHexString()).toBe(DEMO_DISTRICT.environment.skyColor.replace('#', ''));
    } finally {
      built.dispose();
    }
  });
});

describe('buildScene city backdrop', () => {
  it('wraps the texture around an open cylinder', () => {
    const assets = assetTextures();
    const built = buildScene(DEMO_DISTRICT, assets);
    try {
      expect(built.backdrop).not.toBeNull();
      const geometry = built.backdrop?.geometry as THREE.CylinderGeometry;
      const material = built.backdrop?.material as THREE.MeshBasicMaterial;

      expect(geometry.parameters.openEnded).toBe(true);
      expect(geometry.parameters.radiusTop).toBeCloseTo(DEMO_DISTRICT.environment.backdrop.radius, 9);
      expect(material.map).toBe(assets.cityBackdrop);
      // Seen from the inside.
      expect(material.side).toBe(THREE.BackSide);
      // The PNG's own alpha is what lets the sky show through the skyline.
      expect(material.transparent).toBe(true);
      expect(material.depthWrite).toBe(false);
      expect(built.backdrop?.frustumCulled).toBe(false);
    } finally {
      built.dispose();
    }
  });

  it('sits the skyline on its configured ground line', () => {
    const built = buildScene(DEMO_DISTRICT, assetTextures());
    try {
      const { height, baseY } = DEMO_DISTRICT.environment.backdrop;
      expect(built.backdrop?.position.y).toBeCloseTo(baseY + height / 2, 9);
    } finally {
      built.dispose();
    }
  });

  it('configures the texture to repeat horizontally and clamp vertically', () => {
    const assets = assetTextures();
    const built = buildScene(DEMO_DISTRICT, assets);
    try {
      expect(assets.cityBackdrop?.wrapS).toBe(THREE.RepeatWrapping);
      expect(assets.cityBackdrop?.wrapT).toBe(THREE.ClampToEdgeWrapping);
      expect(assets.cityBackdrop?.repeat.x).toBe(DEMO_DISTRICT.environment.backdrop.repeat);
      expect(assets.cityBackdrop?.repeat.y).toBe(1);
    } finally {
      built.dispose();
    }
  });

  it('is skipped entirely when the texture is missing', () => {
    const built = buildScene(DEMO_DISTRICT, NO_ASSETS);
    try {
      expect(built.backdrop).toBeNull();
      expect(built.scene.getObjectByName('city-backdrop')).toBeUndefined();
    } finally {
      built.dispose();
    }
  });

  it('is skipped for a degenerate radius or height', () => {
    const flat = {
      ...DEMO_DISTRICT,
      environment: {
        ...DEMO_DISTRICT.environment,
        backdrop: { ...DEMO_DISTRICT.environment.backdrop, height: 0 },
      },
    };
    const built = buildScene(flat, assetTextures());
    try {
      expect(built.backdrop).toBeNull();
    } finally {
      built.dispose();
    }
  });
});

describe('buildScene ground grid', () => {
  it('places a grid at the city ground level', () => {
    const built = buildScene(DEMO_DISTRICT);
    try {
      const grid = built.scene.getObjectByName('ground-grid');
      expect(grid).toBeInstanceOf(THREE.GridHelper);
      expect(grid?.position.y).toBeCloseTo(DEMO_DISTRICT.environment.backdrop.baseY + 0.01, 9);
    } finally {
      built.dispose();
    }
  });
});

describe('buildScene disposal', () => {
  it('empties the scene', () => {
    const built = buildScene(DEMO_DISTRICT, assetTextures());
    expect(built.scene.children.length).toBeGreaterThan(10);

    built.dispose();
    expect(built.scene.children).toHaveLength(0);
  });

  it('is safe to call twice', () => {
    const built = buildScene(DEMO_DISTRICT, assetTextures());
    built.dispose();
    expect(() => built.dispose()).not.toThrow();
  });

  it('does not dispose the textures it borrowed', () => {
    // The view is rebuilt on every restart, so a texture disposed here would
    // leave the next session with a bare sky and untextured props. three.js
    // signals disposal with an event, which is what the renderer listens for.
    const assets = assetTextures();
    const disposed: string[] = [];
    assets.cityBackdrop?.addEventListener('dispose', () => disposed.push('city'));
    assets.skybox?.addEventListener('dispose', () => disposed.push('skybox'));
    for (const [id, texture] of assets.surfaces) {
      texture.addEventListener('dispose', () => disposed.push(id));
    }

    const built = buildScene(DEMO_DISTRICT, assets);
    built.dispose();

    expect(disposed).toEqual([]);
  });

  it('disposes the geometry and materials it created', () => {
    const built = buildScene(DEMO_DISTRICT, assetTextures());
    const mesh = meshOf(built, 'deck');
    const geometryDispose = mesh.geometry.dispose.bind(mesh.geometry);
    const materialDispose = (mesh.material as THREE.Material).dispose.bind(mesh.material);

    let geometryDisposed = false;
    let materialDisposed = false;
    mesh.geometry.dispose = () => {
      geometryDisposed = true;
      geometryDispose();
    };
    (mesh.material as THREE.Material).dispose = () => {
      materialDisposed = true;
      materialDispose();
    };

    built.dispose();

    expect(geometryDisposed).toBe(true);
    expect(materialDisposed).toBe(true);
  });
});
