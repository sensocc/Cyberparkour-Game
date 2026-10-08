/**
 * The movement state machine.
 *
 * V0.4's whole point for movement was to stop the modes being an ad-hoc chain:
 * one function decides the state, and a table says which transitions are legal.
 * These tests pin both, and check that the graph is a real one - every state is
 * reachable, and the transitions that should be impossible are.
 */

import { describe, expect, it } from 'vitest';

import {
  MOTION_TRANSITIONS,
  MotionTracker,
  deriveMotionState,
  isLegalTransition,
  type MotionState,
  type MotionView,
} from '../../src/game/movement.js';

const BASE: MotionView = {
  alive: true,
  maneuver: null,
  hangId: null,
  climbId: null,
  pipeId: null,
  wallId: null,
  sliding: false,
  grounded: true,
};

const view = (overrides: Partial<MotionView> = {}): MotionView => ({ ...BASE, ...overrides });

const STATES = Object.keys(MOTION_TRANSITIONS) as MotionState[];

describe('deriveMotionState', () => {
  it('is grounded by default', () => {
    expect(deriveMotionState(view())).toBe('grounded');
  });

  it('is dead whenever the player is not alive, whatever else is set', () => {
    expect(deriveMotionState(view({ alive: false }))).toBe('dead');
    expect(deriveMotionState(view({ alive: false, wallId: 'w', sliding: true }))).toBe('dead');
  });

  it('names each scripted move after itself', () => {
    expect(deriveMotionState(view({ maneuver: { kind: 'mantle' } }))).toBe('mantling');
    expect(deriveMotionState(view({ maneuver: { kind: 'pull-up' } }))).toBe('pulling-up');
    expect(deriveMotionState(view({ maneuver: { kind: 'roll' } }))).toBe('rolling');
    expect(deriveMotionState(view({ maneuver: { kind: 'vault' } }))).toBe('vaulting');
    // A Kong vault is a vault as far as locomotion is concerned.
    expect(deriveMotionState(view({ maneuver: { kind: 'kong-vault' } }))).toBe('vaulting');
  });

  it('resolves the flags by priority', () => {
    expect(deriveMotionState(view({ hangId: 'a' }))).toBe('hanging');
    expect(deriveMotionState(view({ climbId: 'a' }))).toBe('climbing');
    expect(deriveMotionState(view({ pipeId: 'a' }))).toBe('piping');
    expect(deriveMotionState(view({ wallId: 'a', grounded: false }))).toBe('wall-running');
    expect(deriveMotionState(view({ sliding: true }))).toBe('sliding');
    expect(deriveMotionState(view({ grounded: false }))).toBe('airborne');

    // A scripted move owns the body, so it wins over everything below it.
    expect(deriveMotionState(view({ maneuver: { kind: 'mantle' }, hangId: 'a' }))).toBe('mantling');
    // A hang wins over a climb, and a climb over a pipe, and a pipe over a wall.
    expect(deriveMotionState(view({ hangId: 'a', climbId: 'b', pipeId: 'c', wallId: 'd' }))).toBe('hanging');
    expect(deriveMotionState(view({ climbId: 'b', pipeId: 'c', wallId: 'd' }))).toBe('climbing');
    expect(deriveMotionState(view({ pipeId: 'c', wallId: 'd' }))).toBe('piping');
    expect(deriveMotionState(view({ wallId: 'd', grounded: false }))).toBe('wall-running');
  });

  it('covers every state in the graph', () => {
    // If a caller can be in a state, the graph must know about it. This catches a
    // new mode being added to the union but not to the table.
    const derived: MotionState[] = [
      deriveMotionState(view({ alive: false })),
      deriveMotionState(view()),
      deriveMotionState(view({ grounded: false })),
      deriveMotionState(view({ sliding: true })),
      deriveMotionState(view({ wallId: 'w', grounded: false })),
      deriveMotionState(view({ hangId: 'h' })),
      deriveMotionState(view({ climbId: 'c' })),
      deriveMotionState(view({ pipeId: 'p' })),
      deriveMotionState(view({ maneuver: { kind: 'mantle' } })),
      deriveMotionState(view({ maneuver: { kind: 'pull-up' } })),
      deriveMotionState(view({ maneuver: { kind: 'vault' } })),
      deriveMotionState(view({ maneuver: { kind: 'roll' } })),
    ];
    expect(new Set(derived).size).toBe(STATES.length);
  });
});

describe('the transition graph', () => {
  it('only lists states the machine knows', () => {
    for (const [from, tos] of Object.entries(MOTION_TRANSITIONS)) {
      for (const to of tos) {
        expect(STATES, `${from} -> ${to}`).toContain(to);
      }
    }
  });

  it('never lists a state as its own successor', () => {
    // Staying put is not a transition, so the table need not (and should not)
    // spell it out.
    for (const [from, tos] of Object.entries(MOTION_TRANSITIONS)) {
      expect(tos, from).not.toContain(from);
    }
  });

  it('lets every state stay where it is, but nothing random', () => {
    for (const state of STATES) {
      expect(isLegalTransition(state, state), state).toBe(true);
    }
    expect(isLegalTransition('grounded', 'wall-running')).toBe(false);
    expect(isLegalTransition('sliding', 'pulling-up')).toBe(false);
    expect(isLegalTransition('wall-running', 'climbing')).toBe(false);
  });

  it('allows the moves the game actually makes', () => {
    // A handful of the transitions the abilities rely on.
    expect(isLegalTransition('grounded', 'sliding')).toBe(true);
    expect(isLegalTransition('grounded', 'piping')).toBe(true);
    expect(isLegalTransition('airborne', 'wall-running')).toBe(true);
    expect(isLegalTransition('airborne', 'hanging')).toBe(true);
    expect(isLegalTransition('airborne', 'rolling')).toBe(true);
    expect(isLegalTransition('hanging', 'pulling-up')).toBe(true);
    expect(isLegalTransition('climbing', 'mantling')).toBe(true);
    expect(isLegalTransition('piping', 'mantling')).toBe(true);
    expect(isLegalTransition('dead', 'airborne')).toBe(true);
  });

  it('reaches every state from the ground', () => {
    // A state nothing can reach is dead code in the graph, or a missing
    // transition somewhere else.
    const seen = new Set<MotionState>(['grounded']);
    const queue: MotionState[] = ['grounded'];
    while (queue.length > 0) {
      const state = queue.shift() as MotionState;
      for (const next of MOTION_TRANSITIONS[state]) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    expect([...STATES].filter((state) => !seen.has(state))).toEqual([]);
  });
});

describe('MotionTracker', () => {
  it('reports the state, and remembers where it came from', () => {
    const tracker = new MotionTracker();
    expect(tracker.state).toBeNull();

    const first = tracker.update(view());
    expect(first).toMatchObject({ state: 'grounded', from: null, changed: false, illegal: null });

    const second = tracker.update(view({ grounded: false }));
    expect(second).toMatchObject({ state: 'airborne', from: 'grounded', changed: true, illegal: null });
    expect(tracker.state).toBe('airborne');
  });

  it('does not call standing still a change', () => {
    const tracker = new MotionTracker();
    tracker.update(view());
    const again = tracker.update(view());
    expect(again.changed).toBe(false);
  });

  it('flags a transition the graph forbids', () => {
    // The tracker is an observer: it reports, it does not stop the player. This
    // is the hook a release build could turn into an assertion.
    const tracker = new MotionTracker();
    tracker.update(view({ sliding: true }));
    const bad = tracker.update(view());
    expect(bad).toMatchObject({ state: 'grounded', from: 'sliding' });
    // Sliding to grounded is legal, so this one is fine...
    expect(bad.illegal).toBeNull();

    // ...but jumping straight from a slide to a pull-up is not.
    tracker.update(view({ sliding: true }));
    const illegal = tracker.update(view({ hangId: 'ledge' }));
    expect(illegal.illegal).toEqual({ from: 'sliding', to: 'hanging' });
  });

  it('can be reset, for a respawn or a restart', () => {
    const tracker = new MotionTracker();
    tracker.update(view({ grounded: false }));
    tracker.reset();
    expect(tracker.state).toBeNull();
    expect(tracker.update(view()).from).toBeNull();
  });
});
