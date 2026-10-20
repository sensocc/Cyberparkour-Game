/**
 * Pure input state.
 *
 * Holds no DOM references, so it can be driven from tests as easily as from
 * keyboard events. Continuous state (held keys, accumulated pointer motion) is
 * exposed through getters, while discrete UI actions are queued and drained
 * once per frame - a key press that begins *and* ends between two frames must
 * not be lost.
 */

import type { MoveInput } from '../game/player.js';
import { DEFAULT_BINDINGS, isUiAction, type Bindings, type KeyAction } from './bindings.js';

export interface PointerDelta {
  dx: number;
  dy: number;
}

export class InputState {
  private readonly pressedCodes = new Set<string>();
  private readonly actionQueue: KeyAction[] = [];
  private pointerDx = 0;
  private pointerDy = 0;
  /** Touch-stick movement axes, each -1..1; merged with the keys by `moveInput`. */
  private touchForward = 0;
  private touchRight = 0;
  /** Actions held by on-screen buttons rather than keys, so `isActionPressed` sees them too. */
  private readonly heldTouchActions = new Set<KeyAction>();

  constructor(private bindings: Bindings = DEFAULT_BINDINGS) {}

  /**
   * Replaces the key table.
   *
   * Held keys are *not* cleared: a player who rebinds mid-run is holding keys whose
   * meaning has just changed, and the next `keyUp` still has to release whichever
   * action they now belong to.
   */
  setBindings(bindings: Bindings): void {
    this.bindings = bindings;
  }

  /** The table in force, for anything that has to describe it. */
  get currentBindings(): Bindings {
    return this.bindings;
  }

  /** A key went down. Repeat events are ignored for queued UI actions. */
  keyDown(code: string, repeat = false): void {
    this.pressedCodes.add(code);
    if (repeat) return;

    const action = this.actionFor(code);
    if (action !== null && isUiAction(action)) this.actionQueue.push(action);
  }

  keyUp(code: string): void {
    this.pressedCodes.delete(code);
  }

  /** Adds a pointer motion sample, in pixels. */
  addPointerDelta(dx: number, dy: number): void {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    this.pointerDx += dx;
    this.pointerDy += dy;
  }

  isPressed(code: string): boolean {
    return this.pressedCodes.has(code);
  }

  /** Whether any key bound to `action` is currently held. */
  isActionPressed(action: KeyAction): boolean {
    // Touch buttons hold an *action* directly, not a key code: an on-screen jump button has no
    // `Space`, and the binding table is about keyboards. Both writers are asked, so a key and a
    // thumb can hold the same action at once without either being ignored.
    if (this.heldTouchActions.has(action)) return true;
    return this.bindings[action].some((code) => this.pressedCodes.has(code));
  }

  /**
   * Sets the virtual stick's movement axes, each clamped to -1..1.
   *
   * Fractional, because a thumb gives an analogue amount, not a held key: a half-tilt should be
   * half speed, which is exactly what the movement code already does with `input.forward` and
   * `input.right` - it normalises and scales by the input magnitude, so the touch stick writes the
   * same shape the keyboard does, just with finer values.
   */
  setTouchMove(forward: number, right: number): void {
    this.touchForward = Number.isFinite(forward) ? Math.max(-1, Math.min(1, forward)) : 0;
    this.touchRight = Number.isFinite(right) ? Math.max(-1, Math.min(1, right)) : 0;
  }

  /** An on-screen button went down. Held actions stay held; UI actions queue exactly like a key. */
  pressAction(action: KeyAction): void {
    if (this.heldTouchActions.has(action)) return;
    this.heldTouchActions.add(action);
    if (isUiAction(action)) this.actionQueue.push(action);
  }

  /** An on-screen button was released. */
  releaseAction(action: KeyAction): void {
    this.heldTouchActions.delete(action);
  }

  /**
   * The full movement intent for this step.
   *
   * Sprint and crouch are held states, and jump is deliberately "held" rather
   * than edge-triggered: holding the key while landing jumps again, which is
   * what players expect and avoids a one-frame input buffer.
   */
  get moveInput(): MoveInput {
    const keyForward = Number(this.isActionPressed('moveForward')) - Number(this.isActionPressed('moveBackward'));
    const keyRight = Number(this.isActionPressed('moveRight')) - Number(this.isActionPressed('moveLeft'));
    // The two writers are merged and clamped, so a full key plus a full tilt cannot exceed the
    // range the movement code already assumes - it would otherwise normalise to a diagonal bias.
    const forward = Math.max(-1, Math.min(1, keyForward + this.touchForward));
    const right = Math.max(-1, Math.min(1, keyRight + this.touchRight));
    return {
      forward,
      right,
      sprint: this.isActionPressed('sprint'),
      jump: this.isActionPressed('jump'),
      crouch: this.isActionPressed('crouch'),
    };
  }

  /**
   * Returns and clears the pointer motion accumulated since the last call.
   *
   * Consumed exactly once per rendered frame, which keeps mouse look
   * independent of how many physics steps that frame contains.
   */
  consumePointerDelta(): PointerDelta {
    const delta = { dx: this.pointerDx, dy: this.pointerDy };
    this.pointerDx = 0;
    this.pointerDy = 0;
    return delta;
  }

  /** Drains the queue of UI actions triggered by key-down events. */
  consumeActions(): KeyAction[] {
    if (this.actionQueue.length === 0) return [];
    return this.actionQueue.splice(0, this.actionQueue.length);
  }

  /** Releases everything. Called when the game loses focus. */
  clear(): void {
    this.pressedCodes.clear();
    this.actionQueue.length = 0;
    this.pointerDx = 0;
    this.pointerDy = 0;
    this.touchForward = 0;
    this.touchRight = 0;
    this.heldTouchActions.clear();
  }

  /** Number of held keys; handy for diagnostics. */
  get heldKeyCount(): number {
    return this.pressedCodes.size;
  }

  private actionFor(code: string): KeyAction | null {
    for (const action of Object.keys(this.bindings) as KeyAction[]) {
      if (this.bindings[action].includes(code)) return action;
    }
    return null;
  }
}
