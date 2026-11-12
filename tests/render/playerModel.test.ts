/**
 * The player's body.
 *
 * A body with no artist behind it is only as good as its rule: every angle comes
 * from the pose, so what these tests check is that the pose *reaches* the mesh - the
 * legs alternate, the crouch lowers the hips, a vault lifts the hands - rather than
 * that any particular angle looks right.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '../../src/core/config.js';
import { describePose, emptyPose, type PlayerPose } from '../../src/game/pose.js';
import { createPlayerState, eyePosition, gaitPhaseAt, stepPlayer } from '../../src/game/player.js';
import { collider, input, optionsFor, spawnAt, world } from '../helpers/player.js';
import { vec3 } from '../../src/core/vec3.js';
import * as THREE from 'three';

import { buildPlayerBody, posePlayerBody, type PlayerBody } from '../../src/render/playerModel.js';

const CONFIG = DEFAULT_CONFIG;

/** The rig's own shoulder height, mirrored from `playerModel.ts` for the stance invariant. */
const SHOULDER_Y = 1.4;
const HIPS_Y = 0.94;

function pose(overrides: Partial<PlayerPose> = {}): PlayerPose {
  return { ...emptyPose(), ...overrides };
}

/** One frame's worth of dt, for tests that want a single step. */
const STEP = 1 / 60;

function build(): PlayerBody {
  return buildPlayerBody();
}

/**
 * Poses the body until the joints have arrived at it.
 *
 * Every angle in the model is a *target* that the joint eases towards, so a single
 * call leaves the body where it was. Settling is also what the tests want: they are
 * about where the pose puts a limb, not about how long it takes to get there.
 */
function settle(body: PlayerBody, target: PlayerPose, frames = 90): void {
  for (let frame = 0; frame < frames; frame += 1) {
    posePlayerBody(body, target, CONFIG, STEP);
  }
}

describe('the body itself', () => {
  it('is a chest, two arms and two legs, all cast from the scene', () => {
    const body = build();
    try {
      let meshes = 0;
      body.root.traverse((object) => {
        if ((object as { isMesh?: boolean }).isMesh) meshes += 1;
      });
      // Chest, waist, chest light, two legs of two segments each plus a foot, and
      // two arms of two segments each plus a hand.
      expect(meshes).toBe(3 + 6 + 6);
      expect(body.root.name).toBe('player-body');
    } finally {
      body.dispose();
    }
  });

  it('stands with its hips at the height the reach calls for', () => {
    const body = build();
    try {
      settle(body, pose());
      // Well under the standing eye height, and well above the feet: the body has to
      // be *under* the camera, or looking down would find the inside of a chest.
      expect(body.hips.position.y).toBeGreaterThan(0.8);
      expect(body.hips.position.y).toBeLessThan(CONFIG.player.standEyeHeight);
    } finally {
      body.dispose();
    }
  });

  it('frees everything it made', () => {
    const body = build();
    let disposed = 0;
    for (const resource of body.resources) {
      const original = resource.dispose.bind(resource);
      resource.dispose = () => {
        disposed += 1;
        original();
      };
    }
    body.dispose();
    expect(disposed).toBe(body.resources.length);
    expect(body.resources.length).toBeGreaterThan(6);
  });
});

describe('the stride', () => {
  it('swings the legs in opposition, and by the amount it is given', () => {
    const body = build();
    try {
      settle(body, pose({ gaitPhase: Math.PI / 2, strideAmount: 1 }));
      const left = body.legLeft.root.rotation.x;
      const right = body.legRight.root.rotation.x;
      expect(Math.sign(left)).toBe(-Math.sign(right));
      expect(Math.abs(left)).toBeCloseTo(Math.abs(right), 6);
      expect(Math.abs(left)).toBeGreaterThan(0.5);

      // A quarter cycle later they have swapped over.
      settle(body, pose({ gaitPhase: (Math.PI * 3) / 2, strideAmount: 1 }));
      expect(body.legLeft.root.rotation.x).toBeCloseTo(-left, 6);
      expect(body.legRight.root.rotation.x).toBeCloseTo(-right, 6);
    } finally {
      body.dispose();
    }
  });

  it('stands still when there is no stride to apply', () => {
    const body = build();
    try {
      settle(body, pose({ gaitPhase: 1.2, strideAmount: 0 }));
      expect(body.legLeft.root.rotation.x).toBeCloseTo(0, 6);
      expect(body.armLeft.root.rotation.x).toBeCloseTo(0, 6);
    } finally {
      body.dispose();
    }
  });

  it('never lets a knee bend the wrong way', () => {
    const body = build();
    try {
      for (let step = 0; step <= 12; step += 1) {
        posePlayerBody(body, pose({ gaitPhase: (step / 12) * Math.PI * 2, strideAmount: 1 }), CONFIG, STEP);
        expect(body.legLeft.mid.rotation.x).toBeLessThanOrEqual(0.0001);
        expect(body.legRight.mid.rotation.x).toBeLessThanOrEqual(0.0001);
      }
    } finally {
      body.dispose();
    }
  });
});

describe('the poses that are not a walk', () => {
  it('drops the hips by exactly as much as the camera drops', () => {
    // The bound here used to be `> crouchHeight * 0.4` (0.44 m), which encoded the *old* crouch
    // depth - the one that left the camera inside the chest. The contract is not a bound, it is an
    // equality: the body crouches as far as the eye and the collision box do, so all three describe
    // the same stance.
    const body = build();
    try {
      settle(body, pose());
      const standing = body.hips.position.y;
      settle(body, pose({ crouchAmount: 1 }));
      const crouched = body.hips.position.y;

      const eyeDrop = CONFIG.player.standEyeHeight - CONFIG.player.crouchEyeHeight;
      expect(standing - crouched).toBeCloseTo(eyeDrop, 2);
      // ...and the box agrees with both: a 1.8 m stand less the same drop is the crouch height.
      expect(CONFIG.player.standHeight - eyeDrop).toBeCloseTo(CONFIG.player.crouchHeight, 2);
    } finally {
      body.dispose();
    }
  });

  it('keeps the eye the same distance above the shoulder in both stances', () => {
    // **The bug this is for.** The camera dropped 0.70 m when crouching and the body's hips only
    // 0.37 m, so the crouched eye ended up 8 cm *below* the shoulder - inside the chest box, with a
    // 0.1 m near plane that does not clip it away. The old test above only asserted a loose lower
    // bound on the hips, which passed at 0.572 and never compared the body to the camera at all.
    //
    // The invariant is the relationship, not either number: whatever the crouch is, the eye must
    // sit the same distance above the shoulder standing and crouched.
    const body = build();
    try {
      const shoulderOffset = SHOULDER_Y - HIPS_Y;
      settle(body, pose());
      const standingGap = CONFIG.player.standEyeHeight - (body.hips.position.y + shoulderOffset);
      settle(body, pose({ crouchAmount: 1 }));
      const crouchedGap = CONFIG.player.crouchEyeHeight - (body.hips.position.y + shoulderOffset);

      expect(crouchedGap).toBeCloseTo(standingGap, 2);
      // ...and it is a positive gap: the eye is above the shoulder, not inside the chest.
      expect(crouchedGap).toBeGreaterThan(0.1);
    } finally {
      body.dispose();
    }
  });

  it('keeps the crouched feet on the ground rather than through it', () => {
    // A hip that drops 0.70 m with straight legs puts the feet 0.22 m below the floor - measured.
    // The fold is derived from the hip height, so the feet stay planted at any crouch.
    const body = build();
    try {
      settle(body, pose({ crouchAmount: 1 }));
      body.root.updateMatrixWorld(true);
      const foot = new THREE.Vector3();
      body.legLeft.end.getWorldPosition(foot);
      expect(foot.y).toBeGreaterThan(-0.05);
      expect(foot.y).toBeLessThan(0.12);
    } finally {
      body.dispose();
    }
  });

  it('raises the hands for a reach, and further for a hang', () => {
    const body = build();
    try {
      settle(body, pose({ armAction: 'swing' }));
      const swing = body.armLeft.root.rotation.x;

      settle(body, pose({ armAction: 'reach' }));
      const reach = body.armLeft.root.rotation.x;

      settle(body, pose({ armAction: 'hanging' }));
      const hanging = body.armLeft.root.rotation.x;

      // Negative is up: a swing hangs down, a reach is forward, a hang is overhead.
      expect(reach).toBeLessThan(swing);
      expect(hanging).toBeLessThan(reach);
    } finally {
      body.dispose();
    }
  });

  it('leans the torso forward with the pose', () => {
    const body = build();
    try {
      settle(body, pose({ lean: 0 }));
      expect(body.torso.rotation.x).toBeCloseTo(0, 6);
      settle(body, pose({ lean: 0.5 }));
      // A spring approaches its target asymptotically, so "settled" is a number of
      // decimals rather than a value: a ten-thousandth of a radian is a third of a
      // millimetre at the end of the torso.
      expect(body.torso.rotation.x).toBeCloseTo(0.5, 4);
    } finally {
      body.dispose();
    }
  });

  it('curls up in the middle of a roll and opens out at the ends', () => {
    const body = build();
    try {
      settle(body, pose({ stance: 'rolling', maneuverProgress: 0.5, lean: 0.5 }));
      const middle = body.torso.rotation.x;
      settle(body, pose({ stance: 'rolling', maneuverProgress: 1, lean: 0.5 }));
      const end = body.torso.rotation.x;

      expect(middle).toBeGreaterThan(end);
      expect(end).toBeCloseTo(0.5, 4);
    } finally {
      body.dispose();
    }
  });

  it('braces into the wall it is running', () => {
    const body = build();
    try {
      settle(body, pose({ legAction: 'brace', wallSide: 1 }));
      const right = body.legRight.root.rotation.x;
      settle(body, pose({ legAction: 'brace', wallSide: -1 }));
      // The driving leg is whichever is towards the wall.
      expect(body.legLeft.root.rotation.x).toBeCloseTo(right, 6);
    } finally {
      body.dispose();
    }
  });

  it('is safe to pose with values nobody would send it', () => {
    const body = build();
    try {
      expect(() =>
        posePlayerBody(
          body,
          pose({
            gaitPhase: Number.NaN,
            strideAmount: 4,
            crouchAmount: -3,
            lean: Number.POSITIVE_INFINITY,
          }),
          CONFIG,
          STEP,
        ),
      ).not.toThrow();
      expect(Number.isFinite(body.hips.position.y)).toBe(true);
    } finally {
      body.dispose();
    }
  });
});

describe('joints that travel rather than jump', () => {
  /** The one free axis of a limb, for measuring how far it moved. */
  const upperOf = (body: PlayerBody): number => body.legLeft.root.rotation.x;

  it('covers only part of the way to a new pose in a frame', () => {
    const body = build();
    try {
      settle(body, pose({ legAction: 'stride', gaitPhase: 0, strideAmount: 0 }));
      const before = upperOf(body);

      // A tuck wants about -1.15 rad. One sixtieth of a second must not get there:
      // that single frame is the difference between a movement and a cut.
      posePlayerBody(body, pose({ legAction: 'tuck' }), CONFIG, STEP);
      const after = upperOf(body);

      expect(Math.abs(after - before)).toBeGreaterThan(0.01);
      expect(Math.abs(after - before)).toBeLessThan(0.35);
    } finally {
      body.dispose();
    }
  });

  it('arrives within about a third of a second, so it is not sluggish either', () => {
    const body = build();
    try {
      settle(body, pose({ legAction: 'stride', gaitPhase: 0, strideAmount: 0 }));
      const target = -1.15;

      // Twenty frames is a third of a second.
      for (let frame = 0; frame < 20; frame += 1) {
        posePlayerBody(body, pose({ legAction: 'tuck' }), CONFIG, STEP);
      }
      expect(upperOf(body)).toBeLessThan(target + 0.15);
    } finally {
      body.dispose();
    }
  });

  it('never steps a joint further than a small fraction of a turn in one frame', () => {
    // Walk, then vault, then hang: the body has to cross three actions without any
    // frame moving a limb so far that the eye reads it as a jump.
    const body = build();
    try {
      const actions = ['stride', 'tuck', 'hang', 'stride'] as const;
      const samples: number[] = [];

      for (const legAction of actions) {
        for (let frame = 0; frame < 40; frame += 1) {
          posePlayerBody(
            body,
            pose({ legAction, armAction: legAction === 'tuck' ? 'tucked' : 'swing', gaitPhase: frame / 8, strideAmount: 1 }),
            CONFIG,
            STEP,
          );
          samples.push(upperOf(body));
        }
      }

      const steps = samples.slice(1).map((value, index) => Math.abs(value - samples[index]!));
      // The largest single-frame move across the whole sequence, including the gait's
      // own swing. The ceiling is what bounds it: an exponential approach alone would
      // let a big change start with a big step. A seventh of a radian in a sixtieth of
      // a second is a quick limb; a whole one would be a cut.
      expect(Math.max(...steps)).toBeLessThan(0.2);
    } finally {
      body.dispose();
    }
  });

  it('is unmoved by a frame that took no time at all', () => {
    const body = build();
    try {
      settle(body, pose({ legAction: 'stride', gaitPhase: 1, strideAmount: 1 }));
      const before = upperOf(body);
      posePlayerBody(body, pose({ legAction: 'tuck' }), CONFIG, 0);
      expect(upperOf(body)).toBe(before);
    } finally {
      body.dispose();
    }
  });
});

describe('the cadence of the walk', () => {
  it('steps about once every half stride, and no faster', () => {
    // One bob cycle per stride, one footstep per half stride. Both come from
    // `strideLength`, which V0.6.1 lengthened: at a walk the legs now cycle about
    // 1.2 times a second rather than 1.5, which is the difference between a run and
    // a scuttle at the speed this game moves.
    const { walk, sprint } = CONFIG.headBob.strideLength;
    const walkCadence = CONFIG.player.walkSpeed / walk;
    const sprintCadence = CONFIG.player.sprintSpeed / sprint;

    expect(walkCadence).toBeLessThan(1.25);
    expect(walkCadence).toBeGreaterThan(0.9);
    // A sprint steps faster than a walk, but not proportionally: that is what the
    // longer sprint stride is for.
    expect(sprintCadence).toBeGreaterThan(walkCadence);
    expect(sprintCadence).toBeLessThan(walkCadence * 1.15);
  });
});

describe('the smoothness of the movement itself', () => {
  /**
   * The worst change of angular *velocity* between frames.
   *
   * This is jerk, and it is what the eye reads as a twitch: a limb can move a long way
   * smoothly and look calm, but it cannot change speed suddenly and look like anything
   * other than a mistake. V0.6.1's joints eased towards their target and were capped at a
   * top speed, and that cap is a kink - a joint that accelerates to a ceiling, holds it
   * and drops back to easing has a discontinuous velocity at both ends of it.
   */
  function worstJerk(actions: readonly PlayerPose['legAction'][]): number {
    const body = buildPlayerBody();
    try {
      const angles: number[] = [];
      for (const legAction of actions) {
        posePlayerBody(
          body,
          pose({ legAction, gaitPhase: 1.2, strideAmount: 1 }),
          CONFIG,
          1 / 240,
        );
        angles.push(body.legLeft.root.rotation.x);
      }
      const velocity = angles.slice(1).map((value, index) => value - angles[index]!);
      const jerk = velocity.slice(1).map((value, index) => Math.abs(value - velocity[index]!));
      return Math.max(...jerk);
    } finally {
      body.dispose();
    }
  }

  it('turns a leg from a walk into a tuck without a corner in its velocity', () => {
    // Sixty frames of walking, then sixty of a vault's tuck: the largest change of intent
    // the model has, and the case that measured 0.032 rad/frame of velocity change inside
    // a single frame when the joint was eased and capped.
    const jerk = worstJerk([...Array(60).fill('stride'), ...Array(60).fill('tuck')] as const);

    // Two orders of magnitude of headroom under the old number, so a joint that went back
    // to being capped - or set outright - fails here rather than looking wrong on a screen.
    expect(jerk).toBeLessThan(0.012);
  });

  it('starts moving from rest, rather than at speed', () => {
    // A spring has no first-frame velocity; an eased-and-capped joint starts at 22% of
    // the gap, which is the first frame of a twitch.
    const body = buildPlayerBody();
    try {
      posePlayerBody(body, pose({ legAction: 'stride', gaitPhase: 0, strideAmount: 0 }), CONFIG, 1 / 240);
      const before = body.legLeft.root.rotation.x;
      posePlayerBody(body, pose({ legAction: 'tuck' }), CONFIG, 1 / 240);
      const moved = Math.abs(body.legLeft.root.rotation.x - before);
      expect(moved).toBeLessThan(0.02);
      expect(moved).toBeGreaterThan(0);
    } finally {
      body.dispose();
    }
  });

  it('still arrives, and does not overshoot', () => {
    // The other half of "smooth": a joint that took a second to get anywhere would be
    // smooth and useless, and one that bounced past its target would be neither.
    const body = buildPlayerBody();
    try {
      let furthest = 0;
      for (let frame = 0; frame < 120; frame += 1) {
        posePlayerBody(body, pose({ legAction: 'tuck' }), CONFIG, 1 / 60);
        furthest = Math.min(furthest, body.legLeft.root.rotation.x);
      }
      // A tuck's thigh target is -1.15 rad, and a critically damped spring approaches it
      // from one side only.
      expect(furthest).toBeLessThan(-1.05);
      expect(furthest).toBeGreaterThanOrEqual(-1.16);
    } finally {
      body.dispose();
    }
  });
});

describe('the pose across a change of state', () => {
  it('flows from a sprint into a mantle and out again, without a corner in it', () => {
    // V1.0.3 fixed how the *eye* moves and left this as an argument rather than a number. It is a
    // number: a sprint into a ledge, over it and away on the other side, with the leg's angle sampled
    // at 240 Hz through the whole thing - walk, airborne, mantle, walk.
    //
    // Two things have to be true for it to look like one movement rather than three. No single frame
    // may move the joint far, which is what a *snap* is; and no frame may change its *speed* much,
    // which is what the eye reads as a corner. The joints have been on critically damped springs
    // since V0.7, and this is the number that says so across a state change rather than within one.
    const ledge = collider('ledge', vec3(6, 0.6, 0), vec3(8, 1.2, 6), 'prop');
    const collisionWorld = world(collider('floor', vec3(0, -0.5, 0), vec3(60, 1, 60), 'floor'), ledge);
    const state = createPlayerState(spawnAt(-6, 0.001, 0, -Math.PI / 2), DEFAULT_CONFIG);
    const options = optionsFor(collisionWorld);
    const body = buildPlayerBody();
    const angles: number[] = [];

    try {
      const pose = emptyPose();
      for (let tick = 0; tick < 120; tick += 1) {
        stepPlayer(state, input({ forward: 1, sprint: true }), STEP, options);
        for (let frame = 0; frame < 4; frame += 1) {
          const alpha = frame / 4;
          posePlayerBody(
            body,
            describePose(state, DEFAULT_CONFIG, pose, gaitPhaseAt(state, alpha)),
            DEFAULT_CONFIG,
            1 / 240,
          );
          angles.push(body.legLeft.root.rotation.x);
        }
      }
    } finally {
      body.dispose();
    }

    const perFrame = angles.slice(1).map((angle, index) => Math.abs(angle - (angles[index] as number)));
    const perFrameChange = perFrame
      .slice(1)
      .map((delta, index) => Math.abs(delta - (perFrame[index] as number)));

    // Measured at 0.026 and 0.0043; the bounds are the seam a leg actually moves in a frame at 240 Hz,
    // which is about a tenth of a radian.
    expect(Math.max(...perFrame)).toBeLessThan(0.09);
    expect(Math.max(...perFrameChange)).toBeLessThan(0.02);
  });
});

describe('where a joint keeps its velocity', () => {
  it('gives two bodies their own springs, so one cannot inherit the other', () => {
    // The springs live on the rig rather than in the module, which is what keeps a test's body
    // and a real one from fighting over the same velocities. A shared map would show up here as
    // the second body starting from the first one's speed.
    const a = buildPlayerBody();
    const b = buildPlayerBody();
    try {
      settle(a, pose({ legAction: 'tuck' }));
      const aAngle = a.legLeft.root.rotation.x;

      // A fresh body, given the same target for one frame, must start from rest - not from
      // wherever `a` had got to. A spring covers 6.3% of a 1.15 rad gap in its first frame at
      // 60 Hz; the eased-and-capped joint this replaced started at 22%, which is the twitch.
      posePlayerBody(b, pose({ legAction: 'tuck' }), CONFIG, STEP);
      const movedInOneFrame = Math.abs(b.legLeft.root.rotation.x);

      expect(movedInOneFrame).toBeGreaterThan(0);
      expect(movedInOneFrame).toBeLessThan(0.1);
      // ...and `a` is undisturbed by `b` having been posed.
      posePlayerBody(a, pose({ legAction: 'tuck' }), CONFIG, STEP);
      expect(Math.abs(a.legLeft.root.rotation.x - aAngle)).toBeLessThan(0.02);
    } finally {
      a.dispose();
      b.dispose();
    }
  });

  it('is unchanged in where it settles after many frames', () => {
    // The rewrite is from string keys to integer slots; what must not change is the *motion*.
    // Run long enough to arrive, and the limb is at the pose's target either way.
    const body = buildPlayerBody();
    try {
      settle(body, pose({ legAction: 'tuck' }), 300);
      const settled = body.legLeft.root.rotation.x;
      for (let frame = 0; frame < 30; frame += 1) {
        posePlayerBody(body, pose({ legAction: 'tuck' }), CONFIG, STEP);
      }
      expect(body.legLeft.root.rotation.x).toBeCloseTo(settled, 6);
    } finally {
      body.dispose();
    }
  });
});

describe('the target filter', () => {
  // **The jerk this is for.** A spring makes a joint's *position* continuous but not its
  // acceleration: when the pose switches from a walk to a vault the target jumps by a radian in one
  // frame, and `a = w^2 (target - x)` jumps with it. Measured on the arm root at a walk-to-vault
  // transition, the velocity went from 0 to -0.139 rad/frame in a single frame. The target is now
  // approached exponentially, so the joint follows something continuous in position *and* velocity.

  it('turns a step change of target into a smooth acceleration, not a snap', () => {
    // Walk for a second, then switch to a vault pose in one frame - the worst case the game has.
    //
    // **Measured at the transition frame, not as a maximum over the sequence.** A max over the whole
    // run is dominated by the ordinary walk cycle (0.083 rad/frame unfiltered), which is *below* the
    // snap it is meant to catch - so a bound on the max cannot tell the two apart. The velocity jump
    // on the frame the target changes is the signal: 0.139 rad/frame unfiltered, 0.026 filtered.
    const frames: PlayerPose[] = [];
    let phase = 0;
    for (let index = 0; index < 60; index += 1) {
      phase += 0.2;
      frames.push(pose({ gaitPhase: phase, strideAmount: 1, speedFraction: 1 }));
    }
    for (let index = 0; index < 26; index += 1) {
      frames.push(
        pose({
          gaitPhase: phase,
          armAction: 'reach',
          legAction: 'tuck',
          maneuver: 'vault',
          maneuverProgress: index / 26,
          strideAmount: 0.2,
        }),
      );
    }

    const body = buildPlayerBody();
    try {
      let previous = body.armLeft.root.rotation.x;
      let previousVelocity = 0;
      let atTransition = 0;
      for (let index = 0; index < frames.length; index += 1) {
        posePlayerBody(body, frames[index] as PlayerPose, CONFIG, STEP);
        const value = body.armLeft.root.rotation.x;
        const velocity = value - previous;
        // Frame 60 is the first vault frame: the target changed between 59 and 60.
        if (index === 60) atTransition = Math.abs(velocity - previousVelocity);
        previousVelocity = velocity;
        previous = value;
      }
      expect(atTransition).toBeLessThan(0.06);
    } finally {
      body.dispose();
    }
  });

  it('cannot oscillate, because an exponential approach has no velocity to overshoot', () => {
    // A *spring* on the target was tried first and was unstable at the rates needed: the foot joint
    // settled into a period-2 oscillation of 0.117 rad/frame, worse than the jerk it was meant to
    // remove. An exponential approach is monotonic by construction, so this asserts the property
    // that made it the right choice rather than a number.
    const body = buildPlayerBody();
    try {
      settle(body, pose({ legAction: 'stride', strideAmount: 1, gaitPhase: 1 }));
      const start = body.legLeft.end.rotation.x;
      // A hard step to a very different target.
      const target = pose({ legAction: 'tuck', maneuver: 'vault', maneuverProgress: 0 });
      let previous = start;
      let reversals = 0;
      let direction = 0;
      for (let frame = 0; frame < 120; frame += 1) {
        posePlayerBody(body, target, CONFIG, STEP);
        const value = body.legLeft.end.rotation.x;
        const step = value - previous;
        if (Math.abs(step) > 1e-6) {
          const sign = Math.sign(step);
          if (direction !== 0 && sign !== direction) reversals += 1;
          direction = sign;
        }
        previous = value;
      }
      // One reversal at most: the approach may settle, but it must not ring.
      expect(reversals).toBeLessThanOrEqual(1);
    } finally {
      body.dispose();
    }
  });
});

describe('the crouch', () => {
  // Two faults were reported together and both came from the crouch being handled in more than one
  // place: the knees folded backwards, and the camera descended faster than the body so it spent
  // the transition inside the chest. These tests pin the geometry and the lockstep separately.

  it('bends the knees forward, with the feet underneath the hips', () => {
    // **Forward in this rig is -Z.** A joint rotates about +X, so a positive thigh angle swings the
    // knee forward and a negative shin angle brings the foot back under the hip. Both signs were
    // inverted, which put the knee 0.43 m *behind* the hip - the "knees bend backward" report.
    const body = build();
    try {
      settle(body, pose({ crouchAmount: 1 }));
      body.root.updateMatrixWorld(true);

      const hip = new THREE.Vector3();
      const knee = new THREE.Vector3();
      const foot = new THREE.Vector3();
      body.legLeft.root.getWorldPosition(hip);
      body.legLeft.mid.getWorldPosition(knee);
      body.legLeft.end.getWorldPosition(foot);

      // The knee leads the hip, in the direction the body faces.
      expect(knee.z).toBeLessThan(hip.z - 0.15);
      // ...and the foot has come back under the hip rather than swinging out in front of it.
      expect(Math.abs(foot.z - hip.z)).toBeLessThan(0.1);
      expect(foot.y).toBeGreaterThan(-0.05);
    } finally {
      body.dispose();
    }
  });

  it('keeps the camera the same distance above the shoulder all the way down', () => {
    // **The bug this is for.** `eyeHeight` was a step function, so the camera's crouch target fell
    // 0.70 m in a single frame while the body's hips eased over about a fifth of a second - and the
    // camera spring's `Math.min` clamp forced it down to that step immediately. Measured, the eye
    // reached 0.44 m *below* the shoulder mid-crouch, i.e. inside the chest.
    //
    // The invariants are: the gap never becomes negative, and it does not change much on the way.
    const floor = collider('floor', vec3(0, -0.5, 0), vec3(600, 1, 600), 'floor');
    const options = optionsFor(world(floor));
    const state = createPlayerState(spawnAt(0, 0.001, 0, 0), CONFIG);
    const body = build();
    try {
      for (let frame = 0; frame < 60; frame += 1) stepPlayer(state, input(), STEP, options);

      const shoulderOffset = SHOULDER_Y - HIPS_Y;
      let lowest = Number.POSITIVE_INFINITY;
      let highest = Number.NEGATIVE_INFINITY;
      for (let frame = 0; frame < 90; frame += 1) {
        stepPlayer(state, input({ crouch: true }), STEP, options);
        posePlayerBody(body, describePose(state, CONFIG, undefined, state.bobPhase), CONFIG, STEP);
        const shoulder = body.hips.position.y + shoulderOffset + state.position.y;
        const gap = eyePosition(state, CONFIG).y - shoulder;
        lowest = Math.min(lowest, gap);
        highest = Math.max(highest, gap);
      }

      // The eye is above the shoulder throughout - never inside the chest.
      expect(lowest).toBeGreaterThan(0.1);
      // ...and the two move together, so the gap barely changes.
      expect(highest - lowest).toBeLessThan(0.06);
      // It did arrive: the crouch is fully applied by the end.
      expect(state.crouchAmount).toBeGreaterThan(0.99);
    } finally {
      body.dispose();
    }
  });
});
