/**
 * Measures the imported model files, so the level's declared sizes can be checked against them.
 *
 * **Why this exists.** `DRESSING` in the generator declares a box for every imported prop - the
 * space it occupies, which placement uses to decide whether furniture fits. There is no reason a
 * hand-maintained table should agree with art that gets replaced, and it did not: four models are
 * taller than their declared height (`antenna-1` by 1.07 m, `street-light` by 0.90), sixteen are
 * shorter by up to 0.45 m, and four put their geometry *below* their own origin - which is what
 * buried `cable-small` 2.84 m under the roofs it stands on.
 *
 * This reads the glTF/GLB directly: node transforms plus each primitive's `POSITION` accessor
 * `min`/`max`, transformed and unioned. No three.js, no DOM, so the test suite and the CLI share
 * one implementation.
 *
 * Written for Node's native TypeScript stripping (Node >= 22.18), which is why there are no
 * parameter properties or enums here.
 */

import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

export interface ModelBounds {
  /** Lowest and highest point of the model, in its own units, as authored. */
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
  /** Extent on each axis, in its own units. Multiply by the instance scale for metres. */
  readonly size: readonly [number, number, number];
}

interface GltfNode {
  readonly name?: string;
  readonly mesh?: number;
  readonly children?: readonly number[];
  readonly matrix?: readonly number[];
  readonly translation?: readonly [number, number, number];
  readonly rotation?: readonly [number, number, number, number];
  readonly scale?: readonly [number, number, number];
}

interface GltfAccessor {
  readonly min?: readonly [number, number, number];
  readonly max?: readonly [number, number, number];
}

interface GltfJson {
  readonly scene?: number;
  readonly scenes?: readonly { readonly nodes?: readonly number[] }[];
  readonly nodes?: readonly GltfNode[];
  readonly meshes?: readonly { readonly primitives?: readonly { readonly attributes?: { readonly POSITION?: number } }[] }[];
  readonly accessors?: readonly GltfAccessor[];
}

/** Column-major 4x4, the same layout glTF and three.js use. */
type Mat4 = readonly number[];

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function multiply(a: Mat4, b: Mat4): number[] {
  const out = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += (a[k * 4 + row] as number) * (b[column * 4 + k] as number);
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

/** The node's local matrix: its own `matrix`, or translation/rotation/scale composed. */
function localMatrix(node: GltfNode): Mat4 {
  if (node.matrix) return node.matrix;
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];

  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;

  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

/** Reads a `.gltf` (JSON) or `.glb` (binary container) into its JSON. */
function parseModelJson(path: string): GltfJson {
  const buffer = readFileSync(path);
  const isGlb = extname(path).toLowerCase() === '.glb' || buffer.readUInt32LE(0) === 0x46546c67;
  if (!isGlb) return JSON.parse(buffer.toString('utf8')) as GltfJson;
  // GLB: a 12-byte header, then chunks of (length, type, data); chunk 0 is the JSON.
  const jsonLength = buffer.readUInt32LE(12);
  return JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8')) as GltfJson;
}

/**
 * The axis-aligned bounds of a model file, in its own units.
 *
 * Every primitive's local box is transformed by its node's world matrix and unioned. Transforming
 * the eight corners rather than the min/max pair is what makes a rotated node come out right.
 */
export function readModelBounds(path: string): ModelBounds {
  const json = parseModelJson(path);
  const nodes = json.nodes ?? [];
  const meshes = json.meshes ?? [];
  const accessors = json.accessors ?? [];

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  const visit = (index: number, parent: Mat4): void => {
    const node = nodes[index];
    if (!node) return;
    const world = multiply(parent, localMatrix(node));

    if (node.mesh !== undefined) {
      for (const primitive of meshes[node.mesh]?.primitives ?? []) {
        const accessor = accessors[primitive.attributes?.POSITION as number];
        if (!accessor?.min || !accessor.max) continue;
        const [ax, ay, az] = accessor.min;
        const [bx, by, bz] = accessor.max;
        for (const [cx, cy, cz] of [
          [ax, ay, az], [bx, ay, az], [ax, by, az], [bx, by, az],
          [ax, ay, bz], [bx, ay, bz], [ax, by, bz], [bx, by, bz],
        ] as const) {
          const wx = (world[0] as number) * cx + (world[4] as number) * cy + (world[8] as number) * cz + (world[12] as number);
          const wy = (world[1] as number) * cx + (world[5] as number) * cy + (world[9] as number) * cz + (world[13] as number);
          const wz = (world[2] as number) * cx + (world[6] as number) * cy + (world[10] as number) * cz + (world[14] as number);
          if (wx < minX) minX = wx;
          if (wx > maxX) maxX = wx;
          if (wy < minY) minY = wy;
          if (wy > maxY) maxY = wy;
          if (wz < minZ) minZ = wz;
          if (wz > maxZ) maxZ = wz;
        }
      }
    }

    for (const child of node.children ?? []) visit(child, world);
  };

  for (const root of json.scenes?.[json.scene ?? 0]?.nodes ?? []) visit(root, IDENTITY);

  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    size: [maxX - minX, maxY - minY, maxZ - minZ],
  };
}

/** Rounds to `places`, so a declared table and a measurement compare cleanly. */
export function roundTo(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
