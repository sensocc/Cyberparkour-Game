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
import { clamp01, easeToward } from '../core/math.js';
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
const JOINT_RATE = {
  hips: 11,
  torso: 12,
  upper: 15,
  lower: 18,
  end: 20,
} as const;

/**
 * And a ceiling on how fast a joint is allowed to travel.
 *
 * An exponential approach is proportional: it moves a fixed *fraction* of the gap
 * each frame, so a large change still starts with a large step - a leg whipping from
 * a standing pose into a vault tuck covered seventeen degrees in one sixtieth of a
 * second, which is exactly the jolt this is here to remove. Capping the step as well
 * means a big change takes longer instead of arriving faster, which is what a heavy
 * limb does.
 *
 * Metres per second for the hips, radians per second for everything else.
 */
const JOINT_SPEED = {
  hips: 1.2,
  torso: 6,
  upper: 7.5,
  lower: 9,
  end: 11,
} as const;

/** One limb, as the chain of groups that has to be rotated to pose it. */
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
  dispose(): void;
}

function box(
  width: number,
  height: number,
  depth: number,
  material: THREE.Material,
  resources: (THREE.BufferGeometry | THREE.Material)[],
  offsetY = 0,
  offsetZ = 0,
): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  resources.push(geometry);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(0, offsetY, offsetZ);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Moves one joint towards its target: eased, but never faster than its ceiling.
 *
 * Both halves matter. The ease is what makes small changes smooth and the ceiling is
 * what keeps a large one from being a cut; and because the ceiling is a *speed*, a
 * long frame moves further than a short one, which is what keeps the animation
 * frame-rate independent.
 */
function travel(current: number, target: number, rate: number, maxSpeed: number, dt: number): number {
  const eased = easeToward(current, target, rate, dt);
  const delta = eased - current;
  const limit = maxSpeed * dt;
  if (Math.abs(delta) <= limit) return eased;
  return current + Math.sign(delta) * limit;
}

/** A number that is safe to put into a matrix. */
function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

/** A two-jointed limb hanging from `attach`. */
function limb(
  attach: THREE.Object3D,
  material: THREE.Material,
  resources: (THREE.BufferGeometry | THREE.Material)[],
  upperLength: number,
  lowerLength: number,
  thickness: number,
): Limb {
  const root = new THREE.Group();
  const upper = box(thickness, upperLength, thickness, material, resources, -upperLength / 2);
  root.add(upper);
  attach.add(root);

  const mid = new THREE.Group();
  mid.position.y = -upperLength;
  root.add(mid);
  const lower = box(thickness * 0.86, lowerLength, thickness * 0.86, material, resources, -lowerLength / 2);
  mid.add(lower);

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

  const chestHeight = SHOULDER_Y - HIPS_Y - 0.12;
  torso.add(box(CHEST_WIDTH, chestHeight, CHEST_DEPTH, suit, resources, chestHeight / 2 + 0.12));
  torso.add(box(WAIST_WIDTH, 0.26, WAIST_DEPTH, suit, resources, 0.06));
  // A lit band across the *top* of the chest, oversized in both directions so it is
  // visible from above: it is the one piece of the body the player looks at most, and
  // the thing that stops the view reading as the inside of a box.
  // A small lit patch on the chest's top face, near the front edge. Small on
  // purpose: it is the *nearest* thing to the camera when the player looks down, so
  // anything bigger than a badge turns the whole view cyan.
  torso.add(
    box(
      CHEST_WIDTH * 0.3,
      0.02,
      CHEST_DEPTH * 0.3,
      trim,
      resources,
      SHOULDER_Y - HIPS_Y + 0.005,
      CHEST_DEPTH * 0.3,
    ),
  );

  const legLeft = limb(hips, suit, resources, THIGH, SHIN, LIMB * 1.25);
  const legRight = limb(hips, suit, resources, THIGH, SHIN, LIMB * 1.25);
  legLeft.root.position.x = -HIP_HALF;
  legRight.root.position.x = HIP_HALF;
  for (const leg of [legLeft, legRight]) {
    leg.end.add(box(LIMB * 1.3, 0.09, LIMB * 1.9, glove, resources, -0.045, LIMB * 0.35));
  }

  const armLeft = limb(torso, suit, resources, ARM_UPPER, ARM_FORE, LIMB);
  const armRight = limb(torso, suit, resources, ARM_UPPER, ARM_FORE, LIMB);
  armLeft.root.position.set(-SHOULDER_HALF, SHOULDER_Y - HIPS_Y - 0.04, 0);
  armRight.root.position.set(SHOULDER_HALF, SHOULDER_Y - HIPS_Y - 0.04, 0);
  for (const arm of [armLeft, armRight]) {
    arm.end.add(box(LIMB, 0.11, LIMB * 1.1, glove, resources, -0.055));
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
  const hipsTarget =
    HIPS_Y - crouch * (HIPS_Y - config.player.crouchHeight * 0.52) - bob * 0.022 * stride;
  body.hips.position.y = travel(body.hips.position.y, hipsTarget, JOINT_RATE.hips, JOINT_SPEED.hips, step);

  // A forward lean through the whole body. A roll curls the torso up as well: the
  // camera is inside the body for the whole of it, so what is visible is the chest
  // folding towards the knees rather than a standing figure spinning.
  const curl = pose.stance === 'rolling' ? 0.9 * (1 - Math.abs(progress - 0.5) * 2) : 0;
  body.torso.rotation.x = travel(body.torso.rotation.x, lean + curl, JOINT_RATE.torso, JOINT_SPEED.torso, step);

  const swing = 0.7 * stride;
  const knee = 0.75 * stride;

  for (const [leg, sign] of [
    [body.legLeft, 1],
    [body.legRight, -1],
  ] as const) {
    applyLeg(leg, pose, sign, phase, swing, knee, crouch, progress, step);
  }

  for (const [arm, sign] of [
    [body.armLeft, -1],
    [body.armRight, 1],
  ] as const) {
    applyArm(arm, pose, sign, phase, swing, step);
  }
}

function applyLeg(
  leg: Limb,
  pose: PlayerPose,
  sign: number,
  phase: number,
  swing: number,
  knee: number,
  crouch: number,
  progress: number,
  step: number,
): void {
  // Targets first, then the joints travel towards them.
  let upper = 0;
  let lower = 0;
  let end = 0;

  switch (pose.legAction) {
    case 'stride': {
      // One full cycle per stride: the thighs are half a cycle apart, and the knee
      // only ever bends one way.
      upper = Math.sin(phase) * sign * swing;
      lower = -Math.max(0, Math.cos(phase) * sign) * knee - crouch * 0.7;
      end = Math.max(0, Math.cos(phase) * sign) * 0.35;
      break;
    }
    case 'tuck': {
      // Knees up and in, the shape a body makes going over something.
      upper = -1.15 + progress * 0.5;
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
      upper = drives ? -0.75 : 0.5;
      lower = drives ? -1.1 : -0.5;
      end = 0.25;
      break;
    }
  }

  leg.root.rotation.x = travel(leg.root.rotation.x, upper, JOINT_RATE.upper, JOINT_SPEED.upper, step);
  leg.mid.rotation.x = travel(leg.mid.rotation.x, lower, JOINT_RATE.lower, JOINT_SPEED.lower, step);
  leg.end.rotation.x = travel(leg.end.rotation.x, end, JOINT_RATE.end, JOINT_SPEED.end, step);
}

function applyArm(
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
      // Counter-swing to the legs, and the elbows stay bent the way arms do.
      upper = -Math.sin(phase) * sign * swing * 0.8;
      // Held clear of the chest, so a walking player can see their own hands.
      roll = sign * (0.22 + swing * 0.12);
      lower = -0.45 - Math.abs(Math.sin(phase)) * 0.3 * swing;
      end = -0.1;
      break;
    }
    case 'reach': {
      // Both hands forward and up: a vault, a mantle, or a pipe.
      const lift = pose.piping ? -2.0 : -1.75 + clamp01(finite(pose.maneuverProgress)) * 0.35;
      upper = lift * (pose.piping && pose.pipeDirection < 0 ? 0.75 : 1);
      roll = sign * 0.26;
      lower = -0.5;
      end = -0.25;
      break;
    }
    case 'overhead': {
      // Both hands straight up, on a ladder.
      upper = -2.6;
      roll = sign * 0.12;
      lower = -0.25;
      end = 0;
      break;
    }
    case 'hanging': {
      upper = -2.9;
      roll = sign * 0.1;
      lower = -0.15;
      end = 0;
      break;
    }
    case 'tucked': {
      upper = -1.3;
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
  }

  arm.root.rotation.x = travel(arm.root.rotation.x, upper, JOINT_RATE.upper, JOINT_SPEED.upper, step);
  arm.root.rotation.z = travel(arm.root.rotation.z, roll, JOINT_RATE.upper, JOINT_SPEED.upper, step);
  arm.mid.rotation.x = travel(arm.mid.rotation.x, lower, JOINT_RATE.lower, JOINT_SPEED.lower, step);
  arm.end.rotation.x = travel(arm.end.rotation.x, end, JOINT_RATE.end, JOINT_SPEED.end, step);
}
