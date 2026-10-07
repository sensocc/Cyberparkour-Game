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
import { DEMO_ROOF } from '../../src/game/level/levelData.js';

function assetTextures(): SceneAssets {
  return {
    cityBackdrop: new THREE.Texture(),
    skyGradient: new THREE.Texture(),
  };
}

describe('buildScene geometry', () => {
  it('creates one mesh per prop, named after it', () => {
    const built = buildScene(DEMO_ROOF);
    try {
      expect(built.meshes.size).toBe(DEMO_ROOF.props.length);
      for (const prop of DEMO_ROOF.props) {
        const mesh = built.meshes.get(prop.id);
        expect(mesh, prop.id).toBeDefined();
        expect(mesh?.name).toBe(prop.id);
        expect(built.scene.getObjectByName(prop.id)).toBe(mesh);
      }
    } finally {
      built.dispose();
    }
  });

  it('positions and scales each mesh from the level data', () => {
    const built = buildScene(DEMO_ROOF);
    try {
      const duct = built.meshes.get('duct');
      expect(duct?.position.x).toBeCloseTo(18, 9);
      expect(duct?.position.y).toBeCloseTo(2, 9);
      expect(duct?.scale.x).toBeCloseTo(1.2, 9);
      expect(duct?.scale.y).toBeCloseTo(1.2, 9);
      expect(duct?.scale.z).toBeCloseTo(8, 9);
    } finally {
      built.dispose();
    }
  });

  it('shares one geometry and caches materials by colour', () => {
    const built = buildScene(DEMO_ROOF);
    try {
      const geometries = new Set([...built.meshes.values()].map((mesh) => mesh.geometry));
      expect(geometries.size).toBe(1);

      // The three AC units in the plant row share a colour, so they share a
      // material; the differently-coloured ones do not.
      const acA = built.meshes.get('ac-unit-a')?.material;
      const acB = built.meshes.get('ac-unit-b')?.material;
      const acC = built.meshes.get('ac-unit-c')?.material;
      expect(acA).toBe(acC);
      expect(acA).not.toBe(acB);
    } finally {
      built.dispose();
    }
  });

  it('honours the per-prop shadow flags', () => {
    const built = buildScene(DEMO_ROOF);
    try {
      expect(built.meshes.get('deck')?.receiveShadow).toBe(true);
      // The background towers opt out of receiving shadows.
      expect(built.meshes.get('tower-a')?.receiveShadow).toBe(false);
    } finally {
      built.dispose();
    }
  });

  it('sets up the fog and the background from the environment', () => {
    const built = buildScene(DEMO_ROOF);
    try {
      const fog = built.scene.fog as THREE.Fog;
      expect(fog).toBeInstanceOf(THREE.Fog);
      expect(fog.near).toBe(DEMO_ROOF.environment.fogNear);
      expect(fog.far).toBe(DEMO_ROOF.environment.fogFar);

      const background = built.scene.background as THREE.Color;
      expect(background.getHexString()).toBe(DEMO_ROOF.environment.skyColor.replace('#', ''));
    } finally {
      built.dispose();
    }
  });
});

describe('buildScene lighting', () => {
  it('creates an ambient light and a shadow-casting sun', () => {
    const built = buildScene(DEMO_ROOF);
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
    const built = buildScene(DEMO_ROOF);
    try {
      const direction = new THREE.Vector3(
        DEMO_ROOF.environment.sunDirection.x,
        DEMO_ROOF.environment.sunDirection.y,
        DEMO_ROOF.environment.sunDirection.z,
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
    const built = buildScene(DEMO_ROOF);
    try {
      const camera = built.sun.shadow.camera;
      const deck = DEMO_ROOF.props.find((prop) => prop.id === 'deck');
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
  it('builds an opaque gradient dome when a sky texture is available', () => {
    const assets = assetTextures();
    const built = buildScene(DEMO_ROOF, assets);
    try {
      expect(built.sky).not.toBeNull();
      const material = built.sky?.material as THREE.MeshBasicMaterial;

      expect(material.map).toBe(assets.skyGradient);
      expect(material.side).toBe(THREE.BackSide);
      // The dome must ignore fog: it sits beyond the fog's far plane.
      expect(material.fog).toBe(false);
      expect(material.depthWrite).toBe(false);
      // Drawn first, so everything else lands on top of it.
      expect(built.sky?.renderOrder).toBe(-1);
      expect(built.sky?.frustumCulled).toBe(false);
    } finally {
      built.dispose();
    }
  });

  it('falls back to a flat colour when the gradient is missing', () => {
    const built = buildScene(DEMO_ROOF, { cityBackdrop: null, skyGradient: null });
    try {
      const material = built.sky?.material as THREE.MeshBasicMaterial;
      expect(material.map).toBeNull();
      expect(material.color.getHexString()).toBe(DEMO_ROOF.environment.skyColor.replace('#', ''));
    } finally {
      built.dispose();
    }
  });

  it('sizes the dome to the environment radius', () => {
    const built = buildScene(DEMO_ROOF);
    try {
      const geometry = built.sky?.geometry as THREE.SphereGeometry;
      expect(geometry.parameters.radius).toBeCloseTo(DEMO_ROOF.environment.skyRadius, 9);
    } finally {
      built.dispose();
    }
  });

  it('does not build a dome for a degenerate radius', () => {
    const definitions = {
      ...DEMO_ROOF,
      environment: { ...DEMO_ROOF.environment, skyRadius: 0 },
    };
    const built = buildScene(definitions);
    try {
      expect(built.sky).toBeNull();
    } finally {
      built.dispose();
    }
  });
});

describe('buildScene city backdrop', () => {
  it('wraps the texture around an open cylinder', () => {
    const assets = assetTextures();
    const built = buildScene(DEMO_ROOF, assets);
    try {
      expect(built.backdrop).not.toBeNull();
      const geometry = built.backdrop?.geometry as THREE.CylinderGeometry;
      const material = built.backdrop?.material as THREE.MeshBasicMaterial;

      expect(geometry.parameters.openEnded).toBe(true);
      expect(geometry.parameters.radiusTop).toBeCloseTo(DEMO_ROOF.environment.backdrop.radius, 9);
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
    const built = buildScene(DEMO_ROOF, assetTextures());
    try {
      const { height, baseY } = DEMO_ROOF.environment.backdrop;
      expect(built.backdrop?.position.y).toBeCloseTo(baseY + height / 2, 9);
    } finally {
      built.dispose();
    }
  });

  it('configures the texture to repeat horizontally and clamp vertically', () => {
    const assets = assetTextures();
    const built = buildScene(DEMO_ROOF, assets);
    try {
      expect(assets.cityBackdrop?.wrapS).toBe(THREE.RepeatWrapping);
      expect(assets.cityBackdrop?.wrapT).toBe(THREE.ClampToEdgeWrapping);
      expect(assets.cityBackdrop?.repeat.x).toBe(DEMO_ROOF.environment.backdrop.repeat);
      expect(assets.cityBackdrop?.repeat.y).toBe(1);
    } finally {
      built.dispose();
    }
  });

  it('is skipped entirely when the texture is missing', () => {
    const built = buildScene(DEMO_ROOF, NO_ASSETS);
    try {
      expect(built.backdrop).toBeNull();
      expect(built.scene.getObjectByName('city-backdrop')).toBeUndefined();
    } finally {
      built.dispose();
    }
  });

  it('is skipped for a degenerate radius or height', () => {
    const flat = {
      ...DEMO_ROOF,
      environment: {
        ...DEMO_ROOF.environment,
        backdrop: { ...DEMO_ROOF.environment.backdrop, height: 0 },
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
    const built = buildScene(DEMO_ROOF);
    try {
      const grid = built.scene.getObjectByName('ground-grid');
      expect(grid).toBeInstanceOf(THREE.GridHelper);
      expect(grid?.position.y).toBeCloseTo(DEMO_ROOF.environment.backdrop.baseY + 0.01, 9);
    } finally {
      built.dispose();
    }
  });
});

describe('buildScene disposal', () => {
  it('empties the scene', () => {
    const built = buildScene(DEMO_ROOF, assetTextures());
    expect(built.scene.children.length).toBeGreaterThan(10);

    built.dispose();
    expect(built.scene.children).toHaveLength(0);
  });

  it('is safe to call twice', () => {
    const built = buildScene(DEMO_ROOF, assetTextures());
    built.dispose();
    expect(() => built.dispose()).not.toThrow();
  });

  it('does not dispose the textures it borrowed', () => {
    // The view is rebuilt on every restart, so a texture disposed here would
    // leave the next session with a black sky and no skyline. three.js signals
    // disposal with an event, which is what the renderer listens for.
    const assets = assetTextures();
    let backdropDisposed = false;
    let skyDisposed = false;
    assets.cityBackdrop?.addEventListener('dispose', () => {
      backdropDisposed = true;
    });
    assets.skyGradient?.addEventListener('dispose', () => {
      skyDisposed = true;
    });

    const built = buildScene(DEMO_ROOF, assets);
    built.dispose();

    expect(backdropDisposed).toBe(false);
    expect(skyDisposed).toBe(false);
  });

  it('disposes the shared geometry and materials it created', () => {
    const built = buildScene(DEMO_ROOF, assetTextures());
    const mesh = built.meshes.get('deck') as THREE.Mesh;
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
