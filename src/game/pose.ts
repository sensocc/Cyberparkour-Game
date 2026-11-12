/**
 * A description of what the player's *body* is doing, for the renderer.
 *
 * The body is a first-person one: you see your own chest, arms and legs when you
 * look down, and it casts a shadow on the world. That means every frame needs a
 * description of the pose - which is what this is - and the renderer needs to be
 * able to apply it without knowing anything about movement, physics or state
 * machines.
 *
 * That split is the whole point of the file. Everything here is *derived data*:
 * a gait phase, a lean, a stride amount, which limb is doing what. It is pure, so
 * the animation can be tested without a renderer, and the renderer can be tested
 * without a physical simulation.
 */

import type { GameConfig } from '../core/config.js';

import {
  horizontalSpeed,
  locomotion,
  stance,
  type Locomotion,
  type PlayerState,
  type ScriptedMove,
  type Stance,
} from './player.js';

/** What the arms are doing. */
export type ArmAction = 'swing' | 'reach' | 'overhead' | 'hanging' | 'tucked' | 'relaxed' | 'phone';

/** What the legs are doing. */
export type LegAction = 'stride' | 'tuck' | 'hang' | 'brace';

/** Everything the body's animation needs. */
export interface PlayerPose {
  /**
   * Gait phase in radians: one full cycle per stride.
   *
   * The phase *at the moment being drawn*, which is not the phase of the last
   * simulation step: the renderer draws between steps, and a gait that only moves when
   * the simulation does is a gait that stutters on a fast display.
   */
  gaitPhase: number;
  /**
   * How much of the stride to apply, 0..1.
   *
   * Separate from the phase because the phase keeps advancing with distance while
   * the *stride* fades in and out: a stopped player is mid-step, not reset.
   */
  strideAmount: number;
  /** 0 standing, 1 fully crouched. */
  crouchAmount: number;
  /** Horizontal speed as a fraction of a full sprint, 0..1. */
  speedFraction: number;
  stance: Stance;
  locomotion: Locomotion;
  airborne: boolean;
  grounded: boolean;
  alive: boolean;
  sliding: boolean;
  /**
   * The scripted move in progress, if any.
   *
   * **`ScriptedMove`, not `ManeuverKind`.** The two used to be the same union, which conflated two
   * different things: `ManeuverKind` is the set of *events* the simulation reports (a slide starts,
   * a wall-run ends) and all eleven are legitimate there; `state.maneuver.kind` is the scripted path
   * currently being interpolated, and only five are ever constructed. Typing this as the wider union
   * made `pose.ts` branch on `'climb'`, `'slide'`, `'hang'` and `'wall-run'` - four conditions that
   * could never be true, and which hid the fact that a ladder climb and a walking stride could be
   * combined into a pose no body should make.
   */
  maneuver: ScriptedMove | null;
  /** How far through that move, 0..1. */
  maneuverProgress: number;
  /** Which side a wall is on, for the lean: -1 left, 1 right, 0 head-on. */
  wallSide: -1 | 0 | 1;
  /** Whether the player is on a pipe, and how far into a climb. */
  piping: boolean;
  /** Which way a pipe crawl is going: -1 down, 0 held still, 1 up. */
  pipeDirection: -1 | 0 | 1;
  armAction: ArmAction;
  legAction: LegAction;
  /** Forward lean of the torso in radians, for a sprint. */
  lean: number;
}

/**
 * A cheap fingerprint of everything that changes the body's *shape*.
 *
 * **Why this exists.** The view decides whether the shadow map needs redrawing by asking "did the
 * body change shape since the last frame", and it used to answer that by comparing five hand-picked
 * scalars. The body's silhouette is also changed by `armAction`, `legAction`, `wallSide`,
 * `pipeDirection` and `stance` - so a player grabbing a ledge went from swinging arms and striding
 * legs to straight arms and trailing legs, and the shadow kept the old pose until something else
 * happened to move.
 *
 * A list of fields to compare is a list that rots the moment a field is added, so the list lives
 * here, next to the fields, and the view compares one string. `gaitPhase` is included because the
 * stride's phase moves the legs even when the amount does not.
 */
export function poseSignature(pose: PlayerPose): string {
  return (
    `${pose.armAction}|${pose.legAction}|${pose.stance}|${pose.locomotion}|` +
    `${pose.wallSide}|${pose.pipeDirection}|${pose.maneuver ?? '-'}|` +
    `${pose.crouchAmount.toFixed(4)}|${pose.strideAmount.toFixed(4)}|` +
    `${pose.gaitPhase.toFixed(4)}|${pose.lean.toFixed(4)}|${pose.maneuverProgress.toFixed(4)}`
  );
}

/** A pose with every field at rest. */
export function emptyPose(): PlayerPose {
  return {
    gaitPhase: 0,
    strideAmount: 0,
    crouchAmount: 0,
    speedFraction: 0,
    stance: 'standing',
    locomotion: 'grounded',
    airborne: false,
    grounded: true,
    alive: true,
    sliding: false,
    maneuver: null,
    maneuverProgress: 0,
    wallSide: 0,
    piping: false,
    pipeDirection: 0,
    armAction: 'swing',
    legAction: 'stride',
    lean: 0,
  };
}

/**
 * Derives the pose from the player's state.
 *
 * Fills `out` when given one, because the game calls this every frame and the render
 * path is one of the few places here where an allocation matters.
 *
 * The *actions* - which way the arms are reaching - are decided here rather than in
 * the renderer, because "a vault reaches forward with both hands" is a fact about
 * the manoeuvre, and not about how a shoulder happens to be drawn.
 */
export function describePose(
  state: PlayerState,
  config: GameConfig,
  out: PlayerPose = emptyPose(),
  gaitPhase: number = state.bobPhase,
): PlayerPose {
  const maneuver = state.maneuver?.kind ?? null;
  const piping = state.pipeId !== null;
  const crouchAmount = state.crouching ? 1 : 0;
  const speedFraction = Math.min(1, horizontalSpeed(state) / Math.max(1e-6, config.player.sprintSpeed));

  out.gaitPhase = gaitPhase;
  // The bob amount is already the game's own answer to "how much is this player
  // moving", faded in and out rather than switched, so the legs want exactly the
  // same answer rather than a second opinion.
  out.strideAmount = state.alive ? state.bobAmount * (state.grounded ? 1 : 0.35) : 0;
  out.crouchAmount = crouchAmount;
  out.speedFraction = speedFraction;
  out.stance = stance(state);
  out.locomotion = locomotion(state);
  out.airborne = !state.grounded;
  out.grounded = state.grounded;
  out.alive = state.alive;
  out.sliding = state.sliding;
  out.maneuver = maneuver;
  out.maneuverProgress =
    state.maneuver && state.maneuver.durationSeconds > 0
      ? Math.min(1, Math.max(0, state.maneuver.elapsed / state.maneuver.durationSeconds))
      : 0;
  out.wallSide = wallSideOf(state);
  out.piping = piping;
  out.pipeDirection = !piping ? 0 : state.pipeDirection < 0 ? -1 : state.pipeDirection > 0 ? 1 : 0;
  out.armAction = armActionFor(state, maneuver, piping);
  out.legAction = legActionFor(state, maneuver, piping);
  // A runner leans into their speed. Crouching and sliding fold the body forward far
  // more than speed ever does, and a body that has stopped being alive is limp.
  out.lean =
    (state.sliding ? 0.5 : crouchAmount * 0.42 + speedFraction * 0.16) * (state.alive ? 1 : 0.4);

  return out;
}

function armActionFor(state: PlayerState, maneuver: ScriptedMove | null, piping: boolean): ArmAction {
  if (!state.alive) return 'relaxed';
  if (state.hangId !== null) return 'hanging';
  if (piping) return 'reach';
  // Every scripted move but the roll reaches: a mantle, a pull-up, a vault and a Kong vault are all
  // "hands forward and up". The roll tucks instead, because the body is going over itself.
  if (maneuver === 'roll') return 'tucked';
  if (maneuver !== null) return 'reach';
  if (state.climbId !== null) return 'overhead';
  return 'swing';
}

function legActionFor(state: PlayerState, maneuver: ScriptedMove | null, piping: boolean): LegAction {
  if (!state.alive) return 'hang';
  if (piping || state.hangId !== null) return 'hang';
  // Every scripted move tucks the legs: they are all a body going up and over something.
  if (maneuver !== null) return 'tuck';
  // **A ladder is not a walk.** This used to fall through to `stride` whenever the player was
  // grounded, so a player on a ladder with their feet on the bottom rung got arms straight up and
  // legs walking - a combination no body makes. Climbing is checked before the grounded case now.
  if (state.climbId !== null) return 'hang';
  if (!state.grounded) return state.wallId !== null ? 'brace' : 'hang';
  return 'stride';
}

/** Which side a wall is on, in the player's own frame. */
function wallSideOf(state: PlayerState): -1 | 0 | 1 {
  if (state.wallId === null) return 0;
  const cos = Math.cos(state.yaw);
  const sin = Math.sin(state.yaw);
  // The player's right axis for a yaw of `yaw`, matching `yawBasis`.
  const rightX = cos;
  const rightZ = -sin;
  const sideways = state.wallNormal.x * rightX + state.wallNormal.z * rightZ;
  if (Math.abs(sideways) < 0.25) return 0;
  return sideways > 0 ? -1 : 1;
}
