/**
 * What V0.7.1 is for, measured.
 *
 * A frame is two things: what the CPU asks the GPU to draw, and what the simulation
 * does between frames. Both were sized for the district and then asked to carry a
 * city, and both are measured here rather than argued about.
 *
 * Deliberately *not* here: a frames-per-second number. This machine has no GPU
 * worth the name, and a software rasteriser's frame rate says more about the
 * rasteriser than about the game. The counts below are the ones that transfer - the
 * draw calls a frame asks for, and the milliseconds the physics spends between
 * them - and they are what a machine with a GPU will feel.
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { buildCity } from '../../src/game/level/city.js';
import { DEMO_DISTRICT } from '../../src/game/level/levelData.js';
import { buildLevel } from '../../src/game/level/level.js';
import { CollisionWorld } from '../../src/game/physics/collision.js';
import { aabbFromFeet } from '../../src/game/physics/aabb.js';
import { DEFAULT_CONFIG, fixedStep } from '../../src/core/config.js';
import { standingSize } from '../../src/game/player.js';
import { buildScene, shadowReachFor, updateShadowCasters } from '../../src/render/sceneBuilder.js';

const SIZE = standingSize(DEFAULT_CONFIG.player);
const STEP = fixedStep(DEFAULT_CONFIG);

/**
 * What a camera at `eye`, looking along `yaw`, would ask the renderer to draw.
 *
 * three.js culls per mesh by bounding sphere, so this is the same arithmetic it
 * does - one sphere test per chunk instead of one draw per chunk - which is why a
 * merged, chunked scene is worth having even when every chunk is in front of you.
 */
function visible(
  chunks: readonly THREE.Mesh[],
  eye: { x: number; y: number; z: number },
  yaw: number,
): number {
  const camera = new THREE.PerspectiveCamera(82, 16 / 9, 0.05, 1200);
  camera.position.set(eye.x, eye.y, eye.z);
  camera.rotation.order = 'YXZ';
  camera.rotation.set(0, yaw, 0);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();

  const frustum = new THREE.Frustum().setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  );
  let drawn = 0;
  for (const mesh of chunks) {
    const sphere = mesh.geometry.boundingSphere;
    if (!sphere) continue;
    const centre = sphere.center.clone().add(mesh.position);
    if (frustum.intersectsSphere(new THREE.Sphere(centre, sphere.radius))) drawn += 1;
  }
  return drawn;
}

describe('the cost of a frame', () => {
  const city = buildCity(DEMO_DISTRICT);

  it('builds the city in a few hundred milliseconds and a thousand chunks', () => {
    const started = performance.now();
    const built = buildScene(city);
    const elapsed = performance.now() - started;
    try {
      // One mesh per part was 41,915 meshes. Merged by chunk and material it is
      // about 1,100, which is the difference between a frame the browser can
      // submit and one it cannot.
      expect(built.chunks.length).toBeGreaterThan(500);
      expect(built.chunks.length).toBeLessThan(3500);

      const parts = city.props.length;
      expect(built.chunks.length).toBeLessThan(parts / 3);

      // The build is on the critical path of a restart, so it is worth a ceiling of
      // its own - and it is *faster* than the unmerged build it replaces, because the
      // scene graph it fills has two thousand children instead of forty. Loose
      // enough not to be a benchmark of the machine running it: this is here to
      // catch the merge going away, not a slow afternoon.
      expect(elapsed).toBeLessThan(8000);
    } finally {
      built.dispose();
    }
  }), 120000;

  it('asks for a few hundred draw calls from a street, not forty thousand', () => {
    const built = buildScene(city);
    try {
      // On a street in the middle of the city, looking along it: the worst case is
      // a rooftop looking out over everything, and this is the common case.
      const drawn = visible(built.chunks, { x: 40, y: -32, z: 40 }, 0);
      expect(drawn).toBeLessThan(900);

      // Looking up and across the roofs costs more, and still nothing like the
      // unmerged scene, which drew every part whatever direction it faced.
      // Measured: 633 from the street on the filled-in city, 471 before it was filled.
      // The ceilings are slack around those numbers - what they are for is noticing if
      // the merge or the caster cull goes away.
      const overlooking = visible(built.chunks, { x: 40, y: 60, z: 40 }, 0.8);
      expect(overlooking).toBeLessThan(1000);
      expect(overlooking).toBeGreaterThan(0);

      // Behind the camera is not drawn at all, which is the property that merging
      // by chunk rather than by material had to preserve.
      const half = visible(built.chunks, { x: 40, y: -32, z: 40 }, 0);
      const other = visible(built.chunks, { x: 40, y: -32, z: 40 }, Math.PI);
      expect(half + other).toBeLessThan(built.chunks.length * 1.6);
    } finally {
      built.dispose();
    }
  }), 120000;

  it('draws about a tenth of the city it owns, because most of it is behind you', () => {
    // V0.7.1's number was 471 draw calls and about 400k triangles for 5,233 props. V0.7.2
    // fills the streets - 12,127 props, 111,123 parts - and asks for 633 draw calls and
    // 600k *visible* triangles to draw them: a frame that costs half again as much for a
    // city two and a half times the size, which is the point. What must not happen is the
    // frame growing with the city rather than with what is in front of the player, so the
    // triangle count here is the frustum-culled one.
    const built = buildScene(city);
    try {
      // All of it.
      let owned = 0;
      for (const mesh of built.chunks) {
        owned += (mesh.geometry.getIndex()?.count ?? 0) / 3;
      }
      expect(owned).toBeGreaterThan(1_000_000);

      // What a frame actually submits, from a street in the middle of it all.
      const camera = new THREE.PerspectiveCamera(82, 16 / 9, 0.05, 1200);
      camera.position.set(40, -32, 40);
      camera.updateMatrixWorld();
      camera.updateProjectionMatrix();
      const frustum = new THREE.Frustum().setFromProjectionMatrix(
        new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
      );
      let visible = 0;
      for (const mesh of built.chunks) {
        const sphere = mesh.geometry.boundingSphere;
        if (!sphere) continue;
        if (frustum.intersectsSphere(new THREE.Sphere(sphere.center.clone().add(mesh.position), sphere.radius))) {
          visible += (mesh.geometry.getIndex()?.count ?? 0) / 3;
        }
      }
      expect(visible).toBeGreaterThan(200_000);
      expect(visible).toBeLessThan(800_000);
      expect(visible).toBeLessThan(owned * 0.7);
    } finally {
      built.dispose();
    }
  }), 120000;

  it('casts shadows from the chunks the shadow map can see, and no others', () => {
    const built = buildScene(city);
    try {
      const reach = shadowReachFor(built.sun.shadow.camera.right);
      const eye = { x: 40, y: -32, z: 40 };
      const casting = updateShadowCasters(built.chunks, eye, reach);

      // A shadow map 220 m across has no use for a chunk 400 m away: it would be
      // clipped, but only after its vertices were transformed. A handful of chunks
      // is a shadow pass of a handful of draw calls.
      expect(casting).toBeGreaterThan(0);
      expect(casting).toBeLessThan(520);

      for (const mesh of built.chunks) {
        if (Math.abs(mesh.position.x - eye.x) > reach || Math.abs(mesh.position.z - eye.z) > reach) {
          expect(mesh.castShadow, mesh.name).toBe(false);
        }
      }

      // Moving the eye brings a different set in, and never makes a non-caster cast:
      // a prop's own flag is the authority.
      const elsewhere = updateShadowCasters(built.chunks, { x: 400, y: -32, z: -400 }, reach);
      expect(elsewhere).toBeGreaterThan(0);
      for (const mesh of built.chunks) {
        if (mesh.userData.castsChunk !== true) expect(mesh.castShadow).toBe(false);
      }
    } finally {
      built.dispose();
    }
  }), 120000;

  it('spends about a millisecond of physics on a second of falling', () => {
    const built = buildLevel(city, {
      maxSubStep: DEFAULT_CONFIG.world.maxCollisionSubStep,
      player: SIZE,
    });
    const world = new CollisionWorld(built.colliders, { broadphase: 'grid' });
    const box = aabbFromFeet({ x: 40, y: 60, z: 40 }, SIZE.radius, SIZE.height);
    const velocity = { x: 0, y: 0, z: 0 };

    const started = performance.now();
    for (let step = 0; step < 600; step += 1) {
      box.min.y = 60;
      box.max.y = 60 + SIZE.height;
      velocity.y = -26;
      world.move(box, { x: 0.1, y: -STEP, z: 0 }, velocity);
    }
    const elapsed = performance.now() - started;

    // Ten seconds of the worst case the game has - a terminal-velocity fall through
    // the city, which sub-steps repeatedly on every axis - in well under a tenth of
    // a second. The scan this replaces needed most of a second for the same work.
    expect(elapsed).toBeLessThan(120);
  }), 120000;
});
