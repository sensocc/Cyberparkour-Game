/**
 * Volumetric light shafts.
 *
 * These are geometry rather than a post pass, so they are testable without a renderer: what has to
 * hold is that the right lamps get a shaft, the shaft hangs *under* its lamp, and the layer is
 * bounded by one draw call.
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { buildVolumetricShafts, MAX_SHAFTS, type ShaftSource } from '../../src/render/volumetrics.js';

function lamp(
  y: number,
  intensity = 11,
  distance = 26,
  colour = '#ffd9a3',
): ShaftSource {
  return {
    position: { x: 0, y, z: 0 },
    color: new THREE.Color(colour),
    intensity,
    distance,
  };
}

describe('the shafts under the lamps', () => {
  it('gives a shaft to a high lamp and none to a street-level one', () => {
    // **Height is the question, not brightness.** A lamp at street level lights the pavement and
    // throws no visible beam; the beam is what you see when the lamp is up on its post.
    const shafts = buildVolumetricShafts([lamp(6), lamp(2)]);
    try {
      expect(shafts.count).toBe(1);
    } finally {
      shafts.dispose();
    }
  });

  it('gives no shaft to something dim enough to be a sign', () => {
    const shafts = buildVolumetricShafts([lamp(6, 2)]);
    try {
      expect(shafts.count).toBe(0);
    } finally {
      shafts.dispose();
    }
  });

  it('hangs every shaft below its lamp, and widens it away from the source', () => {
    // The cone's apex sits at the instance origin, so the skirt falls *down* from the lamp. That
    // is the whole geometry of a beam, and getting it upside down would put the light in the sky.
    const shafts = buildVolumetricShafts([lamp(8, 12, 30)]);
    try {
      const matrix = new THREE.Matrix4();
      shafts.mesh.getMatrixAt(0, matrix);
      const position = new THREE.Vector3();
      const quaternion = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      matrix.decompose(position, quaternion, scale);

      expect(position.y).toBeCloseTo(8, 6);
      // The cone is a unit cone scaled: height on Y, radius on the other two axes.
      expect(scale.y).toBeGreaterThan(0);
      expect(scale.x).toBeCloseTo(scale.z, 6);
      // ...and it is narrower than it is tall, or it would be a disc rather than a beam.
      expect(scale.y).toBeGreaterThan(scale.x);

      // The geometry's own apex is at the top: the unit cone is translated down by half its
      // height, so its highest vertex lands at the origin the matrix places the instance at.
      const geometry = shafts.mesh.geometry;
      geometry.computeBoundingBox();
      const box = geometry.boundingBox!;
      expect(box.max.y).toBeCloseTo(0, 6);
      expect(box.min.y).toBeCloseTo(-1, 6);
    } finally {
      shafts.dispose();
    }
  });

  it('takes the lamp colour, so a warm lamp throws a warm beam', () => {
    const shafts = buildVolumetricShafts([lamp(8, 12, 30, '#ff8844')]);
    try {
      const colour = new THREE.Color();
      shafts.mesh.getColorAt(0, colour);
      expect(colour.r).toBeGreaterThan(colour.b);
    } finally {
      shafts.dispose();
    }
  });

  it('is one draw call whatever the number of lamps, and is capped', () => {
    // The reason this is geometry: sixty shafts are still one submission. The cap bounds the
    // instance buffer; it is not a fill-rate budget.
    const many = Array.from({ length: MAX_SHAFTS + 40 }, () => lamp(9));
    const shafts = buildVolumetricShafts(many);
    try {
      expect(shafts.count).toBe(MAX_SHAFTS);
      expect(shafts.mesh.isInstancedMesh).toBe(true);
      // A decorative layer never casts and never receives: it must not appear in the shadow pass.
      expect(shafts.mesh.castShadow).toBe(false);
      expect(shafts.mesh.receiveShadow).toBe(false);
    } finally {
      shafts.dispose();
    }
  });

  it('is additive and writes no depth, so it brightens air without hiding the city', () => {
    const shafts = buildVolumetricShafts([lamp(8)]);
    try {
      const material = shafts.mesh.material as THREE.MeshBasicMaterial;
      expect(material.blending).toBe(THREE.AdditiveBlending);
      expect(material.depthWrite).toBe(false);
      expect(material.transparent).toBe(true);
      // The shaft *is* haze: fogging it would erase it where it should be thickest.
      expect(material.fog).toBe(false);
    } finally {
      shafts.dispose();
    }
  });

  it('builds no mesh at all from an empty or unsuitable list', () => {
    const shafts = buildVolumetricShafts([]);
    try {
      expect(shafts.count).toBe(0);
      expect(shafts.mesh.count).toBe(0);
    } finally {
      shafts.dispose();
    }
  });
});
