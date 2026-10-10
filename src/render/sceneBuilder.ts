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
import { isElevatorGateOf, resolvePropParts } from '../game/level/level.js';
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
  /**
   * What each prop was drawn as: how many model parts it resolved into, and the
   * material each was drawn with.
   *
   * V0.7.1 stopped keeping a mesh per part - the parts are merged into per-chunk
   * buffers - so a prop is a count and a list of materials rather than a list of
   * meshes. The material objects are still shared per (surface, tint), so
   * `materials[0]` is the same object for two props that look the same.
   */
  readonly parts: ReadonlyMap<string, { readonly count: number; readonly materials: readonly THREE.Material[] }>;
  /**
   * The merged static geometry: one mesh per (chunk, material, shadow flags).
   *
   * This is what the frame actually draws, and the number to watch: it is the
   * draw-call count of the city, and it is about a thousand rather than forty
   * thousand.
   *
   * `userData.castsChunk` is the prop's own shadow flag, kept because the view
   * switches casting off for chunks the shadow volume cannot reach and needs to
   * know which ones were casting to begin with - see `View.updateShadowCasters`.
   */
  readonly chunks: readonly THREE.Mesh[];
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
  /**
   * Elevator gates, keyed by the gate prop's id.
   *
   * Groups rather than loose meshes, because a gate slides: it is the one prop part
   * that moves without the level saying so.
   */
  readonly gates: ReadonlyMap<string, THREE.Object3D>;
  /** Pickups, keyed by id. Hidden once taken. */
  readonly collectibles: ReadonlyMap<string, THREE.Object3D>;
  /** Every smoke sprite, with its emitter, for the animation pass. */
  readonly smoke: readonly SmokeEmitterMesh[];
  /**
   * The scene's point lights.
   *
   * Kept so a graphics preset can drop some of them: they are the most expensive
   * thing in the scene to leave on (each one is a per-pixel loop iteration in every
   * lit fragment), and on a low preset the lamps are the first thing to go.
   */
  readonly lamps: readonly THREE.PointLight[];
  /**
   * Every material the scene owns, keyed by the surface (or part) that uses it.
   *
   * Exposed because a graphics change is not only a renderer change: switching
   * shadows on or off alters which shader program a material compiles to, and
   * three.js will happily keep using the old one until something marks each of
   * these dirty.
   */
  readonly materials: ReadonlyMap<string, THREE.Material>;
  /** The city skyline, when one was built. */
  readonly backdrop: THREE.Mesh | null;
  dispose(): void;
}

/**
 * Side of a merged chunk, in metres.
 *
 * V0.7.1's bargain. The city is 41,915 model parts, and one mesh each was 41,915
 * draw calls a frame - a number no browser can push, whatever the triangle count
 * says. Merging them is the only fix that helps: a part is a box with a position,
 * and forty thousand boxes that never move can share a vertex buffer.
 *
 * Chunked rather than merged whole, because merging the whole city into one buffer per
 * material would lose frustum culling entirely - the renderer would draw every roof in the
 * city while the player looks at a wall.
 *
 * **The number is a draw-call budget rather than a culling unit, and it is 500.** At 128 m -
 * which is where it started, chosen as "about two blocks" - the city came out as 1,578 chunk
 * meshes and a street view asked the browser for 663 draw calls, because every chunk is split
 * once more by material. At 500 m the whole kilometre is four meshes per material, and the
 * same view asks for about 150. What that costs is culling resolution: a 500 m chunk is rarely
 * entirely off screen, so most of the city's triangles are submitted every frame - 822k
 * against 358k. Draw calls are what a browser runs out of first, and the GPU does not notice
 * three quarters of a million triangles.
 */
const CHUNK = 500;

/**
 * A growable buffer of box geometry, in one chunk's local space.
 *
 * Written to rather than `push`ed into: the parts are appended one vertex at a
 * time, one million verts in total, and a double-precision `Array` would spend
 * longer reallocating than the rest of the build takes. Typed arrays that double
 * when they fill cost one copy every doubling instead of one per append.
 */
class PartBuffer {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  vertices = 0;
  indexCount = 0;

  constructor(capacity = 1024) {
    this.positions = new Float32Array(capacity * 3);
    this.normals = new Float32Array(capacity * 3);
    this.uvs = new Float32Array(capacity * 2);
    this.indices = new Uint32Array(capacity * 2);
  }

  /** Grows the vertex arrays so `extra` more vertices fit. */
  private room(extra: number): void {
    if (this.vertices + extra <= this.positions.length / 3) return;
    let capacity = this.positions.length / 3;
    while (capacity < this.vertices + extra) capacity *= 2;
    const positions = new Float32Array(capacity * 3);
    const normals = new Float32Array(capacity * 3);
    const uvs = new Float32Array(capacity * 2);
    positions.set(this.positions.subarray(0, this.vertices * 3));
    normals.set(this.normals.subarray(0, this.vertices * 3));
    uvs.set(this.uvs.subarray(0, this.vertices * 2));
    this.positions = positions;
    this.normals = normals;
    this.uvs = uvs;
  }

  private roomForIndices(extra: number): void {
    if (this.indexCount + extra <= this.indices.length) return;
    let capacity = this.indices.length;
    while (capacity < this.indexCount + extra) capacity *= 2;
    const indices = new Uint32Array(capacity);
    indices.set(this.indices.subarray(0, this.indexCount));
    this.indices = indices;
  }

  /**
   * Appends one part, offset by its position in the chunk's own frame.
   *
   * The source is the *cached* box, so the vertices, normals and - the part that
   * matters - the UVs are bit-for-bit what an unmerged mesh would have drawn.
   * Nothing here recomputes geometry; it copies it somewhere else.
   */
  add(source: THREE.BufferGeometry, dx: number, dy: number, dz: number): void {
    const position = source.getAttribute('position');
    const normal = source.getAttribute('normal');
    const uv = source.getAttribute('uv');
    const count = position.count;
    this.room(count);

    const pa = position.array as Float32Array;
    const na = normal?.array as Float32Array | undefined;
    const ua = uv?.array as Float32Array | undefined;
    const base = this.vertices;
    let v = base * 3;
    let t = base * 2;
    for (let index = 0; index < count; index += 1) {
      this.positions[v] = (pa[index * 3] as number) + dx;
      this.positions[v + 1] = (pa[index * 3 + 1] as number) + dy;
      this.positions[v + 2] = (pa[index * 3 + 2] as number) + dz;
      if (na) {
        this.normals[v] = na[index * 3] as number;
        this.normals[v + 1] = na[index * 3 + 1] as number;
        this.normals[v + 2] = na[index * 3 + 2] as number;
      }
      if (ua) {
        this.uvs[t] = ua[index * 2] as number;
        this.uvs[t + 1] = ua[index * 2 + 1] as number;
      }
      v += 3;
      t += 2;
    }

    const index = source.getIndex();
    if (index) {
      const ia = index.array as Uint32Array | Uint16Array;
      this.roomForIndices(index.count);
      for (let i = 0; i < index.count; i += 1) {
        this.indices[this.indexCount + i] = (ia[i] as number) + base;
      }
      this.indexCount += index.count;
    } else {
      this.roomForIndices(count);
      for (let i = 0; i < count; i += 1) {
        this.indices[this.indexCount + i] = base + i;
      }
      this.indexCount += count;
    }

    this.vertices += count;
  }

  /** The buffer as geometry, trimmed to what was actually written. */
  bake(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.positions.subarray(0, this.vertices * 3), 3),
    );
    geometry.setAttribute(
      'normal',
      new THREE.BufferAttribute(this.normals.subarray(0, this.vertices * 3), 3),
    );
    geometry.setAttribute(
      'uv',
      new THREE.BufferAttribute(this.uvs.subarray(0, this.vertices * 2), 2),
    );
    geometry.setIndex(
      new THREE.BufferAttribute(this.indices.subarray(0, this.indexCount), 1),
    );
    return geometry;
  }
}

/**
 * How far a chunk must extend beyond the eye before it can stop casting.
 *
 * The shadow camera's half-extent plus a chunk's half-diagonal: a chunk whose
 * centre is inside that could still have a corner inside the volume, so it is kept.
 * Deliberately generous - a chunk dropped too early is a shadow that flickers at
 * the edge of the map, and one kept too long costs a draw call.
 */
export function shadowReachFor(extent: number): number {
  return Math.max(1, extent) + CHUNK * 0.5 * Math.SQRT2;
}

/**
 * Lets only the chunks a shadow volume can reach cast into it, and reports how
 * many that is.
 *
 * A shadow pass draws every caster in the scene and clips the rest: vertices
 * outside the shadow camera are clipped, not culled. With a mesh per prop that cost
 * nothing worth measuring. With the city merged into a thousand chunks it is a
 * second full pass over half a million triangles for a map 220 m across, so a chunk
 * casts only while the volume is near it. What that changes *visually* is nothing -
 * everything switched off was outside the map already - and the pass gets short
 * enough to be worth the bookkeeping.
 *
 * A chunk that was never a caster is never made one: the prop's own flag is the
 * authority, and this only ever takes casting away.
 */
/**
 * How far a chunk stays drawn, in metres.
 *
 * The fog runs from 260 m to 1150, and by 420 m a chunk is a fifth of the way to opaque -
 * a silhouette of a silhouette. The city is a kilometre across, so at this distance a street
 * view draws a third of it, and what it drops is what nobody can see anyway.
 */
const DRAW_DISTANCE = 420;

/**
 * Draws the chunks near the player, and stops drawing the rest.
 *
 * The rule V0.7.1 needed for shadows, for the same reason and from the other end: a merged
 * chunk cannot be culled by the renderer unless its whole bounding box is off screen, and a
 * kilometre of city is never off screen. Frustum culling alone draws everything in front of
 * you however far away it is; this is the distance half of the same idea.
 *
 * Returns how many chunks are still being drawn.
 */
export function updateChunkVisibility(
  chunks: readonly THREE.Mesh[],
  eye: ReadonlyVec3,
  far = DRAW_DISTANCE,
): number {
  const reach = far * far;
  let drawn = 0;
  for (const mesh of chunks) {
    // **A chunk bigger than a chunk is not a chunk.** The street is one prop 1200 m across, so
    // it is merged into one mesh whose bounding sphere is the whole map - and culling by the
    // distance to that sphere's *centre* hides the entire ground the moment the player is 420 m
    // from the middle of it, which is what "the ground turned transparent" was: not a material
    // and not a depth problem, the floor simply not being drawn.
    const radius = mesh.geometry.boundingSphere?.radius ?? 0;
    if (radius > 200) {
      if (!mesh.visible) mesh.visible = true;
      drawn += 1;
      continue;
    }
    const dx = mesh.position.x - eye.x;
    const dz = mesh.position.z - eye.z;
    const visible = dx * dx + dz * dz < reach;
    if (mesh.visible !== visible) mesh.visible = visible;
    if (visible) drawn += 1;
  }
  return drawn;
}

export function updateShadowCasters(
  chunks: readonly THREE.Mesh[],
  eye: ReadonlyVec3,
  reach: number,
): number {
  let casting = 0;
  for (const mesh of chunks) {
    if (mesh.userData.castsChunk !== true) continue;
    const dx = mesh.position.x - eye.x;
    const dz = mesh.position.z - eye.z;
    const wanted = Math.abs(dx) < reach && Math.abs(dz) < reach;
    if (mesh.castShadow !== wanted) mesh.castShadow = wanted;
    if (wanted) casting += 1;
  }
  return casting;
}

/** Distance of the sun from the origin. Only affects the shadow camera setup. */
const SUN_DISTANCE = 160;

/**
 * Half-extent of the shadow volume, in metres.
 *
 * V0.5 widened it from 62 to cover the whole district rather than only the home
 * roof: the works level runs out to x = 105, and a lift ride that crosses out of
 * the shadow volume is a shadow that disappears halfway. The cost is resolution -
 * 220 m across the shadow map - which is why the map is sized by the graphics
 * preset rather than fixed: 2048 texels is 10.7 cm per texel, and 4096 is 5.4 cm,
 * which is the difference between a chunky shadow edge and a clean one.
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
  // The sky the reflections come from, when there is one. Borrowed like every other
  // texture here, and never disposed by this file.
  const skybox = assets.skybox ?? null;
  scene.fog = new THREE.Fog(
    new THREE.Color(environment.fogColor),
    environment.fogNear,
    environment.fogFar,
  );

  /** Geometries built outside the box cache (the goal pad and beam). */
  const looseGeometries: THREE.BufferGeometry[] = [];
  const materials = new Map<string, THREE.Material>();
  /**
   * Box geometries, keyed by everything that determines one.
   *
   * V0.6's optimisation pass, and the largest single win available in this scene.
   * A prop is built from parts, and parts repeat: every `band()` trim on a 0.6 m
   * slab is the same box with the same texture scale, on every prop that has one.
   * Building each one separately means hundreds of identical vertex buffers, each
   * uploaded and held separately, for geometry that is *identical* - not merely
   * similar. Keying the cache on the exact inputs (size, tile size, UV scale) makes
   * sharing exact rather than approximate, so nothing renders differently.
   *
   * Because the key is the full tuple, this can only ever merge parts that would
   * have produced byte-identical geometry.
   */
  const geometryCache = new Map<string, THREE.BufferGeometry>();

  const boxGeometry = (
    width: number,
    height: number,
    depth: number,
    metresPerTile: number,
    u: readonly number[],
    v: readonly number[],
  ): THREE.BufferGeometry => {
    const key = `${width}|${height}|${depth}|${metresPerTile}|${u.join(',')}|${v.join(',')}`;
    const cached = geometryCache.get(key);
    if (cached) return cached;

    const geometry = new THREE.BoxGeometry(width, height, depth);
    scaleBoxUvs(geometry, metresPerTile, { u: u as number[], v: v as number[] });
    geometryCache.set(key, geometry);
    return geometry;
  };

  /** The UV scales a box of this size wants, in three.js's face order. */
  const uvScales = (
    width: number,
    height: number,
    depth: number,
  ): { u: number[]; v: number[] } => ({
    u: [depth, depth, width, width, width, width],
    v: [height, height, depth, depth, height, height],
  });

  const materialFor = (surfaceId: string, tint: string): THREE.Material => {
    const key = `${surfaceId}|${tint}`;
    // Keyed by surface and tint, so a texture and a colour that repeat share one material
    // however many props use them. The cache holds whatever the surface asked for - lambert
    // for the flat-shaded city, phong for the glass.
    const cached = materials.get(key);
    if (cached) return cached;

    const surface = surfaceById(surfaceId);
    const texture = surface ? (assets.surfaces.get(surface.texture) ?? null) : null;
    // An emissive surface lights itself: the tint becomes the *emissive* colour
    // and the map modulates it, so only the light parts of the sign texture glow.
    // The albedo goes dark, so the sun does not wash the glow out.
    const emissive = surface?.emissive === true;

    // A reflective surface is the one place the renderer leaves flat shading behind. Metal
    // and glass do not have a colour so much as a reflection: a window painted a pale blue
    // and lit by a lambert term looks like paper, so these get a specular highlight and the
    // skybox as an environment map - which is what makes a canopy change as you walk past
    // it, and what makes a hundred solar panels on a roof read as one gleaming surface
    // rather than a hundred grey rectangles.
    const reflective = surface?.reflectivity ?? 0;
    const material =
      reflective > 0
        ? new THREE.MeshPhongMaterial({
            color: new THREE.Color(tint),
            map: texture,
            specular: new THREE.Color('#8fa6bd'),
            shininess: 40 + reflective * 120,
            envMap: skybox,
            reflectivity: reflective,
            combine: THREE.MixOperation,
            flatShading: true,
          })
        : new THREE.MeshLambertMaterial({
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
      const scales = uvScales(width, height, depth);
      const geometry = boxGeometry(width, height, depth, metresPerTile, scales.u, scales.v);

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

  // ------------------------------------------------------- merged static parts
  //
  // Every static part goes into one buffer per (chunk, material, shadow flags)
  // instead of becoming its own mesh. The parts do not move, so they can share a
  // vertex buffer, and what a prop "is" to the rest of the scene is now a count
  // and the materials it was drawn with.
  //
  // Gates are the exception, and were being drawn *twice* until V0.7.1: they are
  // props, so the loop below used to take them, and they are also built as groups
  // further down because they slide. The group moved and the copy did not, so a
  // shutter that had opened still stood shut in front of the opening. A moving
  // part must not be merged, which is the same rule that keeps doors and lift cars
  // out of here.
  const gateProps = new Set<string>();
  for (const elevator of definition.elevators ?? []) {
    for (const prop of definition.props) {
      if (isElevatorGateOf(elevator.id, prop.id)) gateProps.add(prop.id);
    }
  }

  const buckets = new Map<string, { material: THREE.Material; buffer: PartBuffer; cx: number; cz: number; cast: boolean; receive: boolean }>();
  const partInfo = new Map<string, { count: number; materials: THREE.Material[] }>();

  for (const prop of definition.props) {
    if (gateProps.has(prop.id)) continue;
    const parts = resolvePropParts(prop);
    const used: THREE.Material[] = [];
    let drawn = 0;

    for (const entry of parts) {
      const width = entry.max.x - entry.min.x;
      const height = entry.max.y - entry.min.y;
      const depth = entry.max.z - entry.min.z;
      if (width <= 0 || height <= 0 || depth <= 0) continue;

      const surfaceId = entry.surface;
      const surface = surfaceById(surfaceId);
      const tint = prop.tints?.[surfaceId] ?? surface?.tint ?? '#8a8f99';
      const metresPerTile = surface?.metresPerTile ?? 2;

      // Repeat the texture in *world* space by pre-scaling the UVs, so a texture
      // keeps a constant physical size however big the part is. UVs are stored
      // four vertices per face, in the order +X, -X, +Y, -Y, +Z, -Z.
      const scales = uvScales(width, height, depth);
      const geometry = boxGeometry(width, height, depth, metresPerTile, scales.u, scales.v);

      const material = materialFor(surfaceId, tint);
      const centreX = (entry.min.x + entry.max.x) / 2;
      const centreY = (entry.min.y + entry.max.y) / 2;
      const centreZ = (entry.min.z + entry.max.z) / 2;

      // The chunk the part's *centre* is in, so a part belongs to whichever chunk
      // it mostly occupies rather than to the one its corner touches.
      const cx = Math.floor(centreX / CHUNK);
      const cz = Math.floor(centreZ / CHUNK);
      const cast = (prop.castShadow ?? true) && entry.castShadow;
      const receive = (prop.receiveShadow ?? true) && entry.receiveShadow;
      const key = `${cx}|${cz}|${surfaceId}|${tint}|${cast ? 1 : 0}${receive ? 1 : 0}`;

      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          material,
          buffer: new PartBuffer(),
          cx,
          cz,
          cast,
          receive,
        };
        buckets.set(key, bucket);
      }
      // Chunk-local coordinates: a metre-wide box ten kilometres from the origin
      // has no precision left in a float, and a city is a kilometre across.
      bucket.buffer.add(geometry, centreX - (cx + 0.5) * CHUNK, centreY, centreZ - (cz + 0.5) * CHUNK);

      used.push(material);
      drawn += 1;
    }

    partInfo.set(prop.id, { count: drawn, materials: used });
  }

  /** The merged chunk meshes, for the shadow pass and for the draw-call count. */
  const chunks: THREE.Mesh[] = [];
  let mergedParts = 0;
  for (const bucket of buckets.values()) {
    const geometry = bucket.buffer.bake();
    const mesh = new THREE.Mesh(geometry, bucket.material);
    mesh.name = `chunk:${bucket.cx}:${bucket.cz}`;
    mesh.position.set((bucket.cx + 0.5) * CHUNK, 0, (bucket.cz + 0.5) * CHUNK);
    mesh.castShadow = bucket.cast;
    mesh.receiveShadow = bucket.receive;
    // Remembered as well as applied: the view switches casting off for chunks the
    // shadow volume cannot reach, and has to know which ones were casting to begin
    // with. See `BuiltScene.chunks`.
    mesh.userData.castsChunk = bucket.cast;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    geometry.computeBoundingSphere();
    scene.add(mesh);
    chunks.push(mesh);
    mergedParts += bucket.buffer.vertices / 24;
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

  // -------------------------------------------------------------- elevators
  // A car is a platform whose collider the game moves, so its meshes have to move with
  // it: the group sits at the car's south-west underside and only its height changes.
  //
  // The gates are ordinary props with an extruded model, but each one is *pulled out
  // of the props loop into its own group*, because the gate has to slide. A prop's
  // parts are added straight to the scene, and a group is the only thing the game can
  // translate as a unit.
  const lifts = new Map<string, THREE.Object3D>();
  const gates = new Map<string, THREE.Object3D>();
  const carModel = modelById('elevator-car') ?? modelById('lift-platform');
  for (const elevator of definition.elevators ?? []) {
    if (!carModel) break;
    const size = { x: elevator.size[0], y: elevator.thickness, z: elevator.size[1] };
    const group = modelGroup(`lift:${elevator.id}`, carModel, { x: 0, y: 0, z: 0 }, size);
    const startY = elevator.floors[elevator.start ?? 0] ?? 0;
    group.position.set(elevator.at[0] - size.x / 2, startY - size.y, elevator.at[1] - size.z / 2);
    scene.add(group);
    lifts.set(elevator.id, group);

    for (const prop of definition.props) {
      if (!isElevatorGateOf(elevator.id, prop.id)) continue;
      const gateModel = modelById(prop.model);
      if (!gateModel) continue;
      const origin = {
        x: prop.position.x - prop.size.x / 2,
        y: prop.position.y - prop.size.y / 2,
        z: prop.position.z - prop.size.z / 2,
      };
      const gate = modelGroup(`gate:${prop.id}`, gateModel, origin, prop.size);
      gate.position.set(0, 0, 0);
      scene.add(gate);
      gates.set(prop.id, gate);
    }
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
    looseGeometries.push(padGeometry, beamGeometry);

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
  const lamps: THREE.PointLight[] = [];
  for (const light of definition.lights ?? []) {
    const point = new THREE.PointLight(new THREE.Color(light.color), light.intensity, light.distance);
    point.position.set(light.position.x, light.position.y, light.position.z);
    point.name = light.id;
    point.castShadow = false;
    scene.add(point);
    lamps.push(point);
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
    parts: partInfo,
    chunks,
    doors,
    collectibles,
    lifts,
    gates,
    smoke,
    lamps,
    materials,
    backdrop,
    dispose(): void {
      scene.clear();
      for (const mesh of chunks) (mesh.geometry as THREE.BufferGeometry).dispose();
      for (const geometry of geometryCache.values()) geometry.dispose();
      for (const geometry of looseGeometries) geometry.dispose();
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
