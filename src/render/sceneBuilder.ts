/**
 * Builds the three.js scene from a `LevelDefinition`.
 *
 * One shared unit cube geometry is scaled per prop, and materials are cached by
 * colour, so a level of any size costs a handful of GPU objects. On top of the
 * level geometry it adds the two flat-texture touches V0.1 calls for: a gradient
 * sky dome and a painted city skyline wrapped around the play area.
 *
 * **Asset ownership:** the scene *borrows* the textures. The view is torn down
 * and rebuilt on every restart, so the textures outlive it - disposing them here
 * would leave the next session with a black sky. Only the geometry and
 * materials created here are disposed.
 */

import * as THREE from 'three';

import type { LevelDefinition } from '../game/level/levelData.js';
import { NO_ASSETS, type SceneAssets } from './types.js';

export interface BuiltScene {
  readonly scene: THREE.Scene;
  readonly sun: THREE.DirectionalLight;
  /** Names of the created meshes, by prop id. */
  readonly meshes: ReadonlyMap<string, THREE.Mesh>;
  /** The gradient sky dome, when one was built. */
  readonly sky: THREE.Mesh | null;
  /** The painted city skyline, when one was built. */
  readonly backdrop: THREE.Mesh | null;
  dispose(): void;
}

/** Distance of the sun from the origin. Only affects the shadow camera setup. */
const SUN_DISTANCE = 120;

/** Half-extent of the shadow volume, in metres. Sized to the demo roof. */
const SHADOW_EXTENT = 44;

/** Radial segments in the skyline cylinder; enough to read as round. */
const BACKDROP_SEGMENTS = 96;

export function buildScene(
  definition: LevelDefinition,
  assets: SceneAssets = NO_ASSETS,
): BuiltScene {
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

  // ------------------------------------------------------------- sky dome
  const sky = buildSkyDome(definition, assets.skyGradient);
  if (sky) scene.add(sky);

  // --------------------------------------------------------- city backdrop
  const backdrop = buildCityBackdrop(definition, assets.cityBackdrop);
  if (backdrop) scene.add(backdrop);

  // --------------------------------------------------------- ground grid
  // A grid is the cheapest way to give the eye something to track while
  // moving; the ground is otherwise a flat void below the fog.
  const grid = new THREE.GridHelper(300, 60, 0x2b3a55, 0x1b2231);
  grid.name = 'ground-grid';
  grid.position.set(0, environment.backdrop.baseY + 0.01, 0);
  scene.add(grid);

  return {
    scene,
    sun,
    meshes,
    sky,
    backdrop,
    dispose(): void {
      scene.clear();
      geometry.dispose();
      for (const material of materials.values()) material.dispose();
      disposeRenderable(grid);
      if (sky) disposeRenderable(sky);
      if (backdrop) disposeRenderable(backdrop);
    },
  };
}

/**
 * The sky: a vertical gradient on the inside of a large sphere.
 *
 * `fog: false` is essential - the dome is further away than the fog's far
 * plane, so with fog enabled it would be entirely fog-coloured.
 */
function buildSkyDome(
  definition: LevelDefinition,
  gradient: THREE.Texture | null,
): THREE.Mesh | null {
  const radius = definition.environment.skyRadius;
  if (!(radius > 0)) return null;

  const material = new THREE.MeshBasicMaterial({
    side: THREE.BackSide,
    fog: false,
    // Neither writes nor tests depth: it is the backdrop of everything.
    depthWrite: false,
  });

  if (gradient) {
    material.map = gradient;
  } else {
    material.color = new THREE.Color(definition.environment.skyColor);
  }

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), material);
  mesh.name = 'sky';
  // It always surrounds the camera, so culling it can only ever be wrong.
  mesh.frustumCulled = false;
  // Draw before the world, with depth writes off, so everything lands on top.
  mesh.renderOrder = -1;
  return mesh;
}

/**
 * The city: an open-ended cylinder with the skyline wrapped around the inside.
 *
 * The texture's own alpha does the work - transparent above the rooftops, opaque
 * below - so the gradient sky shows through the gaps in the skyline. `MeshBasicMaterial`
 * keeps the painted colours exactly as authored; the skyline is a backdrop, not
 * a lit surface.
 */
function buildCityBackdrop(
  definition: LevelDefinition,
  texture: THREE.Texture | null,
): THREE.Mesh | null {
  if (!texture) return null;

  const { radius, height, baseY, repeat } = definition.environment.backdrop;
  if (!(radius > 0) || !(height > 0)) return null;

  // Wrap horizontally so the skyline circles the level; clamp vertically so the
  // sky and the ground line stay put.
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.repeat.set(repeat, 1);
  texture.needsUpdate = true;

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
  });

  const geometry = new THREE.CylinderGeometry(radius, radius, height, BACKDROP_SEGMENTS, 1, true);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'city-backdrop';
  mesh.position.y = baseY + height / 2;
  mesh.frustumCulled = false;
  return mesh;
}

/** Releases the geometry and materials of anything drawn in the scene. */
function disposeRenderable(object: {
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material | THREE.Material[];
}): void {
  object.geometry.dispose();
  const material = object.material;
  if (Array.isArray(material)) for (const entry of material) entry.dispose();
  else material.dispose();
}
