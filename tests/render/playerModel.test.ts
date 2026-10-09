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
import { emptyPose, type PlayerPose } from '../../src/game/pose.js';
import { buildPlayerBody, posePlayerBody, type PlayerBody } from '../../src/render/playerModel.js';

const CONFIG = DEFAULT_CONFIG;

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
  it('drops the hips when crouching', () => {
    const body = build();
    try {
      settle(body, pose());
      const standing = body.hips.position.y;
      settle(body, pose({ crouchAmount: 1 }));
      expect(body.hips.position.y).toBeLessThan(standing);
      expect(body.hips.position.y).toBeGreaterThan(CONFIG.player.crouchHeight * 0.4);
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
      expect(body.torso.rotation.x).toBeCloseTo(0.5, 6);
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
      expect(end).toBeCloseTo(0.5, 6);
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
