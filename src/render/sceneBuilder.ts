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

import type { ReadonlyVec3 } from '../core/vec3.js';
import type { LevelDefinition } from '../game/level/levelData.js';
import { resolvePropParts } from '../game/level/level.js';
import { modelById, resolveModelParts, type ModelDefinition } from '../game/level/models.js';
import { surfaceById } from '../game/level/surfaces.js';
import type { SmokeEmitter } from './effects.js';
import { NO_ASSETS, type SceneAssets } from './types.js';

/** One smoke sprite, with the emitter that drives it. */
export interface SmokeEmitterMesh {
  readonly sprite: THREE.Sprite;
  readonly emitter: SmokeEmitter;
}

export interface BuiltScene {
  readonly scene: THREE.Scene;
  readonly sun: THREE.DirectionalLight;
  /** Meshes by prop id, one entry per part. */
  readonly meshes: ReadonlyMap<string, readonly THREE.Mesh[]>;
  /**
   * Door leaves, keyed by door id.
   *
   * Each is a pivot group at the hinge; the game rotates it to open and close the
   * door. Kept separate from `meshes` because these move.
   */
  readonly doors: ReadonlyMap<string, THREE.Object3D>;
  /**
   * Lift cars, keyed by lift id.
   *
   * Like doors, these move - but along Y and under the game's control rather
   * than the player's.
   */
  readonly lifts: ReadonlyMap<string, THREE.Object3D>;
  /** Pickups, keyed by id. Hidden once taken. */
  readonly collectibles: ReadonlyMap<string, THREE.Object3D>;
  /** Every smoke sprite, with its emitter, for the animation pass. */
  readonly smoke: readonly SmokeEmitterMesh[];
  /** The city skyline, when one was built. */
  readonly backdrop: THREE.Mesh | null;
  dispose(): void;
}

/** Distance of the sun from the origin. Only affects the shadow camera setup. */
const SUN_DISTANCE = 160;

/**
 * Half-extent of the shadow volume, in metres.
 *
 * V0.5 widened it from 62 to cover the whole district rather than only the home
 * roof: the works level runs out to x = 105, and a lift ride that crosses out of
 * the shadow volume is a shadow that disappears halfway. The cost is resolution -
 * 220 m across 2048 texels rather than 124 - which the soft shadow filter hides.
 */
const SHADOW_EXTENT = 110;

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
  const materials = new Map<string, THREE.Material>();
  const meshes = new Map<string, THREE.Mesh[]>();

  const materialFor = (surfaceId: string, tint: string): THREE.MeshLambertMaterial => {
    const key = `${surfaceId}|${tint}`;
    // The cache is keyed by material type as well as surface, so a sprite can
    // share it; only the surface materials are looked up as lambert.
    const cached = materials.get(key);
    if (cached) return cached as THREE.MeshLambertMaterial;

    const surface = surfaceById(surfaceId);
    const texture = surface ? (assets.surfaces.get(surface.texture) ?? null) : null;
    // An emissive surface lights itself: the tint becomes the *emissive* colour
    // and the map modulates it, so only the light parts of the sign texture glow.
    // The albedo goes dark, so the sun does not wash the glow out.
    const emissive = surface?.emissive === true;

    const material = new THREE.MeshLambertMaterial({
      color: new THREE.Color(emissive ? '#1a1e26' : tint),
      map: texture,
      // Flat shading keeps the low-poly silhouette crisp, Quake-style.
      flatShading: true,
      ...(emissive
        ? { emissive: new THREE.Color(tint), emissiveMap: texture, emissiveIntensity: 1 }
        : {}),
    });
    materials.set(key, material);
    return material;
  };

  /**
   * Builds a group of meshes from a model, in the group's own local space.
   *
   * Doors, lifts and pickups all need the same thing - a model resolved into
   * meshes that move together - so it lives in one place rather than three. The
   * `origin` is where the model's own `[0, 1]` box starts, which for these is the
   * group's local origin, so the caller can then move the group anywhere.
   */
  const modelGroup = (
    name: string,
    model: ModelDefinition,
    origin: ReadonlyVec3,
    size: ReadonlyVec3,
  ): THREE.Group => {
    const group = new THREE.Group();
    group.name = name;

    for (const [index, entry] of resolveModelParts(model, origin, size).entries()) {
      const width = entry.max.x - entry.min.x;
      const height = entry.max.y - entry.min.y;
      const depth = entry.max.z - entry.min.z;
      if (width <= 0 || height <= 0 || depth <= 0) continue;

      const surface = surfaceById(entry.surface);
      const metresPerTile = surface?.metresPerTile ?? 2;
      const geometry = new THREE.BoxGeometry(width, height, depth);
      scaleBoxUvs(geometry, metresPerTile, {
        u: [depth, depth, width, width, width, width],
        v: [height, height, depth, depth, height, height],
      });
      geometries.push(geometry);

      const mesh = new THREE.Mesh(geometry, materialFor(entry.surface, surface?.tint ?? '#8a8f99'));
      mesh.position.set(
        (entry.min.x + entry.max.x) / 2,
        (entry.min.y + entry.max.y) / 2,
        (entry.min.z + entry.max.z) / 2,
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `${name}#${index}`;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      group.add(mesh);
    }

    return group;
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

  // ----------------------------------------------------------------- doors
  // A door is not a prop: it hangs off a pivot at its hinge and turns. The pivot
  // is a vertical line, so the group sits on that line and the leaf is built in
  // the group's local space, offset from the hinge.
  const doors = new Map<string, THREE.Object3D>();
  const doorModel = modelById('door-panel');
  for (const door of definition.doors ?? []) {
    if (!doorModel) break;
    const { x: sx, y: sy, z: sz } = door.size;

    let hingeX = door.position.x;
    let hingeZ = door.position.z;
    if (door.hinge === 'x-') hingeX = door.position.x - sx / 2;
    else if (door.hinge === 'x+') hingeX = door.position.x + sx / 2;
    else if (door.hinge === 'z-') hingeZ = door.position.z - sz / 2;
    else hingeZ = door.position.z + sz / 2;

    const origin = {
      x: door.position.x - sx / 2 - hingeX,
      y: -sy / 2,
      z: door.position.z - sz / 2 - hingeZ,
    };

    const group = modelGroup(`door:${door.id}`, doorModel, origin, door.size);
    group.position.set(hingeX, door.position.y, hingeZ);
    group.rotation.y = (door.open === true ? 1 : 0) * door.openAngle;
    scene.add(group);
    doors.set(door.id, group);
  }

  // ------------------------------------------------------------------ lifts
  // A lift is a platform whose collider the game moves, so its meshes have to
  // move with it. The group sits at the platform's south-west underside and the
  // game only ever changes its height.
  const lifts = new Map<string, THREE.Object3D>();
  const liftModel = modelById('lift-platform');
  for (const elevator of definition.elevators ?? []) {
    if (!liftModel) break;
    const size = { x: elevator.size[0], y: elevator.thickness, z: elevator.size[1] };
    const group = modelGroup(`lift:${elevator.id}`, liftModel, { x: 0, y: 0, z: 0 }, size);
    group.position.set(
      elevator.at[0] - size.x / 2,
      elevator.lowTop - size.y,
      elevator.at[1] - size.z / 2,
    );
    scene.add(group);
    lifts.set(elevator.id, group);
  }

  // ----------------------------------------------------------- collectibles
  const collectibles = new Map<string, THREE.Object3D>();
  const shardModel = modelById('data-shard');
  for (const pickup of definition.collectibles ?? []) {
    if (!shardModel) break;
    const group = modelGroup(`pickup:${pickup.id}`, shardModel, { x: -0.35, y: -0.35, z: -0.35 }, {
      x: 0.7,
      y: 0.7,
      z: 0.7,
    });
    group.position.set(pickup.position.x, pickup.position.y, pickup.position.z);
    scene.add(group);
    collectibles.set(pickup.id, group);
  }

  // ---------------------------------------------------------------- the goal
  // A pad and a column of light. The column is emissive *and* transparent, which
  // is the one place the two are combined: it should read as a beam rather than
  // as a solid, and it should read at night.
  const goal = definition.goal;
  if (goal) {
    const padMaterial = new THREE.MeshLambertMaterial({
      color: new THREE.Color('#1a1e26'),
      emissive: new THREE.Color('#4ff0c8'),
      emissiveIntensity: 1,
      transparent: true,
      opacity: 0.85,
    });
    materials.set('goal-pad', padMaterial);
    const beamMaterial = new THREE.MeshLambertMaterial({
      color: new THREE.Color('#12202a'),
      emissive: new THREE.Color('#4ff0c8'),
      emissiveIntensity: 1,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
    });
    materials.set('goal-beam', beamMaterial);

    const padGeometry = new THREE.BoxGeometry(2.6, 0.16, 2.6);
    const beamGeometry = new THREE.BoxGeometry(1.8, 6, 1.8);
    geometries.push(padGeometry, beamGeometry);

    const pad = new THREE.Mesh(padGeometry, padMaterial);
    pad.position.set(goal.position.x, goal.position.y + 0.08, goal.position.z);
    pad.receiveShadow = true;
    const beam = new THREE.Mesh(beamGeometry, beamMaterial);
    beam.position.set(goal.position.x, goal.position.y + 3.1, goal.position.z);

    const goalGroup = new THREE.Group();
    goalGroup.name = `goal:${goal.id}`;
    goalGroup.add(pad, beam);
    scene.add(goalGroup);
  }

  // ----------------------------------------------------------------- smoke
  // Plumes are camera-facing sprites, animated from the game clock. They live in
  // a list rather than a map because nothing looks one up: the view walks them
  // all every frame.
  const smoke: SmokeEmitterMesh[] = [];
  const smokeTexture = assets.smoke;
  if (smokeTexture) {
    for (const plume of definition.smoke ?? []) {
      for (let puff = 0; puff < plume.count; puff += 1) {
        // A material *per sprite*: they share the texture, but each puff fades on
        // its own schedule, and a shared material would fade them all together.
        const material = new THREE.SpriteMaterial({
          map: smokeTexture,
          transparent: true,
          depthWrite: false,
          opacity: 0,
        });
        materials.set(`smoke-${plume.id}-${puff}`, material);

        const sprite = new THREE.Sprite(material);
        sprite.name = `smoke:${plume.id}#${puff}`;
        scene.add(sprite);
        smoke.push({
          sprite,
          emitter: {
            position: plume.position,
            radius: plume.radius,
            rise: plume.rise,
            drift: plume.drift,
            period: plume.period,
            opacity: plume.opacity,
            // Spread evenly through the cycle, so a plume is a plume rather than
            // a row of puffs all rising together.
            phase: puff / plume.count,
          },
        });
      }
    }
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

  // ---------------------------------------------------------- scene lights
  // Interior lamps and sign glow. These cast no shadows: a point light shadow is
  // a cube map per light, and the demo's look does not need one.
  for (const light of definition.lights ?? []) {
    const point = new THREE.PointLight(new THREE.Color(light.color), light.intensity, light.distance);
    point.position.set(light.position.x, light.position.y, light.position.z);
    point.name = light.id;
    point.castShadow = false;
    scene.add(point);
  }

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
    doors,
    lifts,
    collectibles,
    smoke,
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
