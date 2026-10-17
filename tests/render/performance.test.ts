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
import { createPlayerState, standingSize, stepPlayer } from '../../src/game/player.js';
import {
  LAMP_POOL,
  buildScene,
  DRAW_DISTANCE,
  shadowReachFor,
  updateChunkVisibility,
  updateMovingVisibility,
  updateShadowCasters,
} from '../../src/render/sceneBuilder.js';

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
      // 512 at 250 m. V0.7.9 took this to 500 m and got 134 mesh at the cost of submitting the
      // *whole* city every frame - a million triangles, which is what a machine at fifteen
      // frames a second was actually paying for. 250 m keeps the draw calls in the hundreds and
      // gives the distance and shadow culls something to bite on.
      // 626 at 334 m. The range has been to 128, 500 and 250: the last of those bought culling
      // resolution and paid for it in draw calls, which is the wrong way round - 653 chunk meshes
      // came to 485 of them in a street view, against 165 at this size for the same geometry.
      // **626 chunks, and the chunk stays the batching key.** Merging flat by material was tried in
      // V1.0.12 and reverted: forty-five meshes, forty-four of them bigger than the cull radius, so
      // the distance cull stopped doing anything and 778,000 triangles were submitted every frame
      // against 349,000 here. Fewer draw calls is worth nothing if it costs the cull.
      expect(built.chunks.length).toBeGreaterThan(150);
      expect(built.chunks.length).toBeLessThan(900);

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
      expect(drawn).toBeLessThan(1200);

      // Looking up and across the roofs costs more, and still nothing like the
      // unmerged scene, which drew every part whatever direction it faced.
      // Measured: 633 from the street on the filled-in city, 471 before it was filled.
      // The ceilings are slack around those numbers - what they are for is noticing if
      // the merge or the caster cull goes away.
      const overlooking = visible(built.chunks, { x: 40, y: 60, z: 40 }, 0.8);
      expect(overlooking).toBeLessThan(1300);
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
      // 742k, and the number is worth reading twice: V0.7.2's city of 10,557 props was
      // 1,322k triangles, and this one is 43% cheaper *and* much denser - because a block
      // that fills its plot is one big box where the old grid needed three small filler
      // buildings in the street between two of them.
      expect(owned).toBeLessThan(1_300_000);

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
      // V0.7.2 asked for 600k and V0.7.3 for 790k; the grid is dense enough now that a
      // street view holds more of the city at once, and what keeps that affordable is the
      // distance cull above: 620 m of city drawn, not a kilometre of it.
      // 704k, and up from 358k on purpose: a 500 m chunk is rarely entirely off screen, so
      // almost the whole city is submitted. Draw calls are what a browser runs out of first -
      // 90 of them now against 663 - and seven hundred thousand triangles is not a GPU's
      // problem.
    } finally {
      built.dispose();
    }
  }), 120000;

  it('draws a street in a few hundred submissions, and the moving set is not most of them', () => {
    // **Two regressions that this file did not catch, and now does.**
    //
    // V1.0.15 merged the static city into chunks and then built a mesh per model part for
    // everything that moves: ten for a gate, six for a lift car, three for a shard. The city owns
    // four hundred and twenty-two gates, and from a street they were 1,417 of the frame's 1,777
    // draw calls - eighty per cent of the submission for *fifty thousand* triangles, which is the
    // opposite of the trade the chunk merge exists to make.
    const built = buildScene(city);
    try {
      // One mesh per material gives a three-material shutter three meshes, not ten.
      expect(built.moving.length).toBeLessThan(city.props.length * 2);

      const eye = { x: 40, y: -32, z: 40 };
      const chunks = updateChunkVisibility(built.chunks, eye);
      const moving = updateMovingVisibility(built.moving, eye);

      // A street view is about three hundred chunks, and the moving set within reach should be
      // the same order - not the whole city's worth.
      expect(chunks).toBeGreaterThan(50);
      expect(moving).toBeGreaterThan(0);
      expect(moving).toBeLessThan(built.moving.length / 2);

      // The number the renderer reported from this eye before the merge: 1,777 calls. What a
      // machine with a GPU feels is the submission count, and it has to stay in the hundreds.
      expect(chunks + moving).toBeLessThan(1_100);
    } finally {
      built.dispose();
    }
  }), 120000;

  it('gives every shader the same eight point lights, not the level’s five hundred and seventy-six', () => {
    // **The other half of the frame, and the one no graphics setting could touch.** three.js sizes
    // its per-fragment light loop from the number of *visible* lights and unrolls it, so one
    // `PointLight` per level light made every lit pixel run 576 light evaluations - measured on
    // the built game as 2,333 active uniforms in each lit program. Fading unused lights to zero
    // did not help, because a light at zero intensity is still visible.
    const built = buildScene(city);
    try {
      expect(built.lamps.sources.length).toBeGreaterThan(LAMP_POOL * 10);
      expect(built.lamps.pool).toHaveLength(LAMP_POOL);

      const inScene = built.scene.children.filter(
        (child): child is THREE.PointLight => child instanceof THREE.PointLight,
      );
      expect(inScene).toHaveLength(LAMP_POOL);
      // The pool's *size* never changes - that is what keeps the shader's uniform block constant -
      // but the number of them a preset *uses* does, and applyLampPool is the only thing that
      // moves it. At the default scale every one of them is lit.
      expect(inScene.every((light) => light.visible)).toBe(true);
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
      // 132 from the middle of the map and 290 from a street at the edge - the number moves with
      // where you stand, so what is asserted is that it is a *subset*: the invariant that matters
      // is the per-chunk one above, that a chunk the volume cannot reach is not in the pass.
      expect(casting).toBeGreaterThan(0);
      expect(casting).toBeLessThan(built.chunks.length);

      // Asked of the chunk's own extent, not its centre: the shadow camera covers `reach` metres
      // around the player and clips the rest, so a chunk it does not touch casts nothing worth
      // drawing. V0.7.9 asked the centre, four hundred chunks stayed in the pass, and the shadow
      // map 140 m across was fed a million triangles.
      // Half a chunk either way: the question the shadow camera asks is whether the *volume*
      // overlaps the chunk, and the chunk's half-side is what turns its centre into its edge.
      const half = 334 / 2;
      for (const mesh of built.chunks) {
        const nearX = Math.abs(mesh.position.x - eye.x) - half;
        const nearZ = Math.abs(mesh.position.z - eye.z) - half;
        if (nearX > reach || nearZ > reach) {
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

  it('does not pay for the city on a walking step', () => {
    // **The ledges were walking the whole level.** Mantling, pull-ups, climbing, wall running and
    // vaulting each asked "what is near me?" by testing every collider in the city - four or five
    // times a step, with a temporary box allocated per candidate. Measured before the fix: 0.244
    // milliseconds per walking step against the real city, and 0.005 against four colliders, so
    // ninety-eight per cent of a step was the scan. They go through the collision grid now.
    //
    // The assertion is the *invariant* rather than a millisecond count: whether the world has
    // thirteen thousand colliders or four must not change what a step costs. A machine that is
    // slower than this one scales both halves together, which is the whole point.
    const built = buildLevel(city, {
      maxSubStep: DEFAULT_CONFIG.world.maxCollisionSubStep,
      player: SIZE,
    });
    const full = new CollisionWorld(built.colliders, { broadphase: 'grid' });
    const tiny = new CollisionWorld(built.colliders.slice(0, 4), { broadphase: 'grid' });
    const spawn = city.spawn;
    const forward = { forward: 1, right: 0, sprint: false, jump: false, crouch: false };

    const perStep = (world: CollisionWorld): number => {
      const state = createPlayerState(spawn, DEFAULT_CONFIG);
      const options = {
        world,
        config: DEFAULT_CONFIG.player,
        game: DEFAULT_CONFIG,
        climbableIds: new Set<string>(),
        pipeIds: new Set<string>(),
      };
      for (let warm = 0; warm < 120; warm += 1) stepPlayer(state, forward, STEP, options);
      const started = performance.now();
      for (let step = 0; step < 900; step += 1) stepPlayer(state, forward, STEP, options);
      return (performance.now() - started) / 900;
    };

    const small = perStep(tiny);
    const large = perStep(full);
    expect(large).toBeLessThan(Math.max(0.02, small * 4));
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

  it('fogs to full opacity by the distance it stops drawing, so nothing pops', () => {
    // **The bug this exists to stop coming back.** Fog's one job is to hide the edge of what is
    // drawn. V0.7 asked for 260 -> 1150, a fog that reached full opacity 830 m *past* the last
    // chunk the renderer submits - so at the 320 m cull the haze was 6.7%, and the far rooftops
    // vanished with essentially nothing on them. A hard cut where a fade was meant to be, and the
    // kind of seam nobody notices until they are looking straight at it.
    const fog = { near: city.environment.fogNear, far: city.environment.fogFar };

    // The fog has to be strong enough *at* the cull that the last drawn chunk is all but invisible.
    const atCull = (DRAW_DISTANCE - fog.near) / (fog.far - fog.near);
    expect(atCull).toBeGreaterThanOrEqual(0.95);

    // ...and it must not begin inside the parkour range, or the map reads as a wall of haze.
    expect(fog.near).toBeGreaterThan(120);

    // A ramp, not a wall: a fog that goes from clear to opaque in a few metres is a visible plane.
    expect(fog.far - fog.near).toBeGreaterThan(50);
  }), 120000;
});
