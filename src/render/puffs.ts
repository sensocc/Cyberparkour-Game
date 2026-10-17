/**
 * Batched, camera-facing puffs - the one mechanism behind smoke, impact dust and anything else
 * that is a soft blob in the air.
 *
 * ## Why this exists
 *
 * V0.5 drew smoke as one `THREE.Sprite` per puff, each with its own `SpriteMaterial`, because a
 * shared material fades every puff together. That is one draw call *and one material per puff* -
 * forty-four of each for a single district - and it is why the city's smoke was switched off when
 * the level became a kilometre of grid: the cost did not scale.
 *
 * A puff is a billboarded quad. Forty-four of them can share one vertex buffer and one draw call,
 * which is exactly the trade V1.0.16 made for the lift shutters. This does that: one
 * `InstancedMesh`, one material, one draw call, however many puffs.
 *
 * ## Why it patches `MeshBasicMaterial` rather than writing a shader
 *
 * This renderer runs a **logarithmic depth buffer**, fog, ACES tone mapping and an sRGB output
 * space, and a hand-written shader that got any of those subtly wrong would show up as flickering
 * depth, a washed-out or doubled colour, or a puff that stops being fogged with distance - the
 * exact class of bug this project keeps finding. `MeshBasicMaterial` already compiles the right
 * program for all four, so the material is that material, and only two things are added:
 *
 *  - **Billboarding**, by writing the instance's centre into view space and offsetting it in the
 *    screen plane, rather than by rotating a transform.
 *  - **Per-instance opacity and scale**, carried in an instanced attribute and the instance
 *    matrix, so one material can fade a hundred puffs on a hundred schedules.
 */

import * as THREE from 'three';

/**
 * The largest number of puffs a field may hold.
 *
 * A field allocates its buffers once, at this size, and never grows - a frame in the middle of a
 * fall must not be the frame that reallocates a GPU buffer.
 */
export const MAX_PUFFS = 512;

/**
 * Adds billboarding and per-instance opacity to a `MeshBasicMaterial`.
 *
 * Exported so a test can assert the patch landed - a shader that silently fails to compile looks
 * like nothing at all, which is the hardest kind of bug to notice.
 */
export function patchPuffMaterial(material: THREE.MeshBasicMaterial): void {
  material.onBeforeCompile = (shader) => {
    // Declarations first: the raw shader still has its `#include` lines, and three.js prepends the
    // program's own prefix (with `USE_INSTANCING`, `USE_FOG`, `USE_LOGARITHMIC_DEPTH_BUFFER`, the
    // tone-mapping function and `linearToOutputTexel`) after this point, so everything the built-in
    // chunks need is already there.
    shader.vertexShader =
      'attribute float aPuffOpacity;\nvarying float vPuffOpacity;\n' + shader.vertexShader;

    shader.vertexShader = shader.vertexShader
      // The instance transform carries the puff's centre and its size, and *nothing else*: the
      // quad itself is thrown away and rebuilt facing the camera in view space, where +x is
      // screen-right and +y is screen-up. That is what makes it a billboard without a rotation to
      // keep in sync with the camera.
      .replace(
        '#include <project_vertex>',
        [
          'vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );',
          // Column 0 of the instance matrix is the size along x; the quad is uniform, so it is the
          // size along y too. Read rather than passed separately: it is already here.
          'float puffSize = length( instanceMatrix[ 0 ].xyz );',
          'mvPosition.xy += position.xy * puffSize;',
          'gl_Position = projectionMatrix * mvPosition;',
        ].join('\n'),
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvPuffOpacity = aPuffOpacity;');

    shader.fragmentShader = 'varying float vPuffOpacity;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      // After the map, so the texture's own alpha and the puff's fade multiply rather than one
      // replacing the other.
      '#include <map_fragment>\n\tdiffuseColor.a *= vPuffOpacity;',
    );
  };
  // A patched material is a different program from an unpatched one with the same parameters, and
  // three.js caches by a key built from this string. Without it, two materials that differ only in
  // their patch would share a program and one of them would lose its patch.
  material.customProgramCacheKey = () => 'puff-billboard-v1';
}

/**
 * One batched draw of camera-facing puffs.
 *
 * The caller fills it per frame - `begin`, then `push` per puff, then `commit` - which keeps every
 * allocation at construction time. `push` writes straight into the instance buffer rather than
 * building a `Matrix4`, because this runs for every puff every frame.
 */
export class InstancedPuffs {
  readonly mesh: THREE.InstancedMesh;
  private readonly opacity: THREE.InstancedBufferAttribute;
  private readonly matrixArray: Float32Array;
  private count = 0;
  private disposed = false;

  constructor(texture: THREE.Texture, capacity = MAX_PUFFS) {
    const quad = new THREE.PlaneGeometry(1, 1);
    this.opacity = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.opacity.setUsage(THREE.DynamicDrawUsage);
    quad.setAttribute('aPuffOpacity', this.opacity);

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      // Puffs must not occlude each other's depth or a plume becomes a flat sheet of the front
      // one; they are low-opacity and additive-looking, so order barely shows.
      depthWrite: false,
      side: THREE.DoubleSide,
      // The quad is rebuilt facing the camera in the shader, so nothing here needs to know which
      // way it is looking.
      fog: true,
    });
    patchPuffMaterial(material);

    this.mesh = new THREE.InstancedMesh(quad, material, capacity);
    this.mesh.name = 'puffs';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // The instances are spread over the whole map, so one bounding sphere would be the map; the
    // frustum test would either never cull it or cull it wrongly. It is one draw call either way.
    this.mesh.frustumCulled = false;
    // Nothing is drawn until the first `commit` says otherwise, and an un-committed field must not
    // draw a thousand unit quads at the origin.
    this.mesh.count = 0;
    this.matrixArray = this.mesh.instanceMatrix.array as Float32Array;
  }

  /** How many puffs the field can hold. */
  get capacity(): number {
    return this.mesh.instanceMatrix.count;
  }

  /** How many were pushed on the last `commit`. */
  get live(): number {
    return this.count;
  }

  /** Starts a frame: forgets the previous one's puffs. */
  begin(): void {
    this.count = 0;
  }

  /**
   * Adds one puff. Silently ignored once the field is full, so a caller cannot overrun it.
   *
   * Positional, not an object: a puff is pushed once per plume per frame - seventy-odd times a
   * frame - and an object literal there is seventy-odd allocations a second for five numbers. The
   * names live in the call sites, which are the two places a puff is born.
   */
  push(x: number, y: number, z: number, scale: number, opacity: number): void {
    const index = this.count;
    if (index >= this.capacity) return;

    const size = Number.isFinite(scale) ? Math.max(0, scale) : 0;
    const px = Number.isFinite(x) ? x : 0;
    const py = Number.isFinite(y) ? y : 0;
    const pz = Number.isFinite(z) ? z : 0;

    // A translation-and-scale matrix, written in place: three.js stores matrices column-major.
    const at = index * 16;
    const m = this.matrixArray;
    m[at] = size;
    m[at + 1] = 0;
    m[at + 2] = 0;
    m[at + 3] = 0;
    m[at + 4] = 0;
    m[at + 5] = size;
    m[at + 6] = 0;
    m[at + 7] = 0;
    m[at + 8] = 0;
    m[at + 9] = 0;
    m[at + 10] = size;
    m[at + 11] = 0;
    m[at + 12] = px;
    m[at + 13] = py;
    m[at + 14] = pz;
    m[at + 15] = 1;

    this.opacity.array[index] = Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 0;

    this.count += 1;
  }

  /** Publishes the frame's puffs to the GPU. */
  commit(): void {
    if (this.disposed) return;
    this.mesh.count = this.count;
    if (this.count === 0) return;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.opacity.needsUpdate = true;
  }

  /** Hides the whole field, for a preset that draws none of it. */
  setVisible(visible: boolean): void {
    this.mesh.visible = visible;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}

/**
 * A pooling emitter for short-lived puffs - impact dust, a landing's scuff.
 *
 * Unlike smoke, which is a *cycle* (a puff's position is a pure function of the clock), a puff of
 * dust is spawned, flies and dies, so it needs state. The state is a fixed ring, so nothing is
 * allocated after construction and a burst larger than the pool simply reuses its oldest puffs.
 */
export class PuffPool {
  private readonly x: Float32Array;
  private readonly y: Float32Array;
  private readonly z: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly vz: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly size: Float32Array;
  private readonly peak: Float32Array;
  private next = 0;

  constructor(private readonly capacity = 64) {
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.z = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.vz = new Float32Array(capacity);
    this.age = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.peak = new Float32Array(capacity);
    // Everything starts dead, so the first frame draws nothing until something is spawned.
    this.age.fill(Number.POSITIVE_INFINITY);
  }

  /** Spawns one puff, reusing the oldest slot when the pool is full. */
  spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    size: number,
    peak: number,
  ): void {
    const index = this.next;
    this.next = (this.next + 1) % this.capacity;
    this.x[index] = x;
    this.y[index] = y;
    this.z[index] = z;
    this.vx[index] = vx;
    this.vy[index] = vy;
    this.vz[index] = vz;
    this.age[index] = 0;
    this.life[index] = Math.max(0.01, life);
    this.size[index] = size;
    this.peak[index] = peak;
  }

  /**
   * Ages every puff and pushes the live ones into `field`.
   *
   * Dust is *damped and buoyant*: it is thrown out and up, drags to a stop and settles, rather
   * than sailing away in a straight line, which is what makes it read as dust rather than as a
   * rocket.
   */
  emit(field: InstancedPuffs, dt: number): void {
    const step = Math.min(0.1, Math.max(0, dt));
    for (let index = 0; index < this.capacity; index += 1) {
      if (this.age[index] === Number.POSITIVE_INFINITY) continue;
      const age = (this.age[index] as number) + step;
      if (age >= (this.life[index] as number)) {
        this.age[index] = Number.POSITIVE_INFINITY;
        continue;
      }
      this.age[index] = age;

      // A drag towards still, plus a little lift, so a puff puffs out rather than flies.
      const drag = Math.exp(-3.2 * step);
      this.vx[index] = (this.vx[index] as number) * drag;
      this.vz[index] = (this.vz[index] as number) * drag;
      this.vy[index] = ((this.vy[index] as number) + 1.1 * step) * drag;
      this.x[index] = (this.x[index] as number) + (this.vx[index] as number) * step;
      this.y[index] = (this.y[index] as number) + (this.vy[index] as number) * step;
      this.z[index] = (this.z[index] as number) + (this.vz[index] as number) * step;

      const t = age / (this.life[index] as number);
      // Fade in over the first fifth and out over the rest, so nothing ever appears or vanishes
      // abruptly - the same rule the plumes follow.
      const fade = t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8;
      field.push(
        this.x[index] as number,
        this.y[index] as number,
        this.z[index] as number,
        (this.size[index] as number) * (0.6 + t * 1.1),
        (this.peak[index] as number) * Math.max(0, fade),
      );
    }
  }

  /** Kills every puff, for a respawn or a restart. */
  clear(): void {
    this.age.fill(Number.POSITIVE_INFINITY);
    this.next = 0;
  }
}
