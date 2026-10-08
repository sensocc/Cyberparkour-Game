/**
 * Builds the three.js scene from a `LevelDefinition`.
 *
 * Geometry comes from the model library: every prop is resolved into axis-aligned
 * parts, and each part becomes one mesh. Materials are cached per
 * (texture, tint) pair, so a roof of forty props still costs a handful of
 * materials.
 *
 * **Textures are borrowed, not owned.** The view is torn down and rebuilt on
 * every restart, so the textures outlive it - disposing them here would leave the
 * next session with no sky and untextured props. Only the geometry and materials
 * created here are disposed.
 */

import * as THREE from 'three';

import type { LevelDefinition } from '../game/level/levelData.js';
import { resolvePropParts } from '../game/level/level.js';
import { surfaceById } from '../game/level/surfaces.js';
import { NO_ASSETS, type SceneAssets } from './types.js';

export interface BuiltScene {
  readonly scene: THREE.Scene;
  readonly sun: THREE.DirectionalLight;
  /** Meshes by prop id, one entry per part. */
  readonly meshes: ReadonlyMap<string, readonly THREE.Mesh[]>;
  /** The city skyline, when one was built. */
  readonly backdrop: THREE.Mesh | null;
  dispose(): void;
}

/** Distance of the sun from the origin. Only affects the shadow camera setup. */
const SUN_DISTANCE = 160;

/** Half-extent of the shadow volume, in metres. Sized to the demo roof. */
const SHADOW_EXTENT = 62;

/** Radial segments in the skyline cylinder; enough to read as round. */
const BACKDROP_SEGMENTS = 96;

export function buildScene(
  definition: LevelDefinition,
  assets: SceneAssets = NO_ASSETS,
): BuiltScene {
  const environment = definition.environment;

  const scene = new THREE.Scene();
  // A cube skybox needs no geometry and is never fogged, which is exactly what
  // a sky should be. Without one, a flat colour stands in.
  scene.background = assets.skybox ?? new THREE.Color(environment.skyColor);
  scene.fog = new THREE.Fog(
    new THREE.Color(environment.fogColor),
    environment.fogNear,
    environment.fogFar,
  );

  const geometries: THREE.BufferGeometry[] = [];
  const materials = new Map<string, THREE.MeshLambertMaterial>();
  const meshes = new Map<string, THREE.Mesh[]>();

  const materialFor = (surfaceId: string, tint: string): THREE.MeshLambertMaterial => {
    const key = `${surfaceId}|${tint}`;
    const cached = materials.get(key);
    if (cached) return cached;

    const surface = surfaceById(surfaceId);
    const material = new THREE.MeshLambertMaterial({
      color: new THREE.Color(tint),
      map: surface ? (assets.surfaces.get(surface.texture) ?? null) : null,
      // Flat shading keeps the low-poly silhouette crisp, Quake-style.
      flatShading: true,
    });
    materials.set(key, material);
    return material;
  };

  for (const prop of definition.props) {
    const parts = resolvePropParts(prop);
    const propMeshes: THREE.Mesh[] = [];

    for (const [index, entry] of parts.entries()) {
      const width = entry.max.x - entry.min.x;
      const height = entry.max.y - entry.min.y;
      const depth = entry.max.z - entry.min.z;
      if (width <= 0 || height <= 0 || depth <= 0) continue;

      const surfaceId = entry.surface;
      const surface = surfaceById(surfaceId);
      const tint = prop.tints?.[surfaceId] ?? surface?.tint ?? '#8a8f99';
      const metresPerTile = surface?.metresPerTile ?? 2;

      const geometry = new THREE.BoxGeometry(width, height, depth);
      // Repeat the texture in *world* space by pre-scaling the UVs, so a texture
      // keeps a constant physical size however big the part is. UVs are stored
      // four vertices per face, in the order +X, -X, +Y, -Y, +Z, -Z.
      scaleBoxUvs(geometry, metresPerTile, {
        u: [depth, depth, width, width, width, width],
        v: [height, height, depth, depth, height, height],
      });
      geometries.push(geometry);

      const mesh = new THREE.Mesh(geometry, materialFor(surfaceId, tint));
      mesh.position.set(
        (entry.min.x + entry.max.x) / 2,
        (entry.min.y + entry.max.y) / 2,
        (entry.min.z + entry.max.z) / 2,
      );
      mesh.castShadow = (prop.castShadow ?? true) && entry.castShadow;
      mesh.receiveShadow = (prop.receiveShadow ?? true) && entry.receiveShadow;
      mesh.name = `${prop.id}#${index}`;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();

      scene.add(mesh);
      propMeshes.push(mesh);
    }

    meshes.set(prop.id, propMeshes);
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
  shadowCamera.far = SUN_DISTANCE * 2.5;
  shadowCamera.updateProjectionMatrix();

  scene.add(ambient);
  scene.add(sun);
  scene.add(sun.target);

  // --------------------------------------------------------- city backdrop
  const backdrop = buildCityBackdrop(definition, assets.cityBackdrop);
  if (backdrop) scene.add(backdrop);

  // ------------------------------------------------------------ ground grid
  // A grid is the cheapest way to give the eye something to track while
  // moving; the ground is otherwise a flat void below the fog.
  const grid = new THREE.GridHelper(360, 72, 0x2b3a55, 0x1b2231);
  grid.name = 'ground-grid';
  grid.position.set(0, environment.backdrop.baseY + 0.01, 0);
  scene.add(grid);

  return {
    scene,
    sun,
    meshes,
    backdrop,
    dispose(): void {
      scene.clear();
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials.values()) material.dispose();
      disposeRenderable(grid);
      if (backdrop) disposeRenderable(backdrop);
    },
  };
}

/**
 * Multiplies a box geometry's UVs so its texture repeats in world space.
 *
 * `BoxGeometry` emits four vertices per face in the order +X, -X, +Y, -Y, +Z, -Z,
 * and `u`/`v` give each face's real-world width and height. Dividing those by
 * the tile size is all it takes for a 0.6 m kerb and a 72 m deck to show the
 * same texel density.
 */
export function scaleBoxUvs(
  geometry: THREE.BufferGeometry,
  metresPerTile: number,
  faceSizes: { readonly u: readonly number[]; readonly v: readonly number[] },
): void {
  const uv = geometry.getAttribute('uv');
  if (!uv) return;

  for (let face = 0; face < 6; face += 1) {
    const uScale = (faceSizes.u[face] ?? 1) / metresPerTile;
    const vScale = (faceSizes.v[face] ?? 1) / metresPerTile;
    for (let vertex = 0; vertex < 4; vertex += 1) {
      const index = face * 4 + vertex;
      uv.setXY(index, uv.getX(index) * uScale, uv.getY(index) * vScale);
    }
  }
  uv.needsUpdate = true;
}

/**
 * The city: an open-ended cylinder with the skyline wrapped around the inside.
 *
 * The texture's own alpha does the work - transparent above the rooftops, opaque
 * below - so the skybox shows through the gaps in the skyline. `MeshBasicMaterial`
 * keeps the painted colours exactly as authored; the skyline is a backdrop, not a
 * lit surface.
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
