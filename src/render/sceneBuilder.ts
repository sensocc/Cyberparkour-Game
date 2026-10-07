/**
 * Builds the three.js scene from a `LevelDefinition`.
 *
 * One shared unit cube geometry is scaled per prop, and materials are cached by
 * colour, so a level of any size costs a handful of GPU objects. Everything
 * created here is torn down by `dispose()`, which is what lets the demo restart
 * cleanly without leaking a WebGL context's worth of buffers.
 */

import * as THREE from 'three';

import type { LevelDefinition } from '../game/level/levelData.js';

export interface BuiltScene {
  readonly scene: THREE.Scene;
  readonly sun: THREE.DirectionalLight;
  /** Names of the created meshes, by prop id. */
  readonly meshes: ReadonlyMap<string, THREE.Mesh>;
  dispose(): void;
}

/** Distance of the sun from the origin. Only affects the shadow camera setup. */
const SUN_DISTANCE = 120;

/** Half-extent of the shadow volume, in metres. Sized to the demo roof. */
const SHADOW_EXTENT = 38;

export function buildScene(definition: LevelDefinition): BuiltScene {
  const environment = definition.environment;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(environment.skyColor);
  scene.fog = new THREE.Fog(
    new THREE.Color(environment.fogColor),
    environment.fogNear,
    environment.fogFar,
  );

  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const materials = new Map<string, THREE.MeshLambertMaterial>();
  const meshes = new Map<string, THREE.Mesh>();

  const materialFor = (color: string): THREE.MeshLambertMaterial => {
    const cached = materials.get(color);
    if (cached) return cached;

    const material = new THREE.MeshLambertMaterial({
      color: new THREE.Color(color),
      // Flat shading keeps the low-poly silhouette crisp, Quake-style.
      flatShading: true,
    });
    materials.set(color, material);
    return material;
  };

  for (const prop of definition.props) {
    const mesh = new THREE.Mesh(geometry, materialFor(prop.color));
    mesh.position.set(prop.position.x, prop.position.y, prop.position.z);
    mesh.scale.set(prop.size.x, prop.size.y, prop.size.z);
    mesh.castShadow = prop.castShadow ?? true;
    mesh.receiveShadow = prop.receiveShadow ?? true;
    mesh.name = prop.id;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();

    scene.add(mesh);
    meshes.set(prop.id, mesh);
  }

  // ------------------------------------------------------------- lighting
  const ambient = new THREE.HemisphereLight(
    new THREE.Color(environment.ambientSkyColor),
    new THREE.Color(environment.ambientGroundColor),
    environment.ambientIntensity,
  );
  ambient.name = 'ambient';

  const sun = new THREE.DirectionalLight(
    new THREE.Color(environment.sunColor),
    environment.sunIntensity,
  );
  sun.name = 'sun';
  sun.position
    .set(environment.sunDirection.x, environment.sunDirection.y, environment.sunDirection.z)
    .normalize()
    .multiplyScalar(SUN_DISTANCE);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;

  const shadowCamera = sun.shadow.camera;
  shadowCamera.left = -SHADOW_EXTENT;
  shadowCamera.right = SHADOW_EXTENT;
  shadowCamera.top = SHADOW_EXTENT;
  shadowCamera.bottom = -SHADOW_EXTENT;
  shadowCamera.near = 1;
  shadowCamera.far = SUN_DISTANCE * 2;
  shadowCamera.updateProjectionMatrix();

  scene.add(ambient);
  scene.add(sun);
  scene.add(sun.target);

  // --------------------------------------------------------------- ground grid
  // A grid is the cheapest way to give the eye something to track while
  // moving; until V0.1 adds real textures the ground is otherwise a flat void.
  const grid = new THREE.GridHelper(300, 60, 0x2b3a55, 0x1b2231);
  grid.name = 'ground-grid';
  grid.position.set(0, -34.79, 0);
  scene.add(grid);

  return {
    scene,
    sun,
    meshes,
    dispose(): void {
      scene.clear();
      geometry.dispose();
      for (const material of materials.values()) material.dispose();
      grid.geometry.dispose();
      const gridMaterial = grid.material;
      if (Array.isArray(gridMaterial)) for (const entry of gridMaterial) entry.dispose();
      else gridMaterial.dispose();
    },
  };
}
