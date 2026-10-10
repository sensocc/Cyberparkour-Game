/**
 * Scene construction.
 *
 * three.js scene objects are pure JavaScript - only `WebGLRenderer` needs a GPU -
 * so the whole scene graph is testable in Node. That covers the two things most
 * likely to break silently: the sky/backdrop wiring and resource disposal.
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { buildScene } from '../../src/render/sceneBuilder.js';
import { NO_ASSETS, type SceneAssets } from '../../src/render/types.js';
import { DEMO_DISTRICT, type LevelDefinition } from '../../src/game/level/levelData.js';
import { surfaceTextureIds } from '../../src/game/level/surfaces.js';
import { isMountedModel } from '../../src/game/level/models.js';
import { isElevatorGateOf, resolvePropParts } from '../../src/game/level/level.js';
import { buildCity } from '../../src/game/level/city.js';
import type { PropDefinition } from '../../src/game/level/levelData.js';

function assetTextures(): SceneAssets {
  return {
    cityBackdrop: new THREE.Texture(),
    skybox: new THREE.CubeTexture(),
    surfaces: new Map(surfaceTextureIds().map((id) => [id, new THREE.Texture()])),
    smoke: new THREE.Texture(),
  };
}

/**
 * What a prop was drawn as: how many parts, and with which materials.
 *
 * V0.7.1 merges the static parts into per-chunk buffers, so there is no mesh per
 * prop any more. The parts are still countable and the materials still shared,
 * which is what these tests are about.
 */
function partsOf(
  built: ReturnType<typeof buildScene>,
  id: string,
): { readonly count: number; readonly materials: readonly THREE.Material[] } {
  const parts = built.parts.get(id);
  expect(parts, `expected parts for ${id}`).toBeDefined();
  return parts as { readonly count: number; readonly materials: readonly THREE.Material[] };
}

/** The first material a prop was drawn with, which is its main mass. */
function materialOf(built: ReturnType<typeof buildScene>, id: string): THREE.MeshLambertMaterial {
  const [first] = partsOf(built, id).materials;
  expect(first, `expected a material for ${id}`).toBeDefined();
  return first as THREE.MeshLambertMaterial;
}

/**
 * A level holding only the props named.
 *
 * The merged buffers are per chunk, so a prop in a full level shares its geometry
 * with everything around it and its own vertices cannot be picked out. A level of
 * one prop makes the chunk that prop's, and its geometry exactly that prop's -
 * which is how the world-space assertions below stay meaningful after the merge.
 */
function onlyLevel(...props: readonly PropDefinition[]): LevelDefinition {
  return { ...DEMO_DISTRICT, props, doors: [], elevators: [], collectibles: [], smoke: [], lights: [] };
}

/**
 * World-space bounds of every merged buffer, as drawn.
 *
 * Every chunk, not just the first: a prop is split by *material* as well as by
 * position, so one prop can be several buffers and the union is the honest answer
 * to "where is it".
 */
function boundsOf(built: ReturnType<typeof buildScene>): { min: THREE.Vector3; max: THREE.Vector3 } {
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (const mesh of built.chunks) {
    const position = mesh.geometry.getAttribute('position');
    for (let index = 0; index < position.count; index += 1) {
      min.x = Math.min(min.x, position.getX(index) + mesh.position.x);
      min.y = Math.min(min.y, position.getY(index) + mesh.position.y);
      min.z = Math.min(min.z, position.getZ(index) + mesh.position.z);
      max.x = Math.max(max.x, position.getX(index) + mesh.position.x);
      max.y = Math.max(max.y, position.getY(index) + mesh.position.y);
      max.z = Math.max(max.z, position.getZ(index) + mesh.position.z);
    }
  }
  return { min, max };
}

/** Every merged vertex, so a prop split across buffers can still be counted. */
function verticesOf(built: ReturnType<typeof buildScene>): { readonly count: number }[] {
  return built.chunks.map((mesh) => mesh.geometry.getAttribute('position'));
}

/** Every vertex count in the merged buffers, in parts. */
function mergedParts(built: ReturnType<typeof buildScene>): number {
  return built.chunks.reduce(
    (total, mesh) => total + mesh.geometry.getAttribute('position').count / 24,
    0,
  );
}

describe('buildScene geometry', () => {
  it('counts every model part of every prop, and drops none of them', () => {
    const built = buildScene(DEMO_DISTRICT);
    try {
      // Gates are drawn as sliding groups rather than merged, which is the one
      // exception - and the reason V0.7.1 has a test of its own for them.
      const merged = DEMO_DISTRICT.props.filter((prop) => built.parts.get(prop.id) !== undefined);
      expect(merged.length).toBeGreaterThan(0);

      // V0.2's whole point: props are models, so most of them are several parts.
      const multiPart = merged.filter((prop) => partsOf(built, prop.id).count > 1);
      expect(multiPart.length).toBeGreaterThan(merged.length / 2);

      // Every part that was counted is in a buffer: a merged mesh holds exactly 24
      // vertices per part - a box, and the box the shared cache handed out - so
      // nothing was dropped on the way in.
      const counted = merged.reduce((total, prop) => total + partsOf(built, prop.id).count, 0);
      expect(mergedParts(built)).toBe(counted);
    } finally {
      built.dispose();
    }
  });

  it('bakes the parts into world space, where the prop actually is', () => {
    const prop = DEMO_DISTRICT.props.find((entry) => entry.id === 'duct') as PropDefinition;
    expect(prop).toBeDefined();
    const built = buildScene(onlyLevel(prop));
    try {
      // Parts are normalised against the prop's box, so the union of them is the
      // prop's own footprint - which is what the merged buffer has to cover, vertex
      // for vertex, now that the parts are not meshes of their own.
      // The oracle is the union of the model's own parts, not the prop's box: a
      // part may legitimately stand proud of the box it belongs to - a collar on a
      // duct does - and the merged buffer has to match the parts.
      const parts = resolvePropParts(prop);
      const expected = {
        min: {
          x: Math.min(...parts.map((entry) => entry.min.x)),
          y: Math.min(...parts.map((entry) => entry.min.y)),
          z: Math.min(...parts.map((entry) => entry.min.z)),
        },
        max: {
          x: Math.max(...parts.map((entry) => entry.max.x)),
          y: Math.max(...parts.map((entry) => entry.max.y)),
          z: Math.max(...parts.map((entry) => entry.max.z)),
        },
      };
      const { min, max } = boundsOf(built);

      expect(min.x).toBeCloseTo(expected.min.x, 5);
      expect(min.y).toBeCloseTo(expected.min.y, 5);
      expect(min.z).toBeCloseTo(expected.min.z, 5);
      expect(max.x).toBeCloseTo(expected.max.x, 5);
      expect(max.y).toBeCloseTo(expected.max.y, 5);
      expect(max.z).toBeCloseTo(expected.max.z, 5);
    } finally {
      built.dispose();
    }
  });

  it('draws the city in a thousand meshes, not in one per part', () => {
    // V0.7.1's whole point. One mesh per part was 41,915 draw calls a frame, which
    // no browser can push whatever the triangle count says; merged into per-chunk
    // buffers it is about a thousand - and the parts are the ones that were there
    // before, which is what the oracle below checks.
    const built = buildScene(buildCity(DEMO_DISTRICT));
    try {
      const parts = mergedParts(built);
      expect(parts).toBeGreaterThan(30_000);
      expect(built.chunks.length).toBeLessThan(parts / 20);

      // Nothing was dropped on the way in: every part of every prop that is not a
      // gate is in a buffer. (Gates are groups that slide.)
      const gates = new Set<string>();
      for (const elevator of buildCity(DEMO_DISTRICT).elevators ?? []) {
        for (const prop of buildCity(DEMO_DISTRICT).props) {
          if (isElevatorGateOf(elevator.id, prop.id)) gates.add(prop.id);
        }
      }
      const expected = buildCity(DEMO_DISTRICT).props
        .filter((prop) => !gates.has(prop.id))
        .reduce((total, prop) => total + resolvePropParts(prop).length, 0);
      expect(parts).toBe(expected);

      // A chunk is a real spatial unit rather than a formality: it carries a
      // bounding sphere so the renderer can cull it, and it never moves.
      for (const mesh of built.chunks) {
        expect(mesh.geometry.getAttribute('position').count % 24).toBe(0);
        expect(mesh.geometry.boundingSphere).not.toBeNull();
        expect(mesh.matrixAutoUpdate, 'merged geometry never moves').toBe(false);
      }
    } finally {
      built.dispose();
    }
  });

  it('keeps every merged part a box, exactly as the shared cache handed it out', () => {
    // The V0.2 concern was that parts might all share one *unit cube* and be scaled
    // by the mesh transform, which would break the world-space UV repeat. That is
    // still the invariant: what lands in the buffer is the box the cache built, UVs
    // and all - moved, never rewritten.
    const prop = DEMO_DISTRICT.props.find((entry) => entry.id === 'duct') as PropDefinition;
    const built = buildScene(onlyLevel(prop));
    try {
      const total = verticesOf(built).reduce((sum, attribute) => sum + attribute.count, 0);
      expect(total).toBe(partsOf(built, prop.id).count * 24);

      // Every face of every part faces along an axis.
      for (const geometry of built.chunks.map((mesh) => mesh.geometry)) {
        const normal = geometry.getAttribute('normal');
        for (let index = 0; index < normal.count; index += 1) {
          const axes = [normal.getX(index), normal.getY(index), normal.getZ(index)];
          expect(axes.filter((value) => value !== 0)).toHaveLength(1);
        }
      }
    } finally {
      built.dispose();
    }
  });

  it('scales texture repeats in world space, so density does not depend on size', () => {
    // The deck is far bigger than the pipe run, but both should show the same
    // texels per metre, which means very different UV ranges. Each is built on its
    // own so that the merged chunk holds that prop and nothing else.
    const deck = buildScene(
      onlyLevel(DEMO_DISTRICT.props.find((prop) => prop.id === 'deck') as PropDefinition),
      assetTextures(),
    );
    const pipe = buildScene(
      onlyLevel(DEMO_DISTRICT.props.find((prop) => prop.id === 'pipe-run-far') as PropDefinition),
      assetTextures(),
    );
    try {
      const span = (built: ReturnType<typeof buildScene>): number => {
        let min = Infinity;
        let max = -Infinity;
        for (const mesh of built.chunks) {
          const uv = mesh.geometry.getAttribute('uv');
          for (let index = 0; index < uv.count; index += 1) {
            min = Math.min(min, uv.getX(index));
            max = Math.max(max, uv.getX(index));
          }
        }
        return max - min;
      };

      expect(span(deck)).toBeGreaterThan(span(pipe) * 1.5);
      expect(span(pipe)).toBeGreaterThan(0);
    } finally {
      deck.dispose();
      pipe.dispose();
    }
  });

  it('caches materials by surface and tint', () => {
    const built = buildScene(DEMO_DISTRICT);
    try {
      // The three AC units in the home roof's plant row are identical, so they
      // share all their materials; the recoloured one elsewhere does not.
      const first = partsOf(built, 'ac-unit-home-a').materials;
      const second = partsOf(built, 'ac-unit-home-b').materials;
      const recoloured = partsOf(built, 'ac-unit-far-a').materials;

      expect(first).toEqual(second);
      expect(first[0]).not.toBe(recoloured[0]);

      // Far fewer materials than parts - and, because a merged buffer carries one
      // material, far fewer than chunks too, which is what lets the renderer sort
      // and bind them cheaply.
      const materials = new Set(built.chunks.map((mesh) => mesh.material));
      expect(materials.size).toBeLessThan(mergedParts(built) / 4);
    } finally {
      built.dispose();
    }
  });

  it('applies the prop tints to the material colours', () => {
    const built = buildScene(DEMO_DISTRICT);
    try {
      const material = materialOf(built, 'tower-a');
      const tint = DEMO_DISTRICT.props.find((entry) => entry.id === 'tower-a')?.tints?.concrete;
      expect(tint).toBeDefined();
      expect(material.color.getHexString()).toBe((tint ?? '').replace('#', ''));
    } finally {
      built.dispose();
    }
  });

  it('honours the per-prop shadow flags', () => {
    // Flags are part of what a merged buffer is keyed on, so props that disagree
    // about shadows are drawn from different chunks rather than from one buffer
    // that has to lie about one of them.
    const deck = DEMO_DISTRICT.props.find((prop) => prop.id === 'deck') as PropDefinition;
    const tower = DEMO_DISTRICT.props.find((prop) => prop.id === 'tower-a') as PropDefinition;

    const on = buildScene(onlyLevel(deck));
    const off = buildScene(onlyLevel(tower));
    try {
      expect(on.chunks.every((mesh) => mesh.receiveShadow)).toBe(true);
      // The background towers opt out of receiving shadows.
      expect(off.chunks.every((mesh) => mesh.receiveShadow)).toBe(false);
    } finally {
      on.dispose();
      off.dispose();
    }
  });

  it('sets up the fog and the background from the environment', () => {
    const built = buildScene(DEMO_DISTRICT);
    try {
      const fog = built.scene.fog as THREE.Fog;
      expect(fog).toBeInstanceOf(THREE.Fog);
      expect(fog.near).toBe(DEMO_DISTRICT.environment.fogNear);
      expect(fog.far).toBe(DEMO_DISTRICT.environment.fogFar);

      const background = built.scene.background as THREE.Color;
      expect(background.getHexString()).toBe(DEMO_DISTRICT.environment.skyColor.replace('#', ''));
    } finally {
      built.dispose();
    }
  });
});

describe('buildScene lighting', () => {
  it('creates an ambient light and a shadow-casting sun', () => {
    const built = buildScene(DEMO_DISTRICT);
    try {
      const ambient = built.scene.getObjectByName('ambient');
      expect(ambient).toBeInstanceOf(THREE.HemisphereLight);

      expect(built.sun).toBeInstanceOf(THREE.DirectionalLight);
      expect(built.sun.castShadow).toBe(true);
      expect(built.sun.shadow.mapSize.width).toBe(2048);
      expect(built.sun.target.parent).toBe(built.scene);
    } finally {
      built.dispose();
    }
  });

  it('places the sun along the configured direction', () => {
    const built = buildScene(DEMO_DISTRICT);
    try {
      const direction = new THREE.Vector3(
        DEMO_DISTRICT.environment.sunDirection.x,
        DEMO_DISTRICT.environment.sunDirection.y,
        DEMO_DISTRICT.environment.sunDirection.z,
      ).normalize();

      const actual = built.sun.position.clone().normalize();
      expect(actual.x).toBeCloseTo(direction.x, 9);
      expect(actual.y).toBeCloseTo(direction.y, 9);
      expect(actual.z).toBeCloseTo(direction.z, 9);
    } finally {
      built.dispose();
    }
  });

  it('sizes the shadow camera to cover the roof', () => {
    const built = buildScene(DEMO_DISTRICT);
    try {
      const camera = built.sun.shadow.camera;
      const deck = DEMO_DISTRICT.props.find((prop) => prop.id === 'deck');
      const halfWidth = (deck?.size.x ?? 0) / 2;
      const halfDepth = (deck?.size.z ?? 0) / 2;

      expect(camera.right).toBeGreaterThanOrEqual(halfWidth);
      expect(camera.left).toBeLessThanOrEqual(-halfWidth);
      expect(camera.top).toBeGreaterThanOrEqual(halfDepth);
      expect(camera.bottom).toBeLessThanOrEqual(-halfDepth);
      expect(camera.far).toBeGreaterThan(0);
    } finally {
      built.dispose();
    }
  });
});

describe('buildScene V0.4 content', () => {
  it('adds a point light for every level light', () => {
    const built = buildScene(DEMO_DISTRICT, assetTextures());
    try {
      const lights = built.scene.children.filter(
        (child): child is THREE.PointLight => child instanceof THREE.PointLight,
      );
      expect(lights).toHaveLength(DEMO_DISTRICT.lights?.length ?? 0);
      const names = lights.map((light) => light.name);
      expect(names).toContain('lamp-east-room');
      expect(names).toContain('glow-canyon');
      // Interior lamps must not try to cast shadows: a point-light shadow is a
      // cube map per light, and the demo does not need one.
      expect(lights.every((light) => !light.castShadow)).toBe(true);
    } finally {
      built.dispose();
    }
  });

  it('hangs each door off a pivot on its hinge line', () => {
    const built = buildScene(DEMO_DISTRICT, assetTextures());
    try {
      const door = DEMO_DISTRICT.doors?.find((entry) => entry.id === 'east-room-door');
      expect(door).toBeDefined();
      const group = built.doors.get('east-room-door');
      expect(group).toBeDefined();
      if (!door || !group) throw new Error('missing door');

      // A 'x-' hinge is the door's west edge, so the pivot sits there, on the
      // panel's centre line, at half its height.
      expect(group.position.x).toBeCloseTo(door.position.x - door.size.x / 2, 9);
      expect(group.position.z).toBeCloseTo(door.position.z, 9);
      expect(group.position.y).toBeCloseTo(door.position.y, 9);
      // A closed door has not swung at all.
      expect(group.rotation.y).toBe(0);
      // ...and the leaf is inside the pivot, so turning the pivot turns the door.
      expect(group.children.length).toBeGreaterThan(0);
    } finally {
      built.dispose();
    }
  });

  it('starts a door where the level says it starts', () => {
    const definition = {
      ...DEMO_DISTRICT,
      doors: (DEMO_DISTRICT.doors ?? []).map((door) => ({ ...door, open: true })),
    };
    const built = buildScene(definition, assetTextures());
    try {
      for (const [id, group] of built.doors) {
        expect(Math.abs(group.rotation.y), id).toBeGreaterThan(0);
      }
    } finally {
      built.dispose();
    }
  });

  it('lights every kind of sign from the inside, in its own colour', () => {
    // An emissive surface glows: the tint becomes the emissive colour and the sign
    // texture becomes the emissive map, so only the glyphs light up. Every sign model
    // has to do it - V0.6.1 added four more, and a sign whose lit part is not actually
    // emissive is a sign that is merely pale.
    const built = buildScene(DEMO_DISTRICT, assetTextures());
    try {
      const signs = DEMO_DISTRICT.props.filter((entry) => isMountedModel(entry.model));
      expect(signs.length).toBeGreaterThanOrEqual(8);

      for (const prop of signs) {
        const lit = partsOf(built, prop.id).materials.filter((entry) => {
          const material = entry as THREE.MeshLambertMaterial;
          return material.emissive !== undefined && material.emissive.getHex() !== 0;
        });
        expect(lit.length, prop.id).toBeGreaterThan(0);

        // The glow is the sign's own tint, not a colour baked into the model.
        const tint = prop.tints?.neon;
        expect(tint, prop.id).toBeDefined();
        expect((lit[0] as THREE.MeshLambertMaterial).emissive.getHex(), prop.id).toBe(
          new THREE.Color(tint as string).getHex(),
        );
        expect((lit[0] as THREE.MeshLambertMaterial).emissiveMap, prop.id).not.toBeNull();
      }
    } finally {
      built.dispose();
    }
  });

  it('leaves ordinary surfaces unlit', () => {
    const built = buildScene(DEMO_DISTRICT, assetTextures());
    try {
      const material = materialOf(built, 'deck');
      expect(material.emissive.getHex()).toBe(0);
      expect(material.emissiveMap).toBeNull();
    } finally {
      built.dispose();
    }
  });
});

describe('buildScene V0.5 content', () => {
  it('builds a car for every lift and a mesh for every pickup', () => {
    const built = buildScene(DEMO_DISTRICT, assetTextures());
    try {
      expect([...built.lifts.keys()].sort()).toEqual(
        (DEMO_DISTRICT.elevators ?? []).map((lift) => lift.id).sort(),
      );
      expect([...built.collectibles.keys()].sort()).toEqual(
        (DEMO_DISTRICT.collectibles ?? []).map((pickup) => pickup.id).sort(),
      );
      for (const group of built.lifts.values()) expect(group.children.length).toBeGreaterThan(0);
      for (const group of built.collectibles.values()) expect(group.visible).toBe(true);
    } finally {
      built.dispose();
    }
  });

  it('parks every car on the floor it starts on, ready to be sent', () => {
    // The scene is built before the game exists, so it can only place a car where the
    // *level* says it starts. The game moves it into position before the first frame -
    // see `Game.applyWorldState`.
    const built = buildScene(DEMO_DISTRICT, assetTextures());
    try {
      for (const lift of DEMO_DISTRICT.elevators ?? []) {
        const group = built.lifts.get(lift.id);
        const startY = lift.floors[lift.start ?? 0] as number;
        expect(group?.position.y, lift.id).toBeCloseTo(startY - lift.thickness, 6);
      }
    } finally {
      built.dispose();
    }
  });

  it('draws a gate once — as the group that slides, not also as a static prop', () => {
    // V0.7 pulled gates out of the props pass so they could slide, and did not
    // actually leave them out of it. Every shutter was drawn twice: the group moved
    // when the lift was called, and the copy that had not moved stood shut in front
    // of an opening it had already vacated. Merging the props made that impossible
    // to overlook, because a merged gate can only be in one place.
    const city = buildCity(DEMO_DISTRICT);
    const built = buildScene(city);
    try {
      expect(built.gates.size).toBeGreaterThan(0);

      for (const id of built.gates.keys()) {
        expect(built.parts.get(id), `${id} must not also be a merged prop`).toBeUndefined();
        expect(built.scene.getObjectByName(`gate:${id}`), id).toBeDefined();
      }
    } finally {
      built.dispose();
    }
  });

  it('gives every gate a group of its own, because a gate slides', () => {
    // A prop's parts are added straight to the scene; a gate has to move as a unit, so
    // it is built into a group instead and the game translates that.
    const built = buildScene(DEMO_DISTRICT, assetTextures());
    try {
      let gates = 0;
      for (const lift of DEMO_DISTRICT.elevators ?? []) {
        // Every floor but the roof: the top floor has no wall to hang a gate in.
        for (let index = 0; index < lift.floors.length - 1; index += 1) {
          const id = `${lift.id}-gate-${index}`;
          expect(built.gates.get(id), id).toBeDefined();
          gates += 1;
        }
      }
      // Two towers, three floors each, and no gate on the roof of either.
      expect(gates).toBeGreaterThanOrEqual(4);
    } finally {
      built.dispose();
    }
  });

  it('spreads the smoke into sprites, and skips it without the puff texture', () => {
    const assets = assetTextures();
    const built = buildScene(DEMO_DISTRICT, assets);
    const withoutPuff = buildScene(DEMO_DISTRICT, { ...assets, smoke: null });
    try {
      const expected = (DEMO_DISTRICT.smoke ?? []).reduce((total, plume) => total + plume.count, 0);
      expect(expected).toBeGreaterThan(0);
      expect(built.smoke).toHaveLength(expected);
      for (const { sprite } of built.smoke) expect(sprite).toBeInstanceOf(THREE.Sprite);

      // No texture, no smoke: a sprite without a map is a white square.
      expect(withoutPuff.smoke).toEqual([]);
    } finally {
      built.dispose();
      withoutPuff.dispose();
    }
  });

  it('builds the finish as a pad and a beam of light', () => {
    const built = buildScene(DEMO_DISTRICT, assetTextures());
    try {
      const goal = built.scene.getObjectByName(`goal:${DEMO_DISTRICT.goal?.id ?? ''}`);
      expect(goal).toBeDefined();
      expect(goal?.children).toHaveLength(2);

      const beam = goal?.children[1] as THREE.Mesh;
      const material = beam.material as THREE.MeshLambertMaterial;
      expect(material.emissive.getHex()).not.toBe(0);
      // Transparent *and* emissive: a column of light, not a block of paint.
      expect(material.transparent).toBe(true);
    } finally {
      built.dispose();
    }
  });
});

describe('buildScene sky dome', () => {
  it('uses the cube skybox as the scene background', () => {
    const assets = assetTextures();
    const built = buildScene(DEMO_DISTRICT, assets);
    try {
      // A cube skybox needs no geometry at all, which is the upgrade from V0.1's
      // gradient dome.
      expect(built.scene.background).toBe(assets.skybox);
      expect(built.scene.getObjectByName('sky')).toBeUndefined();
    } finally {
      built.dispose();
    }
  });

  it('falls back to a flat colour when the skybox is missing', () => {
    const built = buildScene(DEMO_DISTRICT, { cityBackdrop: null, skybox: null, surfaces: new Map(), smoke: null });
    try {
      const background = built.scene.background as THREE.Color;
      expect(background).toBeInstanceOf(THREE.Color);
      expect(background.getHexString()).toBe(DEMO_DISTRICT.environment.skyColor.replace('#', ''));
    } finally {
      built.dispose();
    }
  });
});

describe('buildScene city backdrop', () => {
  it('wraps the texture around an open cylinder', () => {
    const assets = assetTextures();
    const built = buildScene(DEMO_DISTRICT, assets);
    try {
      expect(built.backdrop).not.toBeNull();
      const geometry = built.backdrop?.geometry as THREE.CylinderGeometry;
      const material = built.backdrop?.material as THREE.MeshBasicMaterial;

      expect(geometry.parameters.openEnded).toBe(true);
      expect(geometry.parameters.radiusTop).toBeCloseTo(DEMO_DISTRICT.environment.backdrop.radius, 9);
      expect(material.map).toBe(assets.cityBackdrop);
      // Seen from the inside.
      expect(material.side).toBe(THREE.BackSide);
      // The PNG's own alpha is what lets the sky show through the skyline.
      expect(material.transparent).toBe(true);
      expect(material.depthWrite).toBe(false);
      expect(built.backdrop?.frustumCulled).toBe(false);
    } finally {
      built.dispose();
    }
  });

  it('sits the skyline on its configured ground line', () => {
    const built = buildScene(DEMO_DISTRICT, assetTextures());
    try {
      const { height, baseY } = DEMO_DISTRICT.environment.backdrop;
      expect(built.backdrop?.position.y).toBeCloseTo(baseY + height / 2, 9);
    } finally {
      built.dispose();
    }
  });

  it('configures the texture to repeat horizontally and clamp vertically', () => {
    const assets = assetTextures();
    const built = buildScene(DEMO_DISTRICT, assets);
    try {
      expect(assets.cityBackdrop?.wrapS).toBe(THREE.RepeatWrapping);
      expect(assets.cityBackdrop?.wrapT).toBe(THREE.ClampToEdgeWrapping);
      expect(assets.cityBackdrop?.repeat.x).toBe(DEMO_DISTRICT.environment.backdrop.repeat);
      expect(assets.cityBackdrop?.repeat.y).toBe(1);
    } finally {
      built.dispose();
    }
  });

  it('is skipped entirely when the texture is missing', () => {
    const built = buildScene(DEMO_DISTRICT, NO_ASSETS);
    try {
      expect(built.backdrop).toBeNull();
      expect(built.scene.getObjectByName('city-backdrop')).toBeUndefined();
    } finally {
      built.dispose();
    }
  });

  it('is skipped for a degenerate radius or height', () => {
    const flat = {
      ...DEMO_DISTRICT,
      environment: {
        ...DEMO_DISTRICT.environment,
        backdrop: { ...DEMO_DISTRICT.environment.backdrop, height: 0 },
      },
    };
    const built = buildScene(flat, assetTextures());
    try {
      expect(built.backdrop).toBeNull();
    } finally {
      built.dispose();
    }
  });
});

describe('buildScene ground grid', () => {
  it('places a grid at the city ground level', () => {
    const built = buildScene(DEMO_DISTRICT);
    try {
      const grid = built.scene.getObjectByName('ground-grid');
      expect(grid).toBeInstanceOf(THREE.GridHelper);
      expect(grid?.position.y).toBeCloseTo(DEMO_DISTRICT.environment.backdrop.baseY + 0.01, 9);
    } finally {
      built.dispose();
    }
  });
});

describe('buildScene disposal', () => {
  it('empties the scene', () => {
    const built = buildScene(DEMO_DISTRICT, assetTextures());
    expect(built.scene.children.length).toBeGreaterThan(10);

    built.dispose();
    expect(built.scene.children).toHaveLength(0);
  });

  it('is safe to call twice', () => {
    const built = buildScene(DEMO_DISTRICT, assetTextures());
    built.dispose();
    expect(() => built.dispose()).not.toThrow();
  });

  it('does not dispose the textures it borrowed', () => {
    // The view is rebuilt on every restart, so a texture disposed here would
    // leave the next session with a bare sky and untextured props. three.js
    // signals disposal with an event, which is what the renderer listens for.
    const assets = assetTextures();
    const disposed: string[] = [];
    assets.cityBackdrop?.addEventListener('dispose', () => disposed.push('city'));
    assets.skybox?.addEventListener('dispose', () => disposed.push('skybox'));
    for (const [id, texture] of assets.surfaces) {
      texture.addEventListener('dispose', () => disposed.push(id));
    }

    const built = buildScene(DEMO_DISTRICT, assets);
    built.dispose();

    expect(disposed).toEqual([]);
  });

  it('disposes the geometry and materials it created', () => {
    const built = buildScene(DEMO_DISTRICT, assetTextures());
    const mesh = built.chunks[0] as THREE.Mesh;
    const geometryDispose = mesh.geometry.dispose.bind(mesh.geometry);
    const materialDispose = (mesh.material as THREE.Material).dispose.bind(mesh.material);

    let geometryDisposed = false;
    let materialDisposed = false;
    mesh.geometry.dispose = () => {
      geometryDisposed = true;
      geometryDispose();
    };
    (mesh.material as THREE.Material).dispose = () => {
      materialDisposed = true;
      materialDispose();
    };

    built.dispose();

    expect(geometryDisposed).toBe(true);
    expect(materialDisposed).toBe(true);
  });
});
