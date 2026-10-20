// @vitest-environment jsdom
//
// The touch layer is the mobile browser boundary. jsdom has `PointerEvent` (so the events the code
// listens for exist) but not pointer capture, which is exactly why the class tracks gestures by
// `pointerId` with window-level listeners - the tests exercise that path directly.

import { afterEach, describe, expect, it } from 'vitest';

import { InputState } from '../../src/input/inputState.js';
import { STICK_RADIUS, TouchControls, stickAxes, stickThumbOffset } from '../../src/input/touchControls.js';

function pointer(type: string, pointerId: number, x: number, y: number): PointerEvent {
  return new PointerEvent(type, { pointerId, clientX: x, clientY: y, bubbles: true });
}

interface Harness {
  readonly input: InputState;
  readonly target: HTMLElement;
  readonly controls: TouchControls;
  readonly stick: HTMLElement;
  readonly stickThumb: HTMLElement;
  readonly look: HTMLElement;
  readonly button: (action: string) => HTMLElement;
}

function createHarness(lookSensitivity = 1): Harness {
  document.body.innerHTML = '';
  const target = document.createElement('div');
  document.body.append(target);

  const input = new InputState();
  const controls = new TouchControls({ target, input, lookSensitivity });
  controls.attach();

  const stick = controls.element.querySelector('.touch__stick') as HTMLElement;
  const stickThumb = controls.element.querySelector('.touch__stick-thumb') as HTMLElement;
  const look = controls.element.querySelector('.touch__look') as HTMLElement;
  const button = (action: string): HTMLElement =>
    controls.buttons.get(action as never) as HTMLElement;

  return { input, target, controls, stick, stickThumb, look, button };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('stickAxes', () => {
  it('is neutral at rest and inside the deadzone', () => {
    expect(stickAxes(0, 0)).toEqual({ forward: 0, right: 0 });
    expect(stickAxes(STICK_RADIUS * 0.1, 0)).toEqual({ forward: 0, right: 0 });
  });

  it('maps a full tilt to unit axes', () => {
    expect(stickAxes(0, -STICK_RADIUS).forward).toBeCloseTo(1, 6);
    expect(stickAxes(STICK_RADIUS, 0).right).toBeCloseTo(1, 6);
    expect(stickAxes(0, STICK_RADIUS).forward).toBeCloseTo(-1, 6);
  });

  it('gives a half tilt less than full, rather than a switch', () => {
    const half = stickAxes(0, -STICK_RADIUS / 2);
    expect(half.forward).toBeGreaterThan(0);
    expect(half.forward).toBeLessThan(1);
  });

  it('clamps a diagonal to the unit circle', () => {
    const corner = stickAxes(STICK_RADIUS, -STICK_RADIUS);
    expect(Math.hypot(corner.forward, corner.right)).toBeCloseTo(1, 6);
  });
});

describe('stickThumbOffset', () => {
  it('follows the finger inside the ring, and stops at its edge', () => {
    expect(stickThumbOffset(0, 0)).toEqual({ x: 0, y: 0 });
    expect(stickThumbOffset(24, -10)).toEqual({ x: 24, y: -10 });
    // A full-tilt finger would be well past the ring; the thumb stops at the ring's edge.
    const edge = stickThumbOffset(STICK_RADIUS, 0);
    expect(edge.x).toBeCloseTo(STICK_RADIUS, 6);
    expect(edge.y).toBeCloseTo(0, 6);
  });
});

describe('TouchControls', () => {
  it('moves the thumb with the finger, and recentres it on release', () => {
    const { input, stick, stickThumb } = createHarness();
    stick.dispatchEvent(pointer('pointerdown', 1, 100, 100));
    expect(stickThumb.style.transform).toBe('translate(0px, 0px)');

    window.dispatchEvent(pointer('pointermove', 1, 100, 100 - STICK_RADIUS));
    expect(stickThumb.style.transform).toContain(`translate(0px, ${-STICK_RADIUS}px)`);
    expect(input.moveInput.forward).toBeCloseTo(1, 6);

    window.dispatchEvent(pointer('pointerup', 1, 100, 100 - STICK_RADIUS));
    expect(stickThumb.style.transform).toBe('translate(0px, 0px)');
  });

  it('steers from a stick drag and recentres on release', () => {
    const { input, stick } = createHarness();
    stick.dispatchEvent(pointer('pointerdown', 1, 100, 100));
    window.dispatchEvent(pointer('pointermove', 1, 100, 100 - STICK_RADIUS));

    expect(input.moveInput.forward).toBeCloseTo(1, 6);

    window.dispatchEvent(pointer('pointerup', 1, 100, 100 - STICK_RADIUS));
    expect(input.moveInput.forward).toBe(0);
  });

  it('ignores a second thumb on the stick rather than merging it', () => {
    const { input, stick } = createHarness();
    stick.dispatchEvent(pointer('pointerdown', 1, 100, 100));
    stick.dispatchEvent(pointer('pointerdown', 2, 200, 200));

    window.dispatchEvent(pointer('pointermove', 2, 200, 200 - STICK_RADIUS));
    expect(input.moveInput).toMatchObject({ forward: 0, right: 0 });

    window.dispatchEvent(pointer('pointermove', 1, 100, 100 - STICK_RADIUS));
    expect(input.moveInput.forward).toBeCloseTo(1, 6);
  });

  it('feeds a look drag through the pointer delta, scaled by sensitivity', () => {
    const { input, look, controls } = createHarness(2);
    look.dispatchEvent(pointer('pointerdown', 1, 500, 400));
    window.dispatchEvent(pointer('pointermove', 1, 507, 396));

    expect(input.consumePointerDelta()).toEqual({ dx: 14, dy: -8 });

    // A second look pointer tracks independently; the first's delta is already consumed.
    controls.setLookSensitivity(1);
    look.dispatchEvent(pointer('pointerdown', 2, 10, 10));
    window.dispatchEvent(pointer('pointermove', 2, 13, 18));
    expect(input.consumePointerDelta()).toEqual({ dx: 3, dy: 8 });
  });

  it('holds a button for the duration of the press', () => {
    const { input, button } = createHarness();
    const jump = button('jump');
    jump.dispatchEvent(pointer('pointerdown', 1, 0, 0));
    expect(input.moveInput.jump).toBe(true);

    window.dispatchEvent(pointer('pointerup', 1, 0, 0));
    expect(input.moveInput.jump).toBe(false);
  });

  it('lights a button up while it is held and dims it on release', () => {
    const { button } = createHarness();
    const jump = button('jump');
    jump.dispatchEvent(pointer('pointerdown', 1, 0, 0));
    expect(jump.classList.contains('touch__button--pressed')).toBe(true);

    window.dispatchEvent(pointer('pointerup', 1, 0, 0));
    expect(jump.classList.contains('touch__button--pressed')).toBe(false);
  });

  it('queues a UI action on the press edge only', () => {
    const { input, button } = createHarness();
    button('interact').dispatchEvent(pointer('pointerdown', 1, 0, 0));
    button('interact').dispatchEvent(pointer('pointerdown', 2, 0, 0));
    expect(input.consumeActions()).toEqual(['interact']);

    window.dispatchEvent(pointer('pointerup', 1, 0, 0));
    expect(input.consumeActions()).toEqual([]);
  });

  it('releases everything on detach', () => {
    const { input, controls, stick, button } = createHarness();
    stick.dispatchEvent(pointer('pointerdown', 1, 100, 100));
    window.dispatchEvent(pointer('pointermove', 1, 100, 100 - STICK_RADIUS));
    button('crouch').dispatchEvent(pointer('pointerdown', 2, 0, 0));

    controls.detach();
    expect(input.moveInput).toMatchObject({ forward: 0, crouch: false });
    expect(controls.element.isConnected).toBe(false);
  });
});

describe('TouchControls.setContext', () => {
  it('relabels the interact button and lights it up', () => {
    const { controls, button } = createHarness();
    const interact = button('interact');

    controls.setContext({ interactLabel: 'CALL', floors: [] });
    expect(interact.textContent).toBe('CALL');
    expect(interact.classList.contains('touch__button--active')).toBe(true);

    controls.setContext({ interactLabel: null, floors: [] });
    expect(interact.textContent).toBe('USE');
    expect(interact.classList.contains('touch__button--active')).toBe(false);
  });

  it('builds one floor button per floor and hides the bar when empty', () => {
    const { controls } = createHarness();
    const bar = controls.element.querySelector('.touch__floors') as HTMLElement;

    controls.setContext({ interactLabel: null, floors: ['Street', 'Rooftop'] });
    expect(bar.hidden).toBe(false);
    expect(bar.querySelectorAll('button')).toHaveLength(2);

    controls.setContext({ interactLabel: null, floors: [] });
    expect(bar.hidden).toBe(true);
    expect(bar.querySelectorAll('button')).toHaveLength(0);
  });

  it('does not rebuild the floor bar when the list is unchanged', () => {
    const { controls } = createHarness();
    const bar = controls.element.querySelector('.touch__floors') as HTMLElement;
    controls.setContext({ interactLabel: null, floors: ['A', 'B'] });
    const first = bar.querySelector('button');

    controls.setContext({ interactLabel: null, floors: ['A', 'B'] });
    expect(bar.querySelector('button')).toBe(first);
  });
});
