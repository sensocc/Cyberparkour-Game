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

  constructor(private readonly bindings: Bindings = DEFAULT_BINDINGS) {}

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
    return this.bindings[action].some((code) => this.pressedCodes.has(code));
  }

  /** Movement intent derived from the held keys. */
  get moveInput(): MoveInput {
    const forward = Number(this.isActionPressed('moveForward')) - Number(this.isActionPressed('moveBackward'));
    const right = Number(this.isActionPressed('moveRight')) - Number(this.isActionPressed('moveLeft'));
    return { forward, right };
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
