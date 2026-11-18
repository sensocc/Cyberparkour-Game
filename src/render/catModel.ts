/**
 * The alley cat, as geometry rather than as boxes.
 *
 * **Why this is its own file.** Every prop in the city is built from axis-aligned box parts in
 * normalised coordinates (see `models.ts`), which is exactly right for a vent, a water tank or a
 * pipe: they *are* boxes, the collider is a box, and the box parts cost one draw each. The cat is
 * the one model in the city that is not a box - it is an animal you walk up to and look at - and
 * eight boxes read as a stack of crates with ears. At the distance the player meets it, the shape
 * *is* the model, so it is built from capsules, spheres, cones and a torus instead.
 *
 * **Real scale, sitting.** The prop's bounding box is 1.4 x 1.1 x 1.4 m because that is a sensible
 * thing to place and to keep clear of, but the cat in it is about 0.55 m tall - a big cat sitting
 * up. Everything below is in metres relative to the feet, so the proportions can be checked
 * against an actual animal rather than against a normalised cube.
 *
 * **Nothing here animates.** A sitting cat is a still object; what sells it is the silhouette, the
 * forward-tilted head, the curled tail and the two lit eyes. The eyes are emissive and cross the
 * bloom threshold, so the cat is the one warm point of light in a courtyard of cold neon - which
 * is also how you find it.
 */

import * as THREE from 'three';

/** A resource the cat owns and must free. */
type Resource = THREE.BufferGeometry | THREE.Material;

export interface CatBody {
  readonly root: THREE.Group;
  /** Every geometry and material, for disposal. */
  readonly resources: readonly Resource[];
  dispose(): void;
}

/** A mesh of the cat's, tracked for disposal and shadowing. */
function piece(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  resources: Resource[],
  position: readonly [number, number, number],
  rotation?: readonly [number, number, number],
  scale?: readonly [number, number, number],
): THREE.Mesh {
  resources.push(geometry);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(position[0], position[1], position[2]);
  if (rotation) mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
  if (scale) mesh.scale.set(scale[0], scale[1], scale[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Builds the cat, facing `-Z` like every other object in the scene (see `intoYawBasis`).
 *
 * The pose is a seated cat: haunches on the ground, hind legs folded under, chest upright, front
 * legs straight down to the paws, head tilted slightly forward and up - the way a cat watches
 * something - and the tail curled round its feet towards the front.
 */
export function buildCat(): CatBody {
  const resources: Resource[] = [];

  const fur = new THREE.MeshStandardMaterial({ color: 0x2a2b33, roughness: 0.92, metalness: 0.0 });
  const furLight = new THREE.MeshStandardMaterial({ color: 0x3d3f4a, roughness: 0.9, metalness: 0.0 });
  const nose = new THREE.MeshStandardMaterial({ color: 0xd98a8a, roughness: 0.75 });
  const eye = new THREE.MeshStandardMaterial({
    color: 0xffd27a,
    emissive: 0xffb545,
    emissiveIntensity: 2.4,
    roughness: 0.35,
  });
  const pupil = new THREE.MeshStandardMaterial({ color: 0x120c06, roughness: 0.5 });
  resources.push(fur, furLight, nose, eye, pupil);

  const root = new THREE.Group();
  root.name = 'alley-cat-body';

  // ---- the seat: haunches and the folded hind legs -------------------------
  // Two flattened spheres make a seated cat's rear, and the fold of the hind legs reads as the
  // dark wedge under them. The spheres are wider than they are deep, which is what stops the
  // silhouette being a ball.
  const haunchGeometry = new THREE.SphereGeometry(0.15, 16, 12);
  for (const side of [-1, 1]) {
    root.add(
      piece(haunchGeometry, fur, resources, [side * 0.1, 0.15, 0.12], undefined, [1, 1.05, 1.15]),
    );
    // The folded hind paw, peeking out under the haunch.
    root.add(
      piece(
        new THREE.SphereGeometry(0.055, 12, 10),
        furLight,
        resources,
        [side * 0.11, 0.045, -0.06],
        undefined,
        [1, 0.7, 1.5],
      ),
    );
  }

  // ---- the body: a capsule leaning up from the seat ------------------------
  // A capsule rather than a box because a cat's back is a curve, and the lean is what makes it
  // read as *sitting up* rather than as standing.
  root.add(
    piece(
      new THREE.CapsuleGeometry(0.115, 0.16, 8, 16),
      fur,
      resources,
      [0, 0.29, 0.1],
      [0.18, 0, 0],
      [1.1, 1, 0.95],
    ),
  );
  // The chest, a little lighter, where the front legs meet the body.
  root.add(
    piece(
      new THREE.SphereGeometry(0.1, 14, 12),
      furLight,
      resources,
      [0, 0.34, 0.02],
      undefined,
      [1, 1.2, 0.85],
    ),
  );

  // ---- the front legs: straight down to the paws --------------------------
  for (const side of [-1, 1]) {
    root.add(
      piece(
        new THREE.CapsuleGeometry(0.038, 0.19, 6, 10),
        fur,
        resources,
        [side * 0.075, 0.14, -0.04],
      ),
    );
    // The paw.
    root.add(
      piece(
        new THREE.SphereGeometry(0.045, 12, 10),
        furLight,
        resources,
        [side * 0.075, 0.03, -0.075],
        undefined,
        [1, 0.65, 1.45],
      ),
    );
  }

  // ---- the head -----------------------------------------------------------
  // A slightly wide sphere, tilted forward and up. The tilt is the whole expression: a cat
  // looking level is a cat that is not paying attention.
  const head = new THREE.Group();
  head.position.set(0, 0.5, -0.02);
  head.rotation.x = -0.12;
  root.add(head);

  head.add(
    piece(new THREE.SphereGeometry(0.105, 18, 14), fur, resources, [0, 0, 0], undefined, [1.05, 1, 1]),
  );
  // The muzzle, pushed forward and down, and the nose at its tip.
  head.add(
    piece(
      new THREE.SphereGeometry(0.055, 14, 12),
      furLight,
      resources,
      [0, -0.025, -0.075],
      undefined,
      [1, 0.8, 1],
    ),
  );
  head.add(piece(new THREE.SphereGeometry(0.015, 10, 8), nose, resources, [0, -0.012, -0.122]));

  // The ears: cones, angled outward. This is the pair of shapes that says "cat" at any distance.
  for (const side of [-1, 1]) {
    head.add(
      piece(
        new THREE.ConeGeometry(0.045, 0.09, 4, 1),
        fur,
        resources,
        [side * 0.062, 0.095, 0.015],
        [0, side * 0.25, side * -0.22],
      ),
    );
    // The inner ear, a smaller cone a shade lighter.
    head.add(
      piece(
        new THREE.ConeGeometry(0.026, 0.055, 4, 1),
        furLight,
        resources,
        [side * 0.06, 0.09, 0.0],
        [0, side * 0.25, side * -0.22],
      ),
    );
  }

  // The eyes, forward and wide-set. Emissive, so they cross the bloom threshold and make the cat
  // the one warm light of the courtyard.
  for (const side of [-1, 1]) {
    head.add(
      piece(
        new THREE.SphereGeometry(0.023, 12, 10),
        eye,
        resources,
        [side * 0.042, 0.012, -0.088],
        undefined,
        [1.15, 1, 0.8],
      ),
    );
    // A slit pupil, which is what makes it a cat's eye rather than a bead.
    head.add(
      piece(
        new THREE.SphereGeometry(0.011, 8, 8),
        pupil,
        resources,
        [side * 0.042, 0.012, -0.104],
        undefined,
        [0.42, 1, 0.5],
      ),
    );
  }

  // ---- the tail, curled round the front -----------------------------------
  // A torus arc rather than a chain of boxes: it is one continuous curve, and the curl is what
  // reads as "cat" from behind, which is the angle you approach it from most often.
  root.add(
    piece(
      new THREE.TorusGeometry(0.14, 0.028, 8, 20, Math.PI * 1.25),
      fur,
      resources,
      [0, 0.035, 0.16],
      [Math.PI / 2, 0, Math.PI * 0.15],
    ),
  );
  // The tip, lifted a little, so the tail does not read as a hoop lying flat.
  root.add(
    piece(
      new THREE.CapsuleGeometry(0.026, 0.1, 6, 10),
      fur,
      resources,
      [-0.12, 0.06, 0.24],
      [0.5, 0.3, 1.1],
    ),
  );

  return {
    root,
    resources,
    dispose(): void {
      for (const resource of resources) resource.dispose();
    },
  };
}
