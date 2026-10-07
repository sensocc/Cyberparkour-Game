import { describe, expect, it } from 'vitest';

import { DEFAULT_BINDINGS, actionForKey, isUiAction } from '../../src/input/bindings.js';
import { InputState } from '../../src/input/inputState.js';

/** The movement axes only; the sprint/jump/crouch flags are tested separately. */
function axes(input: { forward: number; right: number }): { forward: number; right: number } {
  return { forward: input.forward, right: input.right };
}

describe('bindings', () => {
  it('binds WASD and the arrow keys to movement', () => {
    expect(DEFAULT_BINDINGS.moveForward).toEqual(['KeyW', 'ArrowUp']);
    expect(DEFAULT_BINDINGS.moveBackward).toEqual(['KeyS', 'ArrowDown']);
    expect(DEFAULT_BINDINGS.moveLeft).toEqual(['KeyA', 'ArrowLeft']);
    expect(DEFAULT_BINDINGS.moveRight).toEqual(['KeyD', 'ArrowRight']);
  });

  it('identifies UI actions', () => {
    expect(isUiAction('toggleDebug')).toBe(true);
    expect(isUiAction('pause')).toBe(true);
    expect(isUiAction('restart')).toBe(true);
    expect(isUiAction('moveForward')).toBe(false);
  });

  it('resolves a key code back to its action', () => {
    expect(actionForKey(DEFAULT_BINDINGS, 'KeyW')).toBe('moveForward');
    expect(actionForKey(DEFAULT_BINDINGS, 'ArrowLeft')).toBe('moveLeft');
    expect(actionForKey(DEFAULT_BINDINGS, 'KeyZ')).toBeNull();
  });
});

describe('InputState movement', () => {
  it('reports no input when nothing is held', () => {
    const input = new InputState();
    expect(axes(input.moveInput)).toEqual({ forward: 0, right: 0 });
    expect(input.heldKeyCount).toBe(0);
  });

  it('maps held keys onto movement axes', () => {
    const input = new InputState();

    input.keyDown('KeyW');
    expect(axes(input.moveInput)).toEqual({ forward: 1, right: 0 });

    input.keyDown('KeyD');
    expect(axes(input.moveInput)).toEqual({ forward: 1, right: 1 });

    input.keyDown('KeyS');
    expect(axes(input.moveInput)).toEqual({ forward: 0, right: 1 });

    input.keyDown('KeyA');
    expect(axes(input.moveInput)).toEqual({ forward: 0, right: 0 });
  });

  it('cancels opposing keys', () => {
    const input = new InputState();
    input.keyDown('KeyW');
    input.keyDown('ArrowUp');
    expect(input.moveInput.forward).toBe(1);

    input.keyDown('KeyS');
    expect(input.moveInput.forward).toBe(0);
  });

  it('treats arrow keys as aliases for WASD', () => {
    const input = new InputState();
    input.keyDown('ArrowUp');
    input.keyDown('ArrowRight');
    expect(axes(input.moveInput)).toEqual({ forward: 1, right: 1 });
  });

  it('releases keys on keyUp', () => {
    const input = new InputState();
    input.keyDown('KeyW');
    input.keyUp('KeyW');
    expect(input.moveInput.forward).toBe(0);
    expect(input.isActionPressed('moveForward')).toBe(false);
  });

  it('ignores unbound keys', () => {
    const input = new InputState();
    input.keyDown('KeyQ');
    input.keyDown('KeyZ');
    expect(axes(input.moveInput)).toEqual({ forward: 0, right: 0 });
    expect(input.isPressed('KeyQ')).toBe(true);
    expect(input.heldKeyCount).toBe(2);
  });

  it('supports a custom binding table', () => {
    const input = new InputState({
      ...DEFAULT_BINDINGS,
      moveForward: ['KeyI'],
      moveBackward: ['KeyK'],
    });
    input.keyDown('KeyI');
    expect(input.moveInput.forward).toBe(1);
    // The old binding is gone.
    input.keyUp('KeyI');
    input.keyDown('KeyW');
    expect(input.moveInput.forward).toBe(0);
  });
});

describe('InputState ability flags', () => {
  it('reports sprint, jump and crouch as held states', () => {
    const input = new InputState();
    expect(input.moveInput.sprint).toBe(false);
    expect(input.moveInput.jump).toBe(false);
    expect(input.moveInput.crouch).toBe(false);

    input.keyDown('ShiftLeft');
    input.keyDown('Space');
    input.keyDown('ControlLeft');

    expect(input.moveInput).toMatchObject({ sprint: true, jump: true, crouch: true });
  });

  it('accepts either shift as sprint', () => {
    const input = new InputState();
    input.keyDown('ShiftRight');
    expect(input.moveInput.sprint).toBe(true);
  });

  it('accepts C as an alternative crouch key', () => {
    const input = new InputState();
    input.keyDown('KeyC');
    expect(input.moveInput.crouch).toBe(true);
  });

  it('releases the flags with the keys', () => {
    const input = new InputState();
    input.keyDown('ShiftLeft');
    input.keyDown('Space');
    input.keyUp('ShiftLeft');
    input.keyUp('Space');

    expect(input.moveInput).toMatchObject({ sprint: false, jump: false });
  });

  it('never queues sprint, jump or crouch as UI actions', () => {
    const input = new InputState();
    input.keyDown('ShiftLeft');
    input.keyDown('Space');
    input.keyDown('ControlLeft');
    expect(input.consumeActions()).toEqual([]);
  });
});

describe('InputState pointer deltas', () => {
  it('accumulates and then consumes motion exactly once', () => {
    const input = new InputState();
    input.addPointerDelta(3, -4);
    input.addPointerDelta(2, 1);

    expect(input.consumePointerDelta()).toEqual({ dx: 5, dy: -3 });
    expect(input.consumePointerDelta()).toEqual({ dx: 0, dy: 0 });
  });

  it('ignores non-finite motion', () => {
    const input = new InputState();
    input.addPointerDelta(Number.NaN, 1);
    input.addPointerDelta(1, Number.POSITIVE_INFINITY);
    expect(input.consumePointerDelta()).toEqual({ dx: 0, dy: 0 });
  });
});

describe('InputState action queue', () => {
  it('queues a UI action once per press', () => {
    const input = new InputState();
    input.keyDown('F3');
    expect(input.consumeActions()).toEqual(['toggleDebug']);
    expect(input.consumeActions()).toEqual([]);
  });

  it('does not queue an action for a held-key repeat event', () => {
    const input = new InputState();
    input.keyDown('F3');
    input.keyDown('F3', true);
    input.keyDown('F3', true);
    expect(input.consumeActions()).toEqual(['toggleDebug']);
  });

  it('never queues movement keys', () => {
    const input = new InputState();
    input.keyDown('KeyW');
    input.keyDown('KeyD');
    expect(input.consumeActions()).toEqual([]);
  });

  it('preserves ordering across several keys', () => {
    const input = new InputState();
    input.keyDown('KeyR');
    input.keyDown('Escape');
    input.keyDown('Backquote');
    expect(input.consumeActions()).toEqual(['restart', 'pause', 'toggleDebug']);
  });

  it('records a press that is released before it is drained', () => {
    const input = new InputState();
    input.keyDown('KeyR');
    input.keyUp('KeyR');
    // The key is no longer held, but the intent must not be lost.
    expect(input.consumeActions()).toEqual(['restart']);
    expect(input.isPressed('KeyR')).toBe(false);
  });
});

describe('InputState.clear', () => {
  it('drops held keys, queued actions and pointer motion', () => {
    const input = new InputState();
    input.keyDown('KeyW');
    input.keyDown('F3');
    input.addPointerDelta(10, 10);

    input.clear();

    expect(input.heldKeyCount).toBe(0);
    expect(axes(input.moveInput)).toEqual({ forward: 0, right: 0 });
    expect(input.consumeActions()).toEqual([]);
    expect(input.consumePointerDelta()).toEqual({ dx: 0, dy: 0 });
  });
});
