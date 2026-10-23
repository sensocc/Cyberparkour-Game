/**
 * Touch controls: the on-screen stick, look-drag and buttons for a phone or tablet.
 *
 * This is a *writer*, not a model. Everything here translates pointer events into the same
 * `InputState` the keyboard already writes to - the stick becomes `setTouchMove`, a look-drag
 * becomes `addPointerDelta`, and a button becomes `pressAction`/`releaseAction` - so the movement
 * and physics code has no idea the input came from a thumb. That is what keeps the desktop game
 * untouched: touch is a second source of the same truth, never a second truth.
 *
 * The geometry is a pure function (`stickAxes`) for the same reason `look.ts` is: the exact
 * deadzone and ramp maths is testable without a touchscreen, and the DOM class is only glue.
 *
 * No `setPointerCapture`: pointer *events* exist in jsdom, pointer *capture* does not, so a gesture
 * is tracked by its `pointerId` against window-level move/up listeners instead. The two are
 * equivalent for this game - the stick and look zones are full-screen edges, so a thumb that
 * drifts out of them must keep steering, and window listeners do exactly that without the API.
 */

import { el } from '../ui/dom.js';
import { FLOOR_ACTIONS, type KeyAction } from './bindings.js';
import type { InputState } from './inputState.js';
import {
  exitFullscreen,
  fullscreenSupported,
  isFullscreen,
  requestFullscreen,
} from '../core/device.js';

/** How far the thumb can travel before the stick is "full", in CSS pixels. */
export const STICK_RADIUS = 48;
/** Fraction of the radius that is dead: a resting thumb is not a half-pressed direction. */
export const STICK_DEADZONE = 0.22;

/** Movement axes, each in -1..1. */
export interface StickAxes {
  readonly forward: number;
  readonly right: number;
}

/**
 * A stick drag, as movement intent.
 *
 * `dx` is rightwards and `dy` is downwards in screen space, so "up" is forward. The output is
 * *analogue* - a half-tilt is half speed - and it ramps from the deadzone so there is no step at
 * the edge of "resting". The length is clamped to the unit circle, because a corner tilt must not
 * run faster than a straight one; the movement code would normalise it anyway, but the stick
 * should not rely on that.
 */
export function stickAxes(dx: number, dy: number, radius = STICK_RADIUS): StickAxes {
  const length = Math.hypot(dx, dy);
  if (length < STICK_DEADZONE * radius) return { forward: 0, right: 0 };

  const reach = radius - STICK_DEADZONE * radius;
  const strength = Math.min(1, (length - STICK_DEADZONE * radius) / reach);
  const scale = strength / length;
  return { forward: -dy * scale, right: dx * scale };
}

/**
 * Where the thumb should *appear*, in pixels from the ring's centre, for a finger that far away.
 *
 * Different from `stickAxes` on purpose: the input applies the deadzone and the ramp, but the
 * *visual* thumb must follow the finger from the first pixel - a thumb that stays pinned to the
 * centre while the player is already steering reads as broken. The only clamp is the ring's edge.
 */
export function stickThumbOffset(dx: number, dy: number, radius = STICK_RADIUS): { x: number; y: number } {
  const length = Math.hypot(dx, dy);
  const scale = length > radius ? radius / length : 1;
  return { x: dx * scale, y: dy * scale };
}

/** The on-screen buttons: an action and its face. */
export interface TouchButtonSpec {
  readonly action: KeyAction;
  readonly label: string;
}

/** The button set every touch device gets; the contextual ones are added by the HUD layer. */
export const TOUCH_BUTTONS: readonly TouchButtonSpec[] = [
  { action: 'jump', label: 'JUMP' },
  { action: 'crouch', label: 'CROUCH' },
  { action: 'sprint', label: 'SPRINT' },
  { action: 'interact', label: 'USE' },
  { action: 'pause', label: 'PAUSE' },
];

export interface TouchControlsOptions {
  /** The element the controls render into. */
  readonly target: HTMLElement;
  /** The shared input state, written to exactly like the keyboard writes it. */
  readonly input: InputState;
  /** Multiplier on look-drag pixels; the touch equivalent of mouse sensitivity. */
  readonly lookSensitivity?: number;
}

/**
 * What the contextual controls should show, from the game's own prompt.
 *
 * The game already works out, every frame, what the player can do right here (see
 * `Game.refreshElevatorPrompt`); this is only that answer translated into button faces. Nothing
 * here is state the touch layer owns - it is a projection, pushed when it changes.
 */
export interface TouchContext {
  /** The interact button's face, or null to dim it back to a resting "USE". */
  readonly interactLabel: string | null;
  /** Floor button faces for a lift's floor picker, in order; empty hides the picker. */
  readonly floors: readonly string[];
}

/** The resting face of the interact button. */
const INTERACT_IDLE = 'USE';

/**
 * A touch gesture tracker: `pointerId` to where it started / last was.
 *
 * Keys are the ids, so two thumbs - one on the stick, one on the look zone - track independently.
 */
interface Gesture {
  readonly x: number;
  readonly y: number;
}

export class TouchControls {
  /** The root element, for the game to show or hide the whole layer. */
  readonly element: HTMLElement;
  /** A button's element by its action, for the HUD to relabel or reveal contextual controls. */
  readonly buttons = new Map<KeyAction, HTMLElement>();

  private readonly target: HTMLElement;
  private readonly input: InputState;
  private lookSensitivity: number;
  /** The floor-picker bar, shown only inside a lift. */
  private readonly floorBar: HTMLElement;
  /** The floor actions currently in `buttons`, so a rebuild removes exactly those. */
  private readonly floorActions = new Set<KeyAction>();
  /** A signature of the last floor list, so a settled context does not rebuild the bar. */
  private floorSignature = '';

  /** One stick gesture at a time: a second thumb on the stick is ignored, not merged. */
  private stick: { id: number; origin: Gesture } | null = null;
  /** Every look-drag in flight, keyed by pointer id. */
  private readonly looks = new Map<number, Gesture>();
  /** Every held button, keyed by the pointer that is holding it. */
  private readonly heldButtons = new Map<number, KeyAction>();
  /** The fullscreen toggle, present only where the browser can actually go fullscreen. */
  private readonly fullscreenButton: HTMLElement | null;

  private attached = false;

  constructor(options: TouchControlsOptions) {
    this.target = options.target;
    this.input = options.input;
    this.lookSensitivity = options.lookSensitivity ?? 1;

    this.element = el('div', { className: 'touch' });
    this.element.setAttribute('aria-hidden', 'true');
    // Starts hidden, so a touch layer that is built but not yet playing does not cover the title
    // screen. `Game.setStatus` is what shows it, on the transition into `playing`.
    this.element.hidden = true;

    const stick = el('div', { className: 'touch__stick' });
    const stickThumb = el('div', { className: 'touch__stick-thumb' });
    stick.append(stickThumb);
    this.element.append(stick);

    const look = el('div', { className: 'touch__look' });
    this.element.append(look);

    const bar = el('div', { className: 'touch__buttons' });
    for (const { action, label } of TOUCH_BUTTONS) {
      const button = el('button', { className: 'touch__button', text: label, attrs: { type: 'button' } });
      this.buttons.set(action, button);
      bar.append(button);
    }
    this.element.append(bar);

    this.floorBar = el('div', { className: 'touch__floors' });
    this.floorBar.hidden = true;
    this.element.append(this.floorBar);

    // The portrait fallback: shown by CSS whenever the device is held upright, since this game is
    // built for a sideways phone and the orientation lock is only ever a request.
    const rotate = el('div', { className: 'touch__rotate' });
    rotate.append(el('p', { className: 'touch__rotate-glyph', text: '\u21bb' }));
    rotate.append(el('p', { className: 'touch__rotate-text', text: 'ROTATE YOUR DEVICE' }));
    this.element.append(rotate);

    // The fullscreen toggle, in the top corner out of the thumbs' way. iPhone Safari has no
    // `requestFullscreen` at all, so the button is simply not built there - a button that does
    // nothing is worse than none. Its face reflects the state it last observed.
    this.fullscreenButton = fullscreenSupported()
      ? el('button', {
          className: 'touch__button touch__fullscreen',
          text: 'FULL',
          attrs: { type: 'button', 'aria-label': 'Enter fullscreen' },
        })
      : null;
    if (this.fullscreenButton) {
      this.fullscreenButton.addEventListener('click', this.handleFullscreenToggle);
      this.element.append(this.fullscreenButton);
    }

    // The three zones keep their references through closure over the elements, not `this`, so the
    // listeners below are stable functions attach/detach can add and remove.
    this.stickElement = stick;
    this.stickThumb = stickThumb;
    this.lookElement = look;
  }

  private readonly stickElement: HTMLElement;
  private readonly stickThumb: HTMLElement;
  private readonly lookElement: HTMLElement;

  /** Swaps the look multiplier, for a mid-session settings change. */
  setLookSensitivity(value: number): void {
    this.lookSensitivity = Number.isFinite(value) && value > 0 ? value : 1;
  }

  /** Shows or hides the whole layer. */
  setVisible(visible: boolean): void {
    this.element.hidden = !visible;
  }

  /**
   * Projects the game's own prompt onto the contextual buttons.
   *
   * The game computes, every frame, what the player can do right here (talk, call a lift, choose
   * a floor); this only translates that into button faces. Idempotent on the expensive half: the
   * floor bar is rebuilt only when the floor list changes, and a settled context writes nothing.
   */
  setContext(context: TouchContext): void {
    const interact = this.buttons.get('interact');
    if (interact) {
      const active = context.interactLabel !== null;
      const label = active ? context.interactLabel : INTERACT_IDLE;
      if (interact.textContent !== label) interact.textContent = label;
      interact.classList.toggle('touch__button--active', active);
    }

    const showFloors = context.floors.length > 0;
    if (this.floorBar.hidden !== !showFloors) this.floorBar.hidden = !showFloors;

    const signature = context.floors.join('\u0000');
    if (signature === this.floorSignature) return;
    this.floorSignature = signature;
    this.rebuildFloors(context.floors);
  }

  /** Rebuilds the floor picker: one button per floor, in order. */
  private rebuildFloors(floors: readonly string[]): void {
    for (const action of this.floorActions) this.buttons.delete(action);
    this.floorActions.clear();
    this.floorBar.replaceChildren();

    floors.forEach((name, index) => {
      const action = FLOOR_ACTIONS[index];
      if (!action) return;
      const button = el('button', { className: 'touch__button touch__button--floor', text: name, attrs: { type: 'button' } });
      button.addEventListener('pointerdown', this.handleButtonDown);
      this.buttons.set(action, button);
      this.floorActions.add(action);
      this.floorBar.append(button);
    });
  }

  attach(): void {
    if (this.attached) return;
    this.attached = true;

    this.target.append(this.element);
    this.stickElement.addEventListener('pointerdown', this.handleStickDown);
    this.lookElement.addEventListener('pointerdown', this.handleLookDown);
    for (const button of this.buttons.values()) {
      button.addEventListener('pointerdown', this.handleButtonDown);
    }
    window.addEventListener('pointermove', this.handleMove);
    window.addEventListener('pointerup', this.handleUp);
    window.addEventListener('pointercancel', this.handleUp);
    // The browser can leave fullscreen on its own (Esc on desktop, a gesture on Android), so the
    // button's face is kept honest by the event rather than by assuming the tap did what it asked.
    document.addEventListener('fullscreenchange', this.handleFullscreenChange);
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;

    this.element.remove();
    this.stickElement.removeEventListener('pointerdown', this.handleStickDown);
    this.lookElement.removeEventListener('pointerdown', this.handleLookDown);
    for (const button of this.buttons.values()) {
      button.removeEventListener('pointerdown', this.handleButtonDown);
    }
    window.removeEventListener('pointermove', this.handleMove);
    window.removeEventListener('pointerup', this.handleUp);
    window.removeEventListener('pointercancel', this.handleUp);
    document.removeEventListener('fullscreenchange', this.handleFullscreenChange);

    this.stick = null;
    this.looks.clear();
    this.heldButtons.clear();
    this.input.clear();
  }

  private handleStickDown = (event: PointerEvent): void => {
    // A second thumb on the stick is ignored: one stick, one thumb. The first keeps steering.
    if (this.stick !== null) return;
    this.stick = { id: event.pointerId, origin: { x: event.clientX, y: event.clientY } };
    this.moveStickThumb(0, 0);
  };

  /** The fullscreen tap: enter if we are not in it, leave if we are. */
  private handleFullscreenToggle = (): void => {
    if (isFullscreen()) exitFullscreen();
    else requestFullscreen();
  };

  /** The browser changed fullscreen (itself, or because of our tap): keep the face honest. */
  private handleFullscreenChange = (): void => {
    const button = this.fullscreenButton;
    if (!button) return;
    const full = isFullscreen();
    const label = full ? 'EXIT' : 'FULL';
    if (button.textContent !== label) button.textContent = label;
    button.setAttribute('aria-label', full ? 'Exit fullscreen' : 'Enter fullscreen');
    button.classList.toggle('touch__fullscreen--on', full);
  };

  private handleLookDown = (event: PointerEvent): void => {
    if (this.looks.has(event.pointerId)) return;
    this.looks.set(event.pointerId, { x: event.clientX, y: event.clientY });
  };

  private handleButtonDown = (event: PointerEvent): void => {
    // The action comes from which button was pressed, so it is looked up from the event's target
    // rather than captured per-button: one listener body serves every button.
    const action = this.actionForButton(event.target as EventTarget | null);
    if (action === null || this.heldButtons.has(event.pointerId)) return;
    this.heldButtons.set(event.pointerId, action);
    this.input.pressAction(action);
    // Visual feedback: the button lights up and pops, then holds a faint glow until the finger
    // leaves it - see `.touch__button--pressed` in the stylesheet.
    this.buttons.get(action)?.classList.add('touch__button--pressed');
  };

  private handleMove = (event: PointerEvent): void => {
    if (this.stick !== null && this.stick.id === event.pointerId) {
      const origin = this.stick.origin;
      const dx = event.clientX - origin.x;
      const dy = event.clientY - origin.y;
      const axes = stickAxes(dx, dy);
      this.input.setTouchMove(axes.forward, axes.right);
      // The thumb follows the finger, while the *input* follows the deadzone and ramp - two
      // different truths about the same drag, and the visual one must not freeze.
      this.moveStickThumb(dx, dy);
      return;
    }

    const look = this.looks.get(event.pointerId);
    if (look) {
      const dx = (event.clientX - look.x) * this.lookSensitivity;
      const dy = (event.clientY - look.y) * this.lookSensitivity;
      this.input.addPointerDelta(dx, dy);
      this.looks.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
  };

  private handleUp = (event: PointerEvent): void => {
    if (this.stick !== null && this.stick.id === event.pointerId) {
      this.stick = null;
      this.input.setTouchMove(0, 0);
      this.moveStickThumb(0, 0);
    }

    if (this.looks.delete(event.pointerId)) {
      // A look gesture that ends leaves no held state; the delta is already consumed per frame.
    }

    const action = this.heldButtons.get(event.pointerId);
    if (action !== undefined) {
      this.heldButtons.delete(event.pointerId);
      this.input.releaseAction(action);
      this.buttons.get(action)?.classList.remove('touch__button--pressed');
    }
  };

  private actionForButton(target: EventTarget | null): KeyAction | null {
    if (!(target instanceof Element)) return null;
    for (const [action, element] of this.buttons) {
      if (element.contains(target) || element === target) return action;
    }
    return null;
  }

  /** Puts the thumb where a finger `dx, dy` from the stick's centre is, clamped to the ring. */
  private moveStickThumb(dx: number, dy: number): void {
    const offset = stickThumbOffset(dx, dy);
    this.stickThumb.style.transform = `translate(${offset.x}px, ${offset.y}px)`;
  }
}
