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

function build(): PlayerBody {
  return buildPlayerBody();
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
      posePlayerBody(body, pose(), CONFIG);
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
      posePlayerBody(body, pose({ gaitPhase: Math.PI / 2, strideAmount: 1 }), CONFIG);
      const left = body.legLeft.root.rotation.x;
      const right = body.legRight.root.rotation.x;
      expect(Math.sign(left)).toBe(-Math.sign(right));
      expect(Math.abs(left)).toBeCloseTo(Math.abs(right), 6);
      expect(Math.abs(left)).toBeGreaterThan(0.5);

      // A quarter cycle later they have swapped over.
      posePlayerBody(body, pose({ gaitPhase: (Math.PI * 3) / 2, strideAmount: 1 }), CONFIG);
      expect(body.legLeft.root.rotation.x).toBeCloseTo(-left, 6);
      expect(body.legRight.root.rotation.x).toBeCloseTo(-right, 6);
    } finally {
      body.dispose();
    }
  });

  it('stands still when there is no stride to apply', () => {
    const body = build();
    try {
      posePlayerBody(body, pose({ gaitPhase: 1.2, strideAmount: 0 }), CONFIG);
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
        posePlayerBody(body, pose({ gaitPhase: (step / 12) * Math.PI * 2, strideAmount: 1 }), CONFIG);
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
      posePlayerBody(body, pose(), CONFIG);
      const standing = body.hips.position.y;
      posePlayerBody(body, pose({ crouchAmount: 1 }), CONFIG);
      expect(body.hips.position.y).toBeLessThan(standing);
      expect(body.hips.position.y).toBeGreaterThan(CONFIG.player.crouchHeight * 0.4);
    } finally {
      body.dispose();
    }
  });

  it('raises the hands for a reach, and further for a hang', () => {
    const body = build();
    try {
      posePlayerBody(body, pose({ armAction: 'swing' }), CONFIG);
      const swing = body.armLeft.root.rotation.x;

      posePlayerBody(body, pose({ armAction: 'reach' }), CONFIG);
      const reach = body.armLeft.root.rotation.x;

      posePlayerBody(body, pose({ armAction: 'hanging' }), CONFIG);
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
      posePlayerBody(body, pose({ lean: 0 }), CONFIG);
      expect(body.torso.rotation.x).toBeCloseTo(0, 6);
      posePlayerBody(body, pose({ lean: 0.5 }), CONFIG);
      expect(body.torso.rotation.x).toBeCloseTo(0.5, 6);
    } finally {
      body.dispose();
    }
  });

  it('curls up in the middle of a roll and opens out at the ends', () => {
    const body = build();
    try {
      posePlayerBody(body, pose({ stance: 'rolling', maneuverProgress: 0.5, lean: 0.5 }), CONFIG);
      const middle = body.torso.rotation.x;
      posePlayerBody(body, pose({ stance: 'rolling', maneuverProgress: 1, lean: 0.5 }), CONFIG);
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
      posePlayerBody(body, pose({ legAction: 'brace', wallSide: 1 }), CONFIG);
      const right = body.legRight.root.rotation.x;
      posePlayerBody(body, pose({ legAction: 'brace', wallSide: -1 }), CONFIG);
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
        ),
      ).not.toThrow();
      expect(Number.isFinite(body.hips.position.y)).toBe(true);
    } finally {
      body.dispose();
    }
  });
});
