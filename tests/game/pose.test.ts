/**
 * The player's pose.
 *
 * The pose is the *interface* between the simulation and the animation: it says
 * which way the arms should be reaching, and the renderer decides what that looks
 * like. So these tests are about the decisions, not the angles.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '../../src/core/config.js';
import {
  createPlayerState,
  gaitPhaseAt,
  type ManeuverMove,
  type ScriptedMove,
} from '../../src/game/player.js';
import { describePose, emptyPose, poseSignature, type PlayerPose } from '../../src/game/pose.js';
import type { SpawnPoint } from '../../src/game/level/levelData.js';

const CONFIG = DEFAULT_CONFIG;
const SPAWN: SpawnPoint = { position: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0 };

function onDeck(): ReturnType<typeof createPlayerState> {
  const state = createPlayerState(SPAWN, CONFIG);
  state.grounded = true;
  return state;
}

function poseOf(state: ReturnType<typeof createPlayerState>): PlayerPose {
  return describePose(state, CONFIG);
}

/** A scripted move in progress, with only what a pose cares about spelled out. */
function maneuver(kind: ScriptedMove, elapsed = 0.2, durationSeconds = 0.4): ManeuverMove {
  return {
    kind,
    elapsed,
    durationSeconds,
    from: { x: 0, y: 0, z: 0 },
    to: { x: 1, y: 0, z: 0 },
    arcHeight: 0.2,
    entry: { x: 0, y: 0, z: 0 },
    exitSpeed: 4,
    exitDirection: { x: 1, y: 0, z: 0 },
    lowProfile: kind === 'roll',
  };
}

describe('a standing player', () => {
  it('strides nowhere and leans not at all', () => {
    const pose = poseOf(onDeck());
    expect(pose.strideAmount).toBe(0);
    expect(pose.lean).toBe(0);
    expect(pose.crouchAmount).toBe(0);
    expect(pose.armAction).toBe('swing');
    expect(pose.legAction).toBe('stride');
    expect(pose.grounded).toBe(true);
    expect(pose.airborne).toBe(false);
  });

  it('writes into the object it is given, so the game can keep one', () => {
    const out = emptyPose();
    expect(poseOf(onDeck())).not.toBe(out);
    expect(describePose(onDeck(), CONFIG, out)).toBe(out);
  });
});

describe('moving', () => {
  it('strides in proportion to how much the game says the player is moving', () => {
    const state = onDeck();
    state.bobAmount = 0.5;
    expect(poseOf(state).strideAmount).toBeCloseTo(0.5, 6);

    state.bobAmount = 1;
    expect(poseOf(state).strideAmount).toBeCloseTo(1, 6);
  });

  it('strides less in the air, where the feet are not pushing anything', () => {
    const state = onDeck();
    state.bobAmount = 1;
    state.grounded = false;
    expect(poseOf(state).strideAmount).toBeLessThan(0.5);
  });

  it('leans further the faster it goes', () => {
    const slow = onDeck();
    slow.velocity.x = 2;
    const fast = onDeck();
    fast.velocity.x = CONFIG.player.sprintSpeed;

    expect(poseOf(slow).lean).toBeLessThan(poseOf(fast).lean);
    expect(poseOf(fast).speedFraction).toBeCloseTo(1, 6);
  });

  it('never reports more than a full sprint', () => {
    const state = onDeck();
    state.velocity.x = CONFIG.player.sprintSpeed * 4;
    expect(poseOf(state).speedFraction).toBe(1);
  });
});

describe('stances', () => {
  it('crouches and folds the body forward', () => {
    const state = onDeck();
    state.crouching = true;
    const pose = poseOf(state);
    expect(pose.crouchAmount).toBe(1);
    expect(pose.stance).toBe('crouched');
    expect(pose.lean).toBeGreaterThan(0.3);
  });

  it('folds furthest when sliding, which is a crouch at speed', () => {
    const crouched = onDeck();
    crouched.crouching = true;
    const sliding = onDeck();
    sliding.sliding = true;

    expect(poseOf(sliding).lean).toBeGreaterThan(poseOf(crouched).lean);
  });

  it('rolls the body up when the move is a roll', () => {
    const state = onDeck();
    state.maneuver = maneuver('roll');
    const pose = poseOf(state);
    expect(pose.stance).toBe('rolling');
    expect(pose.armAction).toBe('tucked');
    expect(pose.legAction).toBe('tuck');
    expect(pose.maneuverProgress).toBeCloseTo(0.5, 6);
  });
});

describe('the arms', () => {
  const reaching: [string, (state: ReturnType<typeof createPlayerState>) => void][] = [
    [
      'a vault',
      (state) => {
        state.maneuver = maneuver('vault', 0.1, 0.5);
      },
    ],
    [
      'a mantle',
      (state) => {
        state.maneuver = maneuver('mantle', 0.1, 0.5);
      },
    ],
    ['a climbing pitch', (state) => (state.climbId = 'ladder')],
  ];

  for (const [what, arrange] of reaching) {
    it(`puts both hands up for ${what}`, () => {
      const state = onDeck();
      state.grounded = false;
      arrange(state);
      const pose = poseOf(state);
      expect(['reach', 'overhead']).toContain(pose.armAction);
    });
  }

  it('tucks the legs for a move that lifts them, and lets them hang from a ladder', () => {
    const vaulting = onDeck();
    vaulting.grounded = false;
    vaulting.maneuver = maneuver('vault');
    expect(poseOf(vaulting).legAction).toBe('tuck');

    const climbing = onDeck();
    climbing.grounded = false;
    climbing.climbId = 'ladder';
    expect(poseOf(climbing).legAction).toBe('hang');
  });

  it('does not walk the legs while climbing a ladder with the feet on a rung', () => {
    // **The bug this is for.** `legActionFor` checked `grounded` last, so a player on a ladder whose
    // feet were on the bottom rung got arms straight up and legs *striding* - a combination no body
    // makes. The existing ladder test set `grounded = false`, which is why it never saw this.
    const climbing = onDeck();
    climbing.grounded = true;
    climbing.climbId = 'ladder';
    const pose = poseOf(climbing);
    expect(pose.armAction).toBe('overhead');
    expect(pose.legAction).not.toBe('stride');
  });

  it('hangs from a ledge with straight arms', () => {
    const state = onDeck();
    state.grounded = false;
    state.hangId = 'roof-edge';
    expect(poseOf(state).armAction).toBe('hanging');
    expect(poseOf(state).legAction).toBe('hang');
  });

  it('reaches up a pipe, and the legs hang', () => {
    const state = onDeck();
    state.grounded = false;
    state.pipeId = 'pipe-east';
    state.pipeDirection = 1;
    const pose = poseOf(state);
    expect(pose.armAction).toBe('reach');
    expect(pose.legAction).toBe('hang');
    expect(pose.piping).toBe(true);
    expect(pose.pipeDirection).toBe(1);
  });

  it('goes limp when the player is dead', () => {
    const state = onDeck();
    state.alive = false;
    state.maneuver = null;
    const pose = poseOf(state);
    expect(pose.armAction).toBe('relaxed');
    expect(pose.legAction).toBe('hang');
    expect(pose.strideAmount).toBe(0);
  });

  it('braces against the wall it is running', () => {
    const state = onDeck();
    state.grounded = false;
    state.wallId = 'facade-canyon';
    state.wallNormal = { x: 1, y: 0, z: 0 };
    expect(poseOf(state).legAction).toBe('brace');
  });
});

describe('the wall side', () => {
  it('is relative to where the player is facing', () => {
    const state = onDeck();
    state.grounded = false;
    state.wallId = 'facade-canyon';
    // Facing +X, which is where yaw -PI/2 points.
    state.yaw = -Math.PI / 2;

    // A wall on the player's right is to +Z, so its face - the normal - looks back
    // along -Z. That is the side the body leans *into*.
    state.wallNormal = { x: 0, y: 0, z: -1 };
    expect(poseOf(state).wallSide).toBe(1);

    // And the mirror image on the left.
    state.wallNormal = { x: 0, y: 0, z: 1 };
    expect(poseOf(state).wallSide).toBe(-1);

    // A wall dead ahead is to neither side.
    state.wallNormal = { x: -1, y: 0, z: 0 };
    expect(poseOf(state).wallSide).toBe(0);
  });

  it('is zero when there is no wall at all', () => {
    expect(poseOf(onDeck()).wallSide).toBe(0);
  });
});

describe('the gait phase between simulation steps', () => {
  it('extrapolates the last step by the fraction of the next one that has happened', () => {
    // A pose derived only from the last step's phase moves in 60 Hz jumps whatever the
    // display does, which is the stutter this exists to remove.
    const state = onDeck();
    state.bobPhase = 1;
    state.bobPhaseStep = 0.4;

    expect(gaitPhaseAt(state, 0)).toBeCloseTo(1, 6);
    expect(gaitPhaseAt(state, 0.5)).toBeCloseTo(1.2, 6);
    expect(gaitPhaseAt(state, 1)).toBeCloseTo(1.4, 6);
  });

  it('wraps, so a long run does not lose precision', () => {
    const state = onDeck();
    state.bobPhase = Math.PI * 2 - 0.1;
    state.bobPhaseStep = 0.4;
    const phase = gaitPhaseAt(state, 1);
    expect(phase).toBeGreaterThanOrEqual(0);
    expect(phase).toBeLessThan(Math.PI * 2);
    expect(phase).toBeCloseTo(0.3, 6);
  });

  it('clamps a fraction outside the step, which would be a step the simulation has not taken', () => {
    const state = onDeck();
    state.bobPhase = 0;
    state.bobPhaseStep = 1;
    expect(gaitPhaseAt(state, -2)).toBeCloseTo(0, 6);
    expect(gaitPhaseAt(state, 4)).toBeCloseTo(1, 6);
  });

  it('stands still when the player does', () => {
    const state = onDeck();
    state.bobPhaseStep = 0;
    expect(gaitPhaseAt(state, 1)).toBeCloseTo(state.bobPhase, 6);
  });
});

describe('the pose signature', () => {
  // **The shadow gate's question, asked in one place.** The view redraws the shadow map when the
  // body's shape changes, and it used to answer that by comparing five hand-picked scalars. The
  // silhouette is also changed by the arm and leg actions, the stance, which side a wall is on and
  // which way a pipe is being worked - so a player grabbing a ledge changed pose completely and the
  // shadow kept the old one. The signature covers every field that moves a limb.

  it('changes when only the arm action changes', () => {
    const a = poseSignature({ ...emptyPose(), armAction: 'swing' });
    const b = poseSignature({ ...emptyPose(), armAction: 'hanging' });
    expect(a).not.toBe(b);
  });

  it('changes when only the leg action changes', () => {
    expect(poseSignature({ ...emptyPose(), legAction: 'stride' })).not.toBe(
      poseSignature({ ...emptyPose(), legAction: 'hang' }),
    );
  });

  it('changes for every field that moves a limb', () => {
    const base = emptyPose();
    const variants: Partial<PlayerPose>[] = [
      { armAction: 'reach' },
      { legAction: 'tuck' },
      { stance: 'rolling' },
      { locomotion: 'climbing' },
      { wallSide: 1 },
      { pipeDirection: -1 },
      { maneuver: 'vault' },
      { crouchAmount: 0.5 },
      { strideAmount: 0.5 },
      { gaitPhase: 1 },
      { lean: 0.2 },
      { maneuverProgress: 0.5 },
    ];
    const seen = new Set([poseSignature(base)]);
    for (const variant of variants) {
      const signature = poseSignature({ ...base, ...variant });
      expect(seen.has(signature), JSON.stringify(variant)).toBe(false);
      seen.add(signature);
    }
  });

  it('is stable for a pose that has not changed', () => {
    const pose = { ...emptyPose(), gaitPhase: 1.234, strideAmount: 0.7 };
    expect(poseSignature(pose)).toBe(poseSignature({ ...pose }));
  });
});

describe('every scripted move', () => {
  // **"Reachable" is not the same as "intended".** The pose used to be typed against the wider
  // `ManeuverKind` union, so it branched on four kinds that are events rather than moves and could
  // never occur. Typing it as `ScriptedMove` makes the compiler prove the branches are live; this
  // table says what each live branch should *produce*, so a future move cannot quietly inherit the
  // wrong limbs.
  const MOVES: readonly ScriptedMove[] = ['mantle', 'pull-up', 'roll', 'vault', 'kong-vault'];

  for (const move of MOVES) {
    it(`poses ${move} with the limbs that move implies`, () => {
      const state = onDeck();
      state.grounded = false;
      state.maneuver = maneuver(move);
      const pose = poseOf(state);

      expect(pose.maneuver).toBe(move);
      if (move === 'roll') {
        // A roll is the one move that tucks the arms: the body goes over itself.
        expect(pose.armAction).toBe('tucked');
      } else {
        // Everything else reaches - hands forward and up, over or onto something.
        expect(pose.armAction).toBe('reach');
      }
      expect(pose.legAction).toBe('tuck');
    });
  }
});
