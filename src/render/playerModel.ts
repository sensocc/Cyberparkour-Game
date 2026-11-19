/**
 * The player's body.
 *
 * A first-person body: you see your own chest, arms and legs when you look down,
 * and - the reason it exists - it casts a shadow, so the world has a person in it
 * rather than a floating camera.
 *
 * Built from the same primitives as the district's props and posed procedurally:
 * there is no skeleton, no animation file and no artist. Every angle comes from the
 * `PlayerPose` the game derives each frame, which is why the whole thing is testable
 * in Node - nothing here needs a clock, a renderer or a simulation.
 *
 * Layout, in metres relative to the feet, matching `PlayerConfig`:
 *
 * ```
 *   eye                                            1.65
 *   shoulders / chest top                          1.44
 *   hips                                           0.95
 *   knee                                           0.50
 *   foot                                           0.00
 * ```
 *
 * The camera sits *above* the chest, so looking straight down looks past the
 * shoulders at a body that is genuinely below it - rather than at the inside of a
 * torso the near plane has to clip through.
 */

import * as THREE from 'three';

import type { GameConfig } from '../core/config.js';
import { clamp, clamp01 } from '../core/math.js';
import type { PlayerPose } from '../game/pose.js';

/**
 * Bone-ish heights, in metres above the feet.
 *
 * Chosen against the camera rather than against a photograph. The eye is at 1.65
 * and the shoulders at 1.40, which leaves the chest a comfortable 25 cm below the
 * eye: close enough that looking down finds it immediately, far enough that it does
 * not fill the screen the way a chest does when the camera is inside it.
 */
const HIPS_Y = 0.94;
const SHOULDER_Y = 1.4;
const ARM_UPPER = 0.27;
const ARM_FORE = 0.25;
const THIGH = 0.45;
const SHIN = 0.45;

/**
 * The body's dimensions.
 *
 * The chest is narrower than the shoulders and the legs sit wider than the waist,
 * which is what makes the silhouette read as a person from above: looking straight
 * down you see the chest, and the tops of both legs either side of it.
 */
const CHEST_WIDTH = 0.38;
const CHEST_DEPTH = 0.24;
const WAIST_WIDTH = 0.3;
const WAIST_DEPTH = 0.21;
const LIMB = 0.12;
/** How far apart the arms hang, from the shoulder joints. */
const SHOULDER_HALF = 0.245;
/** How far apart the legs are. */
const HIP_HALF = 0.155;

/**
 * How quickly each joint catches up with the pose it has been given (1/s).
 *
 * This is the difference between an animation and a slideshow. Every angle in this
 * file is a *target*, and the joint eases towards it, which does three things at once:
 *
 *  - a change of mode cannot snap. Stepping into a vault, standing up out of a crouch
 *    and letting go of a wall are all continuous, because the limb travels there.
 *  - the limbs have weight. An arm that follows a hand exactly looks driven; one that
 *    lags by a twelfth of a second looks attached.
 *  - a walk cycle stays a walk cycle. The lag is small against a stride - about a
 *    tenth of a cycle - so it reads as follow-through rather than as mud.
 *
 * The rates are ordered the way a body is: hips settle fastest because they carry the
 * weight, then the torso, then the limbs.
 */
/**
 * How quickly each joint catches up with the pose it has been given, as a spring rate in
 * 1/s. Ordered the way a body is: the hips settle first because they carry the weight,
 * then the torso, then out to the hands.
 */
const JOINT_RATE = {
  hips: 11,
  torso: 12,
  upper: 15,
  lower: 18,
  end: 20,
} as const;

/**
 * How much faster the target filter runs than the joint it feeds.
 *
 * **Measured, not guessed.** The filter was swept from 1.5x to 6x against two numbers: the jerk at
 * a walk-to-vault transition, and how long a step change takes to arrive. Jerk falls steadily as
 * the filter slows (0.053 at 1.5x, 0.100 at 4x) and response time barely moves (18 frames at 2x,
 * 16 unfiltered), so the choice is about how much lag is worth how much smoothness. At 2x the
 * transition jerk is 0.066 rad/frame against 0.141 unfiltered - a 53 % cut - for 33 ms of extra
 * response, which is the knee of that curve.
 */
const TARGET_RATE_SCALE = 2;

/**
 * Critically damped springs, one per joint axis.
 *
 * Every angle in this file is a *target*, and the joint travels to it. That much was
 * V0.6. V0.7 changed *how* it travels, and the reason is worth keeping.
 *
 * An exponential ease is smooth in position, but a big change used to be capped at a top
 * speed - and a cap is a kink. A joint that accelerates to a ceiling, holds it, and drops
 * back to easing has a *discontinuous velocity* at both ends of the ceiling, and it is the
 * discontinuity, far more than the size of the movement, that an eye reads as a jerk. On a
 * leg whipping from a standing pose into a vault tuck it measured 0.032 rad per frame of
 * velocity change - inside a single frame, at 240 Hz.
 *
 * A critically damped spring has no ceiling, no overshoot and no corner: acceleration is a
 * continuous function of position and velocity, so the limb starts from rest, arrives
 * without a bounce, and never has a kink in its velocity. That is the whole difference
 * between a movement and a twitch.
 */
/**
 * How many joint axes the rig can spring at once.
 *
 * The body has fourteen moving groups and each needs at most one slot per axis and one for its
 * height, so this is generous - and it is a *fixed* capacity on purpose: a pose call happens every
 * frame, and a frame is not a place to grow an array.
 */
const JOINT_SLOTS = 96;

class Joints {
  /**
   * One velocity per (group, axis), in a flat buffer.
   *
   * This was a `Map` keyed on `` `${object.uuid}:r${axis}` `` - a template string built on every
   * joint of every frame, twenty-odd allocations a frame in the render path, to look up a float. A
   * group is identified by an integer instead, assigned the first time it is touched and cached
   * against the group itself.
   */
  private readonly velocity = new Float32Array(JOINT_SLOTS * 4);
  /**
   * The *smoothed* target each joint is following.
   *
   * **Why a target filter, and not just a stiffer spring.** A spring makes the joint's *position*
   * continuous, but not its acceleration: when the pose switches from a walk to a vault the target
   * jumps by a radian in one frame, and `a = w^2 (target - x)` jumps with it. Measured on the arm
   * root at a walk-to-vault transition, the velocity went from 0 to -0.139 rad/frame in a single
   * frame - which is the jerk the eye reads as a snap, and no amount of spring stiffness removes it
   * because the discontinuity is in the *input*.
   *
   * **An exponential approach, not a second spring.** A spring on the target was tried first and
   * was *unstable* at the rates needed: at 2.5x the joint rate the foot joint settled into a
   * period-2 oscillation of 0.117 rad/frame, worse than the jerk it was meant to remove. An
   * exponential approach has no velocity state to overshoot, so it cannot oscillate at any rate or
   * step size - it is monotonic by construction. It trades a little lag for unconditional
   * stability, which is the right trade in a render path that must never twitch.
   */
  private readonly target = new Float32Array(JOINT_SLOTS * 4);
  /** The pre-smoothed height component applied outside each joint's spring. */
  private readonly offsets = new Float32Array(JOINT_SLOTS * 4);
  /** Which slot a group owns, assigned on first use. */
  private readonly slots = new WeakMap<THREE.Object3D, number>();
  private nextSlot = 0;
  /** Written by `integrate` and read by its caller, so nothing here allocates. */
  private value = 0;

  /**
   * Turns a joint about one axis, towards `target` radians.
   *
   * `offset` is applied outside the spring, exactly as `height`'s is: the spring smooths only the
   * part it is given, and the offset is added afterwards. The crouch fold uses it so that the hip,
   * the thigh and the shin are all driven by the same eased value and stay geometrically consistent
   * mid-transition - when the fold was left inside the spring the hip outran the knee and the feet
   * passed 0.4 m through the floor.
   */
  rotation(
    object: THREE.Object3D,
    axis: 'x' | 'y' | 'z',
    target: number,
    rate: number,
    dt: number,
    offset = 0,
  ): void {
    const slot = this.slotFor(object) + (axis === 'x' ? 0 : axis === 'y' ? 1 : 2);
    // `rotation[axis]` already carries last frame's offset, so take it off before integrating.
    this.integrate(slot, object.rotation[axis] - this.offsets[slot]!, target, rate, dt);
    this.offsets[slot] = offset;
    object.rotation[axis] = this.value + offset;
  }

  /**
   * Moves a joint up or down, for the one that travels instead of turning.
   *
   * `offset` is a component applied *outside* the spring: the spring only ever smooths the part of
   * the target it is given, and the offset is added afterwards without becoming the spring's own
   * position. That matters for the hips, because the crouch is already eased upstream and must not
   * be smoothed a second time - two cascaded filters put the hips 0.2 m behind the camera, which is
   * how the camera ended up inside the chest.
   */
  height(object: THREE.Object3D, target: number, rate: number, dt: number, offset = 0): void {
    const slot = this.slotFor(object) + 3;
    // `position.y` already carries last frame's offset, so take it back off before integrating.
    this.integrate(slot, object.position.y - this.offsets[slot]!, target, rate, dt);
    this.offsets[slot] = offset;
    object.position.y = this.value + offset;
  }

  /** The base index of a group's four velocities, assigning one the first time it is seen. */
  private slotFor(object: THREE.Object3D): number {
    const existing = this.slots.get(object);
    if (existing !== undefined) return existing;

    // A body that somehow exceeded the buffer would wrap onto another joint's velocity, which
    // would be a visible twitch - so the last slot is shared rather than overrun. The real rig
    // uses fourteen of these.
    const base = this.nextSlot < JOINT_SLOTS ? this.nextSlot : JOINT_SLOTS - 1;
    this.nextSlot += 1;
    const slot = base * 4;
    this.slots.set(object, slot);
    // **Start the filter where the joint already is.** A filter seeded at zero would make every
    // joint on a fresh body travel from the origin to its first pose, which is a visible snap on
    // the first frame of a session. `NaN` marks "not seeded yet"; `integrate` fills it in.
    for (let axis = 0; axis < 4; axis += 1) this.target[slot + axis] = Number.NaN;
    return slot;
  }

  /**
   * One step of a critically damped spring.
   *
   * `a = w^2 (target - x) - 2w v`, integrated semi-implicitly - velocity first, then
   * position - which is stable at the step sizes a frame can have. A very long frame is
   * clamped rather than allowed out of that region: it settles a little slower instead of
   * exploding.
   */
  private integrate(slot: number, current: number, target: number, rate: number, dt: number): void {
    const step = Math.min(1 / 30, Math.max(0, dt));

    // A slot's first frame: start the filter at the joint's current value, so the body does not
    // travel from the origin to its first pose.
    if (Number.isNaN(this.target[slot] as number)) this.target[slot] = current;

    // 1. The target itself, approached exponentially. `1 - exp(-k dt)` is the fraction of the
    //    remaining distance covered this step: monotonic, stable at any dt, and it cannot overshoot.
    const targetRate = rate * TARGET_RATE_SCALE;
    const approach = 1 - Math.exp(-targetRate * step);
    this.target[slot] = (this.target[slot] as number) + (target - (this.target[slot] as number)) * approach;

    // 2. The joint, following the filtered target.
    const velocity = this.velocity[slot] as number;
    const acceleration = rate * rate * ((this.target[slot] as number) - current) - 2 * rate * velocity;
    const next = velocity + acceleration * step;
    this.velocity[slot] = next;
    this.value = current + next * step;
  }
}

/** One limb, as the chain of groups that has to be turned to pose it. */
interface Limb {
  readonly root: THREE.Group;
  readonly mid: THREE.Group;
  readonly end: THREE.Group;
}

export interface PlayerBody {
  readonly root: THREE.Group;
  readonly hips: THREE.Group;
  readonly torso: THREE.Group;
  readonly legLeft: Limb;
  readonly legRight: Limb;
  readonly armLeft: Limb;
  readonly armRight: Limb;
  /** Every geometry and material, for disposal. */
  readonly resources: (THREE.BufferGeometry | THREE.Material)[];
  /**
   * One spring per joint axis.
   *
   * On the rig rather than in a module: two bodies - a real one and a test's - must not
   * share a set of velocities.
   */
  readonly joints: Joints;
  dispose(): void;
}

/** A number that is safe to put into a matrix. */
function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * **The body is made of capsules and spheres, not boxes.**
 *
 * Every other model in the city is axis-aligned box parts, which is right for a vent or a tank and
 * wrong for a person: a box torso seen from above is a rectangle, and the player looks down at
 * their own body more than at anything else in the game. A capsule has the one property that
 * matters here - its silhouette is round from every angle, including the top-down one - and a
 * sphere at each joint covers the seam where two capsules meet, so a bent elbow reads as an elbow
 * rather than as two sticks crossing.
 *
 * The segment count is deliberately low (8-12). This is a body seen at arm's length by a camera
 * that clips anything within 10 cm of the eye, so the extra smoothness of a 32-segment capsule is
 * never resolved; what *is* seen is the silhouette, and 8 segments already reads as round.
 */

/** A shape of the body's own, tracked for disposal. */
function shape(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  resources: (THREE.BufferGeometry | THREE.Material)[],
): THREE.Mesh {
  resources.push(geometry);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** A capsule limb segment, hanging down from its joint. */
function capsule(
  radius: number,
  height: number,
  material: THREE.Material,
  resources: (THREE.BufferGeometry | THREE.Material)[],
  offsetY = 0,
  offsetZ = 0,
  radialSegments = 10,
): THREE.Mesh {
  // `CapsuleGeometry`'s height is the *cylindrical* part, so a segment of total length `height`
  // is a capsule of `height - 2 * radius` plus two hemispherical caps.
  const geometry = new THREE.CapsuleGeometry(radius, Math.max(0.001, height - radius * 2), 4, radialSegments);
  const mesh = shape(geometry, material, resources);
  mesh.position.set(0, offsetY, offsetZ);
  return mesh;
}

/** A sphere, squashed to the proportions given. */
function blob(
  radius: number,
  material: THREE.Material,
  resources: (THREE.BufferGeometry | THREE.Material)[],
  offsetY = 0,
  offsetZ = 0,
  scale: readonly [number, number, number] = [1, 1, 1],
  widthSegments = 14,
): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(radius, widthSegments, Math.max(8, widthSegments - 4));
  const mesh = shape(geometry, material, resources);
  mesh.position.set(0, offsetY, offsetZ);
  mesh.scale.set(scale[0], scale[1], scale[2]);
  return mesh;
}

/**
 * A two-jointed limb hanging from `attach`.
 *
 * Three things make this read as a limb rather than as two sticks: the segments are *capsules*, so
 * their ends are round; each joint carries a sphere slightly wider than the segment, so the bend
 * has a pivot instead of a gap; and the lower segment is thinner than the upper one, which is the
 * proportion a forearm has to an upper arm.
 *
 * The joints stay plain `Group`s with nothing but their position and rotation set - the pose code
 * drives them by name and the springs key on the object - so the shape of what hangs off them is
 * invisible to every test in `playerModel.test.ts`.
 */
function limb(
  attach: THREE.Object3D,
  material: THREE.Material,
  resources: (THREE.BufferGeometry | THREE.Material)[],
  upperLength: number,
  lowerLength: number,
  thickness: number,
): Limb {
  const radius = thickness / 2;
  const root = new THREE.Group();
  root.add(capsule(radius, upperLength, material, resources, -upperLength / 2));
  // The shoulder joint, a ball a little wider than the segment it joins.
  root.add(blob(radius * 1.06, material, resources, 0, 0, [1, 1, 1], 10));
  attach.add(root);

  const mid = new THREE.Group();
  mid.position.y = -upperLength;
  root.add(mid);
  const lowerRadius = radius * 0.84;
  mid.add(capsule(lowerRadius, lowerLength, material, resources, -lowerLength / 2));
  // The knee or elbow: the widest point of the limb, which is what a joint is.
  mid.add(blob(lowerRadius * 1.12, material, resources, 0, 0, [1, 1, 1], 10));

  const end = new THREE.Group();
  end.position.y = -lowerLength;
  mid.add(end);

  return { root, mid, end };
}

/**
 * Builds the body, in the district's own palette.
 *
 * The colours are deliberately the *suit* colours rather than the district's: a
 * player who looks down should see themselves, not a piece of the building. The
 * materials are small and dedicated, so nothing here can tint the level.
 */
export function buildPlayerBody(): PlayerBody {
  const resources: (THREE.BufferGeometry | THREE.Material)[] = [];
  const suit = new THREE.MeshStandardMaterial({ color: 0x2c3a4d, roughness: 0.72, metalness: 0.08 });
  const trim = new THREE.MeshStandardMaterial({
    color: 0x4fd8ff,
    roughness: 0.4,
    metalness: 0.1,
    emissive: 0x1c6b86,
    emissiveIntensity: 0.7,
  });
  const glove = new THREE.MeshStandardMaterial({ color: 0x1d2634, roughness: 0.8, metalness: 0.05 });
  resources.push(suit, trim, glove);

  const root = new THREE.Group();
  root.name = 'player-body';

  const hips = new THREE.Group();
  hips.position.y = HIPS_Y;
  root.add(hips);

  const torso = new THREE.Group();
  hips.add(torso);

  // The pelvis, a wide flattened ball: what stops the torso floating above the legs.
  torso.add(blob(WAIST_DEPTH / 2, suit, resources, 0.02, 0, [WAIST_WIDTH / WAIST_DEPTH, 0.8, 1]));

  // The waist, narrower than both the pelvis and the chest - the inversion is the whole reason the
  // torso reads as a body rather than as a barrel.
  torso.add(blob(WAIST_DEPTH * 0.46, suit, resources, 0.14, 0, [WAIST_WIDTH / WAIST_DEPTH, 0.75, 0.96]));

  const chestHeight = SHOULDER_Y - HIPS_Y - 0.12;
  const chest = capsule(
    CHEST_DEPTH / 2,
    chestHeight + 0.16,
    suit,
    resources,
    chestHeight / 2 + 0.14,
    0,
    12,
  );
  // **Wider than it is deep.** A capsule is round in cross-section; a chest is not, and the player
  // looks straight down at this one. Scaling X is what turns the top-down silhouette from a circle
  // into shoulders.
  chest.scale.set(CHEST_WIDTH / CHEST_DEPTH, 1, 1);
  torso.add(chest);

  // The shoulder mass, a bar across the top of the chest, so the arms come out of something.
  torso.add(
    blob(0.085, suit, resources, SHOULDER_Y - HIPS_Y - 0.02, 0, [SHOULDER_HALF / 0.085, 0.62, 0.8]),
  );

  // A small lit badge on the chest's upper front. Small on purpose: it is the *nearest* thing to
  // the camera when the player looks down, so anything bigger than a badge turns the view cyan.
  torso.add(
    blob(
      CHEST_DEPTH * 0.14,
      trim,
      resources,
      SHOULDER_Y - HIPS_Y - 0.02,
      // `-Z` is the front of this rig, which is the side the player looks down at.
      -CHEST_DEPTH * 0.34,
      [1.2, 0.55, 0.6],
      10,
    ),
  );

  const legLeft = limb(hips, suit, resources, THIGH, SHIN, LIMB * 1.25);
  const legRight = limb(hips, suit, resources, THIGH, SHIN, LIMB * 1.25);
  legLeft.root.position.x = -HIP_HALF;
  legRight.root.position.x = HIP_HALF;
  for (const leg of [legLeft, legRight]) {
    // The foot: a squashed ball pushed **forward**, which reads as a boot from above - the angle
    // the player actually sees their own feet from.
    //
    // **`-Z`, because forward in this rig is `-Z`** (see `intoYawBasis`). It was `+Z`, so the toe
    // pointed behind the player: the knee swung correctly forward and the foot pointed the other
    // way, which reads as a leg bent backwards at the ankle. Measured at a full crouch, the knee
    // sat 0.43 m in front of the hip and the toe 0.06 m behind it.
    leg.end.add(blob(LIMB * 0.68, glove, resources, -0.035, -LIMB * 0.38, [1, 0.62, 1.75], 10));
  }

  const armLeft = limb(torso, suit, resources, ARM_UPPER, ARM_FORE, LIMB);
  const armRight = limb(torso, suit, resources, ARM_UPPER, ARM_FORE, LIMB);
  armLeft.root.position.set(-SHOULDER_HALF, SHOULDER_Y - HIPS_Y - 0.04, 0);
  armRight.root.position.set(SHOULDER_HALF, SHOULDER_Y - HIPS_Y - 0.04, 0);
  for (const arm of [armLeft, armRight]) {
    // The hand, a slightly elongated ball rather than a box: a fist, not a brick.
    arm.end.add(blob(LIMB * 0.52, glove, resources, -0.055, 0, [1, 1.15, 0.85], 10));
  }

  return {
    root,
    hips,
    torso,
    legLeft,
    legRight,
    armLeft,
    armRight,
    resources,
    joints: new Joints(),
    dispose(): void {
      for (const resource of resources) resource.dispose();
    },
  };
}

/**
 * Applies a pose.
 *
 * Every limb is driven from the same two numbers - the gait phase and how much
 * stride to apply - plus the pose's own answer about what the arms and legs are
 * doing. The result is a walk that is a function of distance travelled (because the
 * phase is), so it never slides against the ground, and a set of special cases that
 * are all just "where would a person put their arms".
 */
export function posePlayerBody(
  body: PlayerBody,
  pose: PlayerPose,
  config: GameConfig,
  dt: number,
): void {
  // The last line before the GPU, and the place a NaN would do the most damage: one
  // in the scene graph becomes a NaN matrix, and three.js then renders nothing at
  // all. So every number is made finite and in range here, once, rather than trusted.
  const stride = clamp01(finite(pose.strideAmount));
  const phase = finite(pose.gaitPhase);
  const crouch = clamp01(finite(pose.crouchAmount));
  const lean = finite(pose.lean);
  const progress = clamp01(finite(pose.maneuverProgress));
  // A frame that took a quarter of a second (a tab coming back, a breakpoint) must
  // not make the damping explode, and a paused game hands us zero.
  const step = Math.min(0.1, Math.max(0, finite(dt)));

  // Hips drop when crouched and rise and fall with the stride, which is what puts the
  // vertical bob into the *body* rather than only into the camera. The bob is a
  // raised cosine rather than the absolute value of a sine: `|sin|` has a kink at the
  // bottom of every step, and a kink in the hips is a jolt in the whole body.
  const bob = (1 - Math.cos(phase * 2)) * 0.5;
  // The shoulders swing against the hips, the way they do when a person walks: it is
  // the one detail that turns a pair of moving legs into somebody walking, and it costs
  // a single rotation.
  const shoulderTwist = -Math.sin(phase) * 0.13 * stride;

  // **The body crouches as far as the camera does.**
  //
  // The camera drops `standEyeHeight - crouchEyeHeight` (0.70 m) and the collision box drops the
  // same 0.70 m (1.8 -> 1.1), so those two agree with each other and the *body* was the outlier: it
  // dropped only 0.37 m, which left the crouched eye 8 cm **below the shoulder** - inside the chest
  // box, with a 0.1 m near plane that does not clip it away. Matching the camera is the fix that
  // changes no gameplay: the box, the eye and the body all describe the same crouch.
  const eyeDrop = config.player.standEyeHeight - config.player.crouchEyeHeight;
  // **The spring smooths the bob only; the crouch is applied outside it.** `pose.crouchAmount` is
  // already eased once in the simulation, and the camera reads that same eased number, so running
  // it through this spring as well would make the hips lag the eye by the spring's own response
  // time - measured at 0.2 m, the camera inside the chest for a third of a second. One filter in
  // front of both is in step; two are not.
  //
  // The crouch offset is kept in a variable because the legs need the hip's *actual* height to work
  // out how far to fold, and the spring's own state is not that number.
  const crouchOffset = -crouch * eyeDrop;
  const hipsTarget = HIPS_Y - bob * 0.022 * stride;
  body.joints.height(body.hips, hipsTarget, JOINT_RATE.hips, step, crouchOffset);

  // **And the legs fold to keep the feet on the ground.** A hip that drops 0.70 m with straight legs
  // puts the feet 0.22 m through the floor - measured - so the fold is derived from the hip height
  // rather than being a constant: with thigh and shin equal, a symmetric fold of `a` puts the feet
  // at `(THIGH + SHIN) * cos(a)`, so `a = acos(hips / (THIGH + SHIN))`. At standing height that is
  // zero (the ratio clamps to 1), and at a full crouch it is about 74 degrees - a deep squat, which
  // is what a 0.70 m crouch is.
  //
  // **The hip height here is the *drawn* one, crouch offset included.** It has to be: the fold exists
  // to put the feet back under a hip that has already moved, so deriving it from the rest height
  // would fold nothing and drive the feet through the floor - which is exactly what happened when
  // the crouch was first moved outside the spring and this line still read `hipsTarget`.
  const drawnHipHeight = body.hips.position.y;
  const legFold = Math.acos(clamp(drawnHipHeight / (THIGH + SHIN), -1, 1));

  // A forward lean through the whole body. A roll curls the torso up as well: the
  // camera is inside the body for the whole of it, so what is visible is the chest
  // folding towards the knees rather than a standing figure spinning.
  // **Negated, because the torso stands *up*.** Every other joint in this rig hangs *down* from
  // its pivot, so a positive rotation about X swings the far end forward (-Z). The torso's far end
  // is its shoulders, which are *above* the hips - so the same positive rotation tips them
  // backward. Measured before the fix: a sprint leaned the chest top 0.073 m behind the hips, a
  // crouch 0.188 m, a slide 0.221 m and the middle of a roll 0.360 m. That is the "the camera's
  // forward is the body's back" report: the body was leaning away from where it was going.
  const curl = pose.stance === 'rolling' ? 0.9 * (1 - Math.abs(progress - 0.5) * 2) : 0;
  body.joints.rotation(body.torso, 'x', -(lean + curl), JOINT_RATE.torso, step);
  body.joints.rotation(body.torso, 'y', shoulderTwist, JOINT_RATE.torso, step);

  const swing = 0.7 * stride;
  const knee = 0.75 * stride;

  for (const [leg, sign] of [
    [body.legLeft, 1],
    [body.legRight, -1],
  ] as const) {
    applyLeg(body, leg, pose, sign, phase, swing, knee, legFold, progress, stride, step);
  }

  for (const [arm, sign] of [
    [body.armLeft, -1],
    [body.armRight, 1],
  ] as const) {
    applyArm(body, arm, pose, sign, phase, swing, step);
  }
}

function applyLeg(
  body: PlayerBody,
  leg: Limb,
  pose: PlayerPose,
  sign: number,
  phase: number,
  swing: number,
  knee: number,
  legFold: number,
  progress: number,
  stride: number,
  step: number,
): void {
  // Targets first, then the joints travel towards them.
  let upper = 0;
  let lower = 0;
  let end = 0;
  // The crouch fold is applied *outside* the spring, like the hip's own crouch offset. Left inside,
  // it lagged the hip during a transition: the hip is offset directly while the thigh and shin chase
  // their targets at rates 15 and 18, so mid-crouch the leg was momentarily 0.4 m too long and the
  // feet passed through the floor. Outside, the fold is exactly the fold the drawn hip height implies.
  let foldUpper = 0;
  let foldLower = 0;

  switch (pose.legAction) {
    case 'stride': {
      // One full cycle per stride: the thighs are half a cycle apart, and the knee
      // only ever bends one way.
      // The crouch fold is *added* to the stride rather than replacing it, so a crouched player
      // still walks: the thigh swings about the folded pose and the shin keeps the foot down.
      //
      // **The signs point forward.** A joint rotates about +X, and forward in this rig is -Z, so a
      // *positive* thigh angle swings the knee forward and a *negative* shin angle brings the foot
      // back under the hip. Both were inverted when the fold was introduced, which put the knee
      // 0.43 m behind the hip and folded it the wrong way - the "knees bend backward" report.
      upper = Math.sin(phase) * sign * swing;
      lower = -Math.max(0, Math.cos(phase) * sign) * knee;
      foldUpper = legFold;
      foldLower = -2 * legFold;

      // **The ankle has to cancel the fold, or the sole points into the floor.**
      //
      // The foot sits at the end of a chain that now carries the thigh's swing, the shin's bend
      // and the whole crouch fold. It inherited all of it and countered none: measured at a full
      // crouch, the shin had folded -2.60 rad while the ankle added only +0.42, which left the
      // sole tilted **50 degrees** off the floor with the toe driving down through it. A lower leg
      // that sweeps back while its foot points at the ground reads as a knee bending the wrong way,
      // however correct the knee's own position is - and the knee *was* correct (0.434 m in front
      // of the hip, measured in the running game), which is why position probes kept saying the
      // pose was fine.
      //
      // Undoing the fold puts the sole flat again. It is the fold specifically, not the whole
      // chain: the walk's own swing still moves the foot, which is what a step does.
      const flat = -(foldUpper + foldLower);

      // The toe-off roll, **scaled by the stride**. It used to be unconditional, so a player
      // standing still - or crouched and motionless - had a foot tilted 24 degrees. A foot that
      // rolls should be rolling over something.
      const roll =
        Math.max(0, Math.cos(phase) * sign) * 0.42 - Math.max(0, -Math.cos(phase) * sign) * 0.18;
      end = flat + roll * stride;
      break;
    }
    case 'tuck': {
      // Knees up and in, the shape a body makes going over something.
      //
      // **Positive, because a positive thigh angle lifts the knee *forward*.** This was `-1.15`,
      // which drove the knee 0.41 m behind the hip - the same sign error the stride had, in a case
      // the stride's test did not cover. Measured on the `tuck` pose: knee ahead of hip -0.411 m.
      upper = 1.15 - progress * 0.5;
      lower = -1.5;
      end = 0.4;
      break;
    }
    case 'hang': {
      // Hanging or falling: the legs trail, slightly apart, with a slow drift so a
      // long fall is not a statue.
      upper = 0.22 + Math.sin(phase * 0.35) * 0.05 * sign;
      lower = -0.35;
      end = 0.12;
      break;
    }
    case 'brace': {
      // Wall running: the leg on the wall's side drives into it, the other trails.
      // Which leg that is depends on which side the wall is on, which is why the pose
      // carries it - a body that always drove with the same leg would look wrong on
      // every wall but one.
      const drives = pose.wallSide !== 0 && sign === -pose.wallSide;
      // **The driving leg leads, the trailing leg follows.** Both were backwards: the drive was
      // `-0.75`, which put *that* knee 0.31 m behind the hip, so the leg that was supposed to be
      // planted on the wall was folded away from it.
      upper = drives ? 0.75 : -0.5;
      lower = drives ? -1.1 : -0.5;
      end = 0.25;
      break;
    }
    case 'slide': {
      // **A slide is not a crouch-walk.** The lead leg goes out in front, nearly straight, and the
      // trailing leg folds right under the hip with the foot tucked back - the shape a person
      // actually makes going under something. The crouch fold is *replaced* rather than added to,
      // because a slide is not a squat: the hips are low but the body is long, not compact.
      //
      // `sign` picks which leg leads, so a slide reads as coming off one hip rather than as a
      // symmetric squat. The lead is fixed to the player's right, which is what a right-footed
      // slide looks like; a slide is a one-sided move and faking symmetry would look worse.
      const leads = sign > 0;
      // A positive thigh angle is forward, so the lead leg swings out and the trailing one folds
      // back under the body - and both knees still bend *forward*, which is the invariant.
      upper = leads ? 1.05 : 0.15;
      lower = leads ? -0.28 : -1.85;
      end = leads ? -0.2 : 0.55;
      break;
    }
    case 'idle': {
      // **Standing about.** The legs take a relaxed stance: the weight on one hip, the knees very
      // slightly bent, and a slow shift of that weight from side to side over about five seconds.
      // The shift is what separates "idle" from "paused": a body that is perfectly still reads as a
      // mannequin, and the eye is very good at spotting one.
      //
      // The breath is shared with the torso (see `posePlayerBody`), so the legs only carry the
      // weight shift and the small knee settle.
      const sway = Math.sin(pose.idleTime * 0.9) * 0.5 + 0.5;
      upper = (sign > 0 ? 1 : -1) * 0.06 * sway;
      lower = -0.09 - 0.04 * sway;
      end = 0;
      break;
    }
  }

  body.joints.rotation(leg.root, 'x', upper, JOINT_RATE.upper, step, foldUpper);
  body.joints.rotation(leg.mid, 'x', lower, JOINT_RATE.lower, step, foldLower);
  body.joints.rotation(leg.end, 'x', end, JOINT_RATE.end, step);
}

function applyArm(
  body: PlayerBody,
  arm: Limb,
  pose: PlayerPose,
  sign: number,
  phase: number,
  swing: number,
  step: number,
): void {
  let upper = 0;
  let roll = 0;
  let lower = 0;
  let end = 0;

  switch (pose.armAction) {
    case 'swing': {
      // **Counter-swing to the legs.** The sign here is already flipped relative to the legs in
      // `posePlayerBody` - the left arm is set up with `sign = -1` and the left leg with `+1` - so
      // leading with another minus made each arm swing *with* its own leg, which is a walk nobody
      // has ever made. Measured at phase +PI/2: left knee at -0.290 and left hand at -0.156, both
      // in front. They must be on opposite sides.
      upper = Math.sin(phase) * sign * swing * 0.8;
      // Held clear of the chest, so a walking player can see their own hands.
      roll = sign * (0.22 + swing * 0.12);
      lower = -0.45 - Math.abs(Math.sin(phase)) * 0.3 * swing;
      end = -0.1;
      break;
    }
    case 'reach': {
      // Both hands forward and up: a vault, a mantle, or a pipe.
      // **Positive, so the hands go forward and up.** These were negative, which for a limb that
      // hangs down swings the hand *backward* - so a vault reached behind the player and a mantle
      // grabbed at nothing. Measured in the old `reach` pose: the hand sat 0.476 m *behind* the
      // shoulder. `overhead` (0.225) and `hanging` (0.092) had the same sign.
      const lift = pose.piping ? 2.0 : 1.75 - clamp01(finite(pose.maneuverProgress)) * 0.35;
      upper = lift * (pose.piping && pose.pipeDirection < 0 ? 0.75 : 1);
      roll = sign * 0.26;
      lower = -0.5;
      end = -0.25;
      break;
    }
    case 'phone': {
      // One arm bent up to the ear, the other hanging. It overrides whatever the movement asked
      // for, because it is the one moment in the game where the body is doing something the
      // movement system has no opinion about - a phone call is not a gait.
      if (sign > 0) {
        upper = -0.5;
        roll = -0.55;
        lower = -1.9;
        end = -1.35;
      } else {
        upper = 0.1;
        roll = sign * 0.08;
        lower = -0.32;
        end = -0.2;
      }
      break;
    }
    case 'overhead': {
      // Both hands straight up, on a ladder.
      upper = 2.6;
      roll = sign * 0.12;
      lower = -0.25;
      end = 0;
      break;
    }
    case 'hanging': {
      upper = 2.9;
      roll = sign * 0.1;
      lower = -0.15;
      end = 0;
      break;
    }
    case 'tucked': {
      upper = 1.3;
      roll = sign * 0.35;
      lower = -1.7;
      end = -0.3;
      break;
    }
    case 'relaxed': {
      upper = 0.25;
      roll = sign * 0.3;
      lower = -0.5;
      end = -0.15;
      break;
    }
    case 'slide': {
      // **Arms out for balance, trailing behind.** A sliding player's hands are not swinging: one
      // arm reaches back to the ground behind them and the other is thrown out to the side. That is
      // what distinguishes a slide from a crouch at speed.
      //
      // `sign` splits them: the leading-side arm goes wide, the trailing one drops back.
      // The trailing arm goes *back* - negative for a joint that hangs down - and the leading arm
      // comes just forward of the body. Both were the other way round.
      const trailing = sign > 0;
      upper = trailing ? -0.95 : 0.25;
      roll = sign * (trailing ? 0.55 : 0.85);
      lower = trailing ? -0.35 : -0.75;
      end = trailing ? -0.1 : -0.3;
      break;
    }
    case 'idle': {
      // **Arms hanging, with a slow breath.** The upper arm hangs close to the body, the elbow is
      // slightly bent, and the hands drift a centimetre or two as the chest rises - which is the
      // whole trick of an idle: the pose is almost still, and the *almost* is what reads as alive.
      //
      // The breath is the same `sin` the torso uses, so the arms and the chest move together
      // instead of the arms floating independently of the shoulder they hang from.
      const breath = Math.sin(pose.idleTime * 1.15) * pose.idleAmount;
      upper = 0.16 + breath * 0.05;
      roll = sign * (0.17 + breath * 0.02);
      lower = -0.34 - breath * 0.05;
      end = -0.12;
      break;
    }
  }

  body.joints.rotation(arm.root, 'x', upper, JOINT_RATE.upper, step);
  body.joints.rotation(arm.root, 'z', roll, JOINT_RATE.upper, step);
  body.joints.rotation(arm.mid, 'x', lower, JOINT_RATE.lower, step);
  body.joints.rotation(arm.end, 'x', end, JOINT_RATE.end, step);
}
