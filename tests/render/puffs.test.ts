/**
 * Batched puffs.
 *
 * The whole point of this file is that many puffs are one draw call, so what is worth testing is
 * that the batching *works* - that every puff lands in the buffer, that the buffers are reused
 * rather than reallocated, and above all that the shader patch actually applied. A patch that
 * silently fails to compile renders nothing at all, which is the hardest kind of bug to notice.
 */

import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

import { InstancedPuffs, MAX_PUFFS, PuffPool, patchPuffMaterial } from '../../src/render/puffs.js';

describe('the shader patch', () => {
  it('adds billboarding and per-instance opacity to the material', () => {
    const material = new THREE.MeshBasicMaterial();
    patchPuffMaterial(material);
    expect(material.onBeforeCompile).toBeTypeOf('function');

    // Stand-ins for the two strings three.js hands `onBeforeCompile`, with the `#include` anchors
    // the real shaders carry.
    const shader = {
      vertexShader: '#include <begin_vertex>\n#include <project_vertex>',
      fragmentShader: '#include <map_fragment>',
    };
    (material.onBeforeCompile as (value: typeof shader) => void)(shader);

    // The instance matrix has to be *read* rather than used as the model transform, or the quads
    // would be flat and world-rotated instead of facing the camera.
    expect(shader.vertexShader).toContain('instanceMatrix');
    expect(shader.vertexShader).toContain('mvPosition.xy += position.xy * puffSize');
    // ...and the camera-facing rebuild means the ordinary project_vertex is gone, not doubled up.
    expect(shader.vertexShader).not.toContain('#include <project_vertex>');
    expect(shader.vertexShader).toContain('vPuffOpacity = aPuffOpacity');

    expect(shader.fragmentShader).toContain('diffuseColor.a *= vPuffOpacity');
    // The map include is still there - the patch appends rather than replaces.
    expect(shader.fragmentShader).toContain('#include <map_fragment>');
  });

  it('gives the material its own program cache key', () => {
    // Two materials that differ only in their patch must not share a compiled program.
    const material = new THREE.MeshBasicMaterial();
    patchPuffMaterial(material);
    expect(material.customProgramCacheKey()).toBe('puff-billboard-v1');
  });
});

describe('one draw, many puffs', () => {
  const texture = new THREE.Texture();

  it('is a single instanced mesh, whatever the puff count', () => {
    const field = new InstancedPuffs(texture, 64);
    try {
      expect(field.mesh).toBeInstanceOf(THREE.InstancedMesh);
      expect(field.capacity).toBe(64);
      // Nothing is drawn until something is committed.
      expect(field.mesh.count).toBe(0);
    } finally {
      field.dispose();
    }
  });

  it('writes each puff into the instance buffer and nothing else', () => {
    const field = new InstancedPuffs(texture, 4);
    try {
      field.begin();
      field.push({ x: 10, y: 2, z: -3, scale: 1.5, opacity: 0.5 });
      field.push({ x: -1, y: 0, z: 7, scale: 2, opacity: 0.25 });
      field.commit();

      expect(field.live).toBe(2);
      expect(field.mesh.count).toBe(2);

      const m = field.mesh.instanceMatrix.array;
      // Column-major: a uniform scale on the diagonal, the translation in the last column.
      expect(m[0]).toBeCloseTo(1.5, 6);
      expect(m[5]).toBeCloseTo(1.5, 6);
      expect(m[10]).toBeCloseTo(1.5, 6);
      expect(m[12]).toBeCloseTo(10, 6);
      expect(m[13]).toBeCloseTo(2, 6);
      expect(m[14]).toBeCloseTo(-3, 6);
      expect(m[15]).toBe(1);

      const opacity = field.mesh.geometry.getAttribute('aPuffOpacity');
      expect(opacity.getX(0)).toBeCloseTo(0.5, 6);
      expect(opacity.getX(1)).toBeCloseTo(0.25, 6);
    } finally {
      field.dispose();
    }
  });

  it('reuses its buffers frame to frame, so a frame allocates nothing', () => {
    const field = new InstancedPuffs(texture, 8);
    try {
      field.begin();
      field.push({ x: 1, y: 0, z: 0, scale: 1, opacity: 1 });
      field.commit();
      const firstMatrix = field.mesh.instanceMatrix.array;
      const firstOpacity = field.mesh.geometry.getAttribute('aPuffOpacity');

      for (let frame = 0; frame < 5; frame += 1) {
        field.begin();
        field.push({ x: frame, y: 0, z: 0, scale: 1, opacity: 1 });
        field.commit();
      }

      expect(field.mesh.instanceMatrix.array).toBe(firstMatrix);
      expect(field.mesh.geometry.getAttribute('aPuffOpacity')).toBe(firstOpacity);
    } finally {
      field.dispose();
    }
  });

  it('refuses to overrun its capacity rather than writing past the buffer', () => {
    const field = new InstancedPuffs(texture, 2);
    try {
      field.begin();
      for (let index = 0; index < 10; index += 1) {
        field.push({ x: index, y: 0, z: 0, scale: 1, opacity: 1 });
      }
      field.commit();
      expect(field.live).toBe(2);
      expect(field.mesh.count).toBe(2);
    } finally {
      field.dispose();
    }
  });

  it('treats a non-finite sample as nothing rather than as a NaN matrix', () => {
    // A NaN in an instance matrix makes WebGL draw nothing at all, and it is poison that spreads:
    // every subsequent frame draws nothing either.
    const field = new InstancedPuffs(texture, 2);
    try {
      field.begin();
      field.push({ x: Number.NaN, y: 0, z: 0, scale: Number.POSITIVE_INFINITY, opacity: Number.NaN });
      field.commit();

      const m = field.mesh.instanceMatrix.array;
      for (let index = 0; index < 16; index += 1) expect(Number.isFinite(m[index])).toBe(true);
      expect(field.mesh.geometry.getAttribute('aPuffOpacity').getX(0)).toBe(0);
    } finally {
      field.dispose();
    }
  });
});

describe('a pool of short-lived puffs', () => {
  const texture = new THREE.Texture();

  function emptyField(capacity = 32): InstancedPuffs {
    return new InstancedPuffs(texture, capacity);
  }

  it('draws nothing until something is spawned', () => {
    const field = emptyField();
    try {
      field.begin();
      new PuffPool(8).emit(field, 1 / 60);
      expect(field.live).toBe(0);
    } finally {
      field.dispose();
    }
  });

  it('fades a puff in and out rather than popping it', () => {
    // A burst that appears at full opacity is a flash; the fade is what makes it read as dust.
    const field = emptyField();
    const pool = new PuffPool(4);
    try {
      pool.spawn(0, 0, 0, 0, 0, 0, 1, 1, 1);

      const opacities: number[] = [];
      for (let frame = 0; frame < 60; frame += 1) {
        field.begin();
        pool.emit(field, 1 / 60);
        const attribute = field.mesh.geometry.getAttribute('aPuffOpacity');
        opacities.push(field.live === 0 ? 0 : attribute.getX(0));
        field.commit();
      }

      const peak = Math.max(...opacities);
      expect(peak).toBeLessThanOrEqual(1);
      // It starts dark, gets brighter, then dies - never a step from 0 to peak in one frame.
      expect(opacities[0] as number).toBeLessThan(peak * 0.5);
      const step = opacities[1] as number - (opacities[0] as number);
      expect(step).toBeLessThan(peak * 0.6);
      // Faded to nothing by the end of its life. Not exactly zero: accumulating sixty steps of
      // 1/60 s lands a hair under the lifetime, so the last live frame is at ~1e-7 - which is the
      // fade working, not the fade failing.
      expect(opacities[opacities.length - 1] as number).toBeLessThan(0.001);
    } finally {
      field.dispose();
    }
  });

  it('recycles its oldest puff when the pool is full, rather than growing', () => {
    const field = emptyField();
    const pool = new PuffPool(3);
    try {
      for (let index = 0; index < 20; index += 1) {
        pool.spawn(index, 0, 0, 0, 0, 0, 10, 1, 1);
      }
      field.begin();
      pool.emit(field, 1 / 60);
      // Three slots, so three puffs - not twenty.
      expect(field.live).toBe(3);
    } finally {
      field.dispose();
    }
  });

  it('is emptied by `clear`, so a respawn does not leave dust hanging', () => {
    const field = emptyField();
    const pool = new PuffPool(4);
    try {
      pool.spawn(0, 0, 0, 0, 0, 0, 10, 1, 1);
      pool.clear();
      field.begin();
      pool.emit(field, 1 / 60);
      expect(field.live).toBe(0);
    } finally {
      field.dispose();
    }
  });

  it('ages by the delta it is given, so a paused game freezes its dust', () => {
    // `dt` of zero must not advance a puff: the call site passes *simulated* time precisely so
    // that dust stops with the game rather than drifting on behind the pause menu.
    const field = emptyField();
    const pool = new PuffPool(4);
    try {
      pool.spawn(0, 0, 0, 0, 0, 0, 1, 1, 1);
      field.begin();
      pool.emit(field, 0);
      const before = field.mesh.geometry.getAttribute('aPuffOpacity').getX(0);

      for (let frame = 0; frame < 10; frame += 1) {
        field.begin();
        pool.emit(field, 0);
      }
      const after = field.mesh.geometry.getAttribute('aPuffOpacity').getX(0);
      expect(after).toBeCloseTo(before, 6);
    } finally {
      field.dispose();
    }
  });
});

describe('disposal', () => {
  it('frees its buffer and material, and is safe to call twice', () => {
    const field = new InstancedPuffs(new THREE.Texture(), 4);
    const geometry = field.mesh.geometry;
    const material = field.mesh.material as THREE.Material;
    const geometrySpy = vi.spyOn(geometry, 'dispose');
    const materialSpy = vi.spyOn(material, 'dispose');

    field.dispose();
    field.dispose();

    expect(geometrySpy).toHaveBeenCalledTimes(1);
    expect(materialSpy).toHaveBeenCalledTimes(1);
  });

  it('leaves the field inert after disposal rather than committing into freed buffers', () => {
    const field = new InstancedPuffs(new THREE.Texture(), 4);
    field.dispose();
    expect(() => field.commit()).not.toThrow();
  });
});

describe('the ceiling', () => {
  it('is large enough for the city and the dust at once', () => {
    // The city's steam plus a landing's dust share this buffer; a burst must never be the thing
    // that overflows it.
    expect(MAX_PUFFS).toBeGreaterThanOrEqual(256);
  });
});
