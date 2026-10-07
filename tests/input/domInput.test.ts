// @vitest-environment jsdom
//
// The DOM input layer is the browser boundary: keyboard, pointer lock and focus
// handling. jsdom lacks the Pointer Lock API, so the tests install it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DomInput } from '../../src/input/domInput.js';
import { latestLog } from '../helpers/logs.js';
import { InputState } from '../../src/input/inputState.js';

interface Harness {
  readonly input: InputState;
  readonly target: HTMLElement;
  readonly domInput: DomInput;
  readonly lockChanges: boolean[];
}

function createHarness(installPointerLock = true): Harness {
  document.body.innerHTML = '';
  const target = document.createElement('div');
  document.body.append(target);

  if (installPointerLock) {
    Object.defineProperty(target, 'requestPointerLock', {
      configurable: true,
      value: vi.fn(),
    });
  }

  const input = new InputState();
  const lockChanges: boolean[] = [];
  const domInput = new DomInput({
    target,
    input,
    onPointerLockChange: (locked) => lockChanges.push(locked),
  });

  return { input, target, domInput, lockChanges };
}

function keydown(code: string, repeat = false): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { code, repeat, bubbles: true, cancelable: true });
  window.dispatchEvent(event);
  return event;
}

function keyup(code: string): void {
  window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
}

/** Stands in for `document.pointerLockElement`, which jsdom does not define. */
function pretendLocked(element: Element | null): void {
  Object.defineProperty(document, 'pointerLockElement', {
    configurable: true,
    get: () => element,
  });
}

let harness: Harness;

beforeEach(() => {
  harness = createHarness();
  harness.domInput.attach();
});

afterEach(() => {
  harness.domInput.detach();
  Reflect.deleteProperty(document, 'pointerLockElement');
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('DomInput keyboard', () => {
  it('feeds key-down and key-up into the input state', () => {
    keydown('KeyW');
    expect(harness.input.moveInput.forward).toBe(1);

    keyup('KeyW');
    expect(harness.input.moveInput.forward).toBe(0);
  });

  it('prevents the browser default only for keys the game binds', () => {
    expect(keydown('KeyW').defaultPrevented).toBe(true);
    expect(keydown('ArrowUp').defaultPrevented).toBe(true);
    expect(keydown('F3').defaultPrevented).toBe(true);
    expect(keydown('Escape').defaultPrevented).toBe(true);
    // Browser shortcuts must survive untouched.
    expect(keydown('KeyZ').defaultPrevented).toBe(false);
    expect(keydown('F5').defaultPrevented).toBe(false);
    expect(keydown('F12').defaultPrevented).toBe(false);
  });

  it('passes the repeat flag through so held-key actions do not re-fire', () => {
    keydown('F3');
    keydown('F3', true);
    expect(harness.input.consumeActions()).toEqual(['toggleDebug']);
  });

  it('queues a UI action for the game to drain', () => {
    keydown('KeyR');
    expect(harness.input.consumeActions()).toEqual(['restart']);
  });

  it('releases everything when the window loses focus', () => {
    keydown('KeyW');
    keydown('KeyD');
    expect(harness.input.heldKeyCount).toBe(2);

    // Alt-tabbing while holding a key must not leave the player walking.
    window.dispatchEvent(new Event('blur'));

    expect(harness.input.heldKeyCount).toBe(0);
    expect(harness.input.moveInput).toEqual({ forward: 0, right: 0 });
  });
});

describe('DomInput mouse look', () => {
  it('ignores mouse motion while pointer lock is not held', () => {
    pretendLocked(null);
    document.dispatchEvent(new MouseEvent('mousemove', { movementX: 10, movementY: 10 }));
    expect(harness.input.consumePointerDelta()).toEqual({ dx: 0, dy: 0 });
  });

  it('accumulates mouse motion while pointer lock is held', () => {
    pretendLocked(harness.target);
    document.dispatchEvent(new MouseEvent('mousemove', { movementX: 7, movementY: -3 }));
    document.dispatchEvent(new MouseEvent('mousemove', { movementX: 2, movementY: 1 }));

    expect(harness.input.consumePointerDelta()).toEqual({ dx: 9, dy: -2 });
  });

  it('stops collecting motion once the lock is released again', () => {
    pretendLocked(harness.target);
    document.dispatchEvent(new MouseEvent('mousemove', { movementX: 5, movementY: 0 }));
    expect(harness.input.consumePointerDelta().dx).toBe(5);

    pretendLocked(null);
    document.dispatchEvent(new MouseEvent('mousemove', { movementX: 5, movementY: 0 }));
    expect(harness.input.consumePointerDelta().dx).toBe(0);
  });
});

describe('DomInput pointer lock lifecycle', () => {
  it('reports a granted lock and keeps keys held', () => {
    keydown('KeyW');
    pretendLocked(harness.target);
    document.dispatchEvent(new Event('pointerlockchange'));

    expect(harness.lockChanges).toEqual([true]);
    expect(harness.input.heldKeyCount).toBe(1);
  });

  it('reports a lost lock and releases keys', () => {
    keydown('KeyW');
    pretendLocked(null);
    document.dispatchEvent(new Event('pointerlockchange'));

    expect(harness.lockChanges).toEqual([false]);
    expect(harness.input.heldKeyCount).toBe(0);
  });

  it('requestPointerLock is a no-op when lock is already held', () => {
    pretendLocked(harness.target);
    harness.domInput.requestPointerLock();
    expect(harness.target.requestPointerLock).not.toHaveBeenCalled();
  });

  it('requestPointerLock calls through when supported', () => {
    pretendLocked(null);
    harness.domInput.requestPointerLock();
    expect(harness.target.requestPointerLock).toHaveBeenCalledOnce();
  });

  it('keeps a rejected request alive without reporting a lock loss', async () => {
    Object.defineProperty(harness.target, 'requestPointerLock', {
      configurable: true,
      value: vi.fn(() => Promise.reject(new Error('not a user gesture'))),
    });

    harness.domInput.requestPointerLock();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // A refusal is not a loss: the game must not pause because of it.
    expect(harness.lockChanges).toEqual([]);
    expect(latestLog()?.message).toContain('pointer lock request rejected');
  });

  it('reports pointer lock as unsupported rather than pretending it failed', () => {
    const unsupported = createHarness(false);
    expect(unsupported.domInput.pointerLockSupported).toBe(false);

    const callback = vi.fn();
    const domInput = new DomInput({ target: unsupported.target, input: unsupported.input, onPointerLockChange: callback });

    domInput.requestPointerLock();

    expect(callback).not.toHaveBeenCalled();
    expect(latestLog()?.message).toContain('not supported here');
  });

  it('treats a pointer-lock error event as a refusal, not a loss', () => {
    document.dispatchEvent(new Event('pointerlockerror'));

    expect(harness.lockChanges).toEqual([]);
    expect(latestLog()?.message).toContain('pointer lock was refused');
  });

  it('exitPointerLock does nothing when lock is not held', () => {
    pretendLocked(null);
    expect(() => harness.domInput.exitPointerLock()).not.toThrow();
  });

  it('exitPointerLock survives an environment without the API', () => {
    pretendLocked({} as unknown as Element);
    expect(() => harness.domInput.exitPointerLock()).not.toThrow();
  });

  it('reports lock state from the document', () => {
    pretendLocked(harness.target);
    expect(harness.domInput.pointerLocked).toBe(true);

    pretendLocked(document.body);
    expect(harness.domInput.pointerLocked).toBe(false);

    pretendLocked(null);
    expect(harness.domInput.pointerLocked).toBe(false);
  });
});

describe('DomInput attach and detach', () => {
  it('attach is idempotent, so listeners are not doubled', () => {
    harness.domInput.attach();
    harness.domInput.attach();
    keydown('KeyW');
    expect(harness.input.heldKeyCount).toBe(1);
  });

  it('detach stops delivering events and clears the input', () => {
    keydown('KeyW');
    harness.domInput.detach();

    expect(harness.input.heldKeyCount).toBe(0);
    keydown('KeyW');
    expect(harness.input.heldKeyCount).toBe(0);
  });

  it('detach is safe to call twice', () => {
    harness.domInput.detach();
    expect(() => harness.domInput.detach()).not.toThrow();
  });

  it('detach removes the pointer-lock listeners too', () => {
    harness.domInput.detach();
    pretendLocked(null);
    document.dispatchEvent(new Event('pointerlockchange'));
    expect(harness.lockChanges).toEqual([]);
  });

  it('a fresh attach after detach works again', () => {
    harness.domInput.detach();
    harness.domInput.attach();
    keydown('KeyW');
    expect(harness.input.heldKeyCount).toBe(1);
  });
});
