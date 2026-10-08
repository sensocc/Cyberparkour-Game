/**
 * The movement state machine.
 *
 * V0.1 had one movement mode, V0.2 six, and V0.3 more again, all resolved by an
 * ad-hoc priority chain at the top of `stepPlayer`. V0.4 makes the modes an
 * explicit machine rather than a growing `if` ladder:
 *
 *  - `deriveMotionState` is the *one* place that decides what the player is
 *    doing, from their flags. Nothing else may guess.
 *  - `MOTION_TRANSITIONS` states which moves are legal, so "what the state is"
 *    and "what it may become" are written down in the same breath.
 *  - `MotionTracker` records the moves between states across ticks.
 *
 * Why a table and not just the chain? Because the chain only says what the state
 * *is*. A change that let a wall run turn straight into a climb would be one line
 * that no obvious unit test would catch - but it is an *illegal transition*, and
 * the simulation test that drives the district asserts every move it makes is a
 * legal one. The graph is the regression guard.
 *
 * Kept free of any gameplay imports beyond types, so it is trivially testable and
 * cannot itself move the player.
 */

/** A scripted, non-simulated move. The same set as `ScriptedMove` in `player.ts`. */
export type ScriptedMotion = 'mantle' | 'pull-up' | 'roll' | 'vault' | 'kong-vault';

/** Everything the player can be doing. */
export type MotionState =
  | 'grounded'
  | 'airborne'
  | 'sliding'
  | 'wall-running'
  | 'mantling'
  | 'pulling-up'
  | 'vaulting'
  | 'rolling'
  | 'hanging'
  | 'climbing'
  | 'piping'
  | 'dead';

/**
 * The subset of player state the machine reads.
 *
 * A structural view rather than `PlayerState` itself, so the machine never
 * depends on the player and the two files cannot import each other at runtime.
 */
export interface MotionView {
  readonly alive: boolean;
  readonly maneuver: { readonly kind: ScriptedMotion } | null;
  readonly hangId: string | null;
  readonly climbId: string | null;
  readonly pipeId: string | null;
  readonly wallId: string | null;
  readonly sliding: boolean;
  readonly grounded: boolean;
}

/** Which locomotion each scripted move reports as. */
const SCRIPTED_MOTION: Readonly<Record<ScriptedMotion, MotionState>> = {
  mantle: 'mantling',
  'pull-up': 'pulling-up',
  roll: 'rolling',
  vault: 'vaulting',
  'kong-vault': 'vaulting',
};

/**
 * The legal one-tick transitions.
 *
 * A state is always allowed to stay put - "grounded to grounded" is not a move -
 * so a state never needs to list itself. `dead` goes to the air because a respawn
 * drops the player in slightly above a surface and gravity takes it from there.
 */
export const MOTION_TRANSITIONS: Readonly<Record<MotionState, readonly MotionState[]>> = {
  dead: ['airborne', 'grounded'],
  // On the ground you may leave it, commit to a slide, or start any of the
  // ground-launched moves. Grabbing needs air, and a roll needs a landing.
  grounded: ['airborne', 'sliding', 'mantling', 'vaulting', 'climbing', 'piping', 'dead'],
  // In the air you may land, catch a ledge, take a wall, roll out of the landing,
  // or start a wall run.
  airborne: ['grounded', 'hanging', 'wall-running', 'rolling', 'dead'],
  // A slide ends on the ground, carries off an edge, or runs into something it
  // can mantle or vault.
  sliding: ['grounded', 'airborne', 'mantling', 'vaulting', 'dead'],
  // A wall run ends in the air, on the ground, or off the level.
  'wall-running': ['airborne', 'grounded', 'dead'],
  // Every scripted move ends back on its feet - or over a void, in which case it
  // ends airborne.
  mantling: ['grounded', 'airborne', 'dead'],
  'pulling-up': ['grounded', 'airborne', 'dead'],
  vaulting: ['grounded', 'airborne', 'dead'],
  rolling: ['grounded', 'airborne', 'dead'],
  // A hang hauls up, lets go, or settles onto the ledge if it is low enough.
  hanging: ['pulling-up', 'airborne', 'grounded', 'dead'],
  // Climbing tops out into a mantle, or lets go into the air.
  climbing: ['mantling', 'airborne', 'grounded', 'dead'],
  // A pipe tops out into a mantle, or lets go into the air.
  piping: ['mantling', 'airborne', 'grounded', 'dead'],
};

/** The single source of truth for "what is the player doing right now". */
export function deriveMotionState(view: MotionView): MotionState {
  if (!view.alive) return 'dead';
  if (view.maneuver) return SCRIPTED_MOTION[view.maneuver.kind];
  if (view.hangId !== null) return 'hanging';
  if (view.climbId !== null) return 'climbing';
  if (view.pipeId !== null) return 'piping';
  if (view.wallId !== null) return 'wall-running';
  if (view.sliding) return 'sliding';
  if (!view.grounded) return 'airborne';
  return 'grounded';
}

/** Whether a state may move straight to another in one tick. */
export function isLegalTransition(from: MotionState, to: MotionState): boolean {
  if (from === to) return true;
  return MOTION_TRANSITIONS[from].includes(to);
}

/** A transition the machine forbids. Reported rather than thrown in play. */
export interface IllegalTransition {
  readonly from: MotionState;
  readonly to: MotionState;
}

/**
 * Follows the player's state across ticks and records the moves between them.
 *
 * Deliberately passive: it observes, it never drives. The step functions still
 * decide what happens; the tracker only says what changed and whether the change
 * was one the graph allows, which is what the audio and the tests consume.
 */
export class MotionTracker {
  private current: MotionState | null = null;

  /** The last observed state, or `null` before the first update. */
  get state(): MotionState | null {
    return this.current;
  }

  /**
   * Observes one tick.
   *
   * @returns the state, the state it came from, whether it changed, and - when a
   * transition happened - whether the graph permits it.
   */
  update(view: MotionView): {
    readonly state: MotionState;
    readonly from: MotionState | null;
    readonly changed: boolean;
    readonly illegal: IllegalTransition | null;
  } {
    const state = deriveMotionState(view);
    const from = this.current;
    const changed = from !== null && from !== state;
    const illegal = changed && from !== null && !isLegalTransition(from, state)
      ? { from, to: state }
      : null;
    this.current = state;
    return { state, from, changed, illegal };
  }

  reset(): void {
    this.current = null;
  }
}
