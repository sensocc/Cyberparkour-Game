/**
 * Volumetric light shafts: the haze a lamp throws into wet air.
 *
 * **Why this is not a post-process.** A real volumetric pass marches the depth buffer and is a
 * per-pixel cost on every fragment of the frame - the opposite of what a forward renderer with a
 * 240 kB budget should add for atmosphere. A shaft is instead *geometry*: a thin open cone under
 * each high lamp, drawn with additive blending and no depth write, so it brightens what is behind
 * it and occludes nothing. Two dozen of them are one instanced draw call.
 *
 * **Why it reads as light rather than as cones.** Three things:
 *
 *  - the cone is *open* and unlit - its own colour is the lamp's, at a few percent alpha, so what
 *    the eye sees is the lamp's tint over whatever the shaft passes in front of;
 *  - it is *wider at the bottom*, because the light falls off with distance and because a beam
 *    that does not widen reads as a solid object;
 *  - it is *short*. A shaft that reaches the ground from forty metres is a searchlight; one that
 *    fades out after a few metres is the cone of haze under a street lamp, which is what this is.
 *
 * The shafts never cast shadows and are never fogged, which is deliberate: fog is what the shaft is
 * made of, and fogging it would make it vanish exactly where it should be thickest.
 */

import * as THREE from 'three';

import type { ReadonlyVec3 } from '../core/vec3.js';

/** One lamp that gets a shaft. */
export interface ShaftSource {
  readonly position: ReadonlyVec3;
  readonly color: THREE.Color;
  /** How far the lamp carries, in metres; the shaft is a fraction of it. */
  readonly distance: number;
  readonly intensity: number;
}

/**
 * The most shafts drawn at once.
 *
 * Each is one instance of a ten-sided open cone - twenty triangles - so sixty-four shafts are
 * 1,280 triangles in a single draw call. The cap exists to bound the instance buffer, not the
 * fill rate; the fill is what actually costs, and every shaft is thin.
 */
export const MAX_SHAFTS = 64;

/** Below this a lamp is a glow, not a beam: a five-metre bulb has no visible cone. */
const MIN_HEIGHT = 4.5;

/** A lamp dimmer than this is a sign, not a light. */
const MIN_INTENSITY = 6;

export interface VolumetricShafts {
  readonly mesh: THREE.InstancedMesh;
  /** How many instances are actually written. */
  readonly count: number;
  dispose(): void;
}

/**
 * Builds the shafts for the lamps that warrant one.
 *
 * Selection is by **height and brightness**, in that order: a lamp at street level lights the
 * pavement and throws no beam, and a lamp on a sign is a glow rather than a source. What is left -
 * the lamps mounted four and a half metres up or higher, on their posts and brackets - is exactly
 * the set that has air under it to light.
 */
export function buildVolumetricShafts(sources: readonly ShaftSource[]): VolumetricShafts {
  const chosen = sources
    .filter((source) => source.position.y >= MIN_HEIGHT && source.intensity >= MIN_INTENSITY)
    .slice(0, MAX_SHAFTS);

  // An open cone: `openEnded` drops the cap, which would otherwise be a bright disc at the lamp.
  const geometry = new THREE.ConeGeometry(1, 1, 10, 1, true);
  // **The cone's apex is at its top.** `ConeGeometry` is centred with the point up, so shifting it
  // down by half its height puts the apex at the instance origin - which is the lamp - and the
  // skirt hanging under it, which is where the light goes.
  geometry.translate(0, -0.5, 0);

  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    // Additive: a shaft brightens the air it passes through and never darkens anything.
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    // Both faces, because a shaft is seen from inside it as often as from outside.
    side: THREE.DoubleSide,
    opacity: 0.055,
    // **Not fogged.** The shaft *is* haze; fogging it would erase it at exactly the distance where
    // the eye most expects to see it.
    fog: false,
    toneMapped: true,
  });

  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, chosen.length));
  mesh.name = 'light-shafts';
  mesh.count = chosen.length;
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  // A shaft is a decorative layer over the frame: it must never occlude, never cast, and never
  // take part in the shadow pass.
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const rotation = new THREE.Quaternion();

  for (let index = 0; index < chosen.length; index += 1) {
    const source = chosen[index] as ShaftSource;
    // A shaft is a cube-root of the lamp's reach, not its full reach: the light falls off, so the
    // visible part of the beam is the bright core near the lamp. Half the distance is roughly where
    // a lamp's contribution stops being noticeable, and the visible cone is shorter still.
    const length = Math.max(2.5, source.distance * 0.42);
    const radius = Math.max(0.5, source.distance * 0.11);

    position.set(source.position.x, source.position.y, source.position.z);
    scale.set(radius, length, radius);
    matrix.compose(position, rotation, scale);
    mesh.setMatrixAt(index, matrix);
    // The lamp's own colour, so a warm sodium lamp throws a warm shaft and a cold one a cold shaft.
    mesh.setColorAt(index, source.color);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  return {
    mesh,
    count: chosen.length,
    dispose(): void {
      geometry.dispose();
      material.dispose();
      mesh.dispose();
    },
  };
}
