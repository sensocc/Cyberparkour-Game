/**
 * DOM glue: keyboard listeners and pointer lock.
 *
 * All logic lives in `InputState`; this file only translates browser events
 * into it and owns the pointer-lock lifecycle (which is what "mouse look"
 * actually requires).
 */

import { logger } from '../core/log.js';
import { DEFAULT_BINDINGS, type Bindings } from './bindings.js';
import type { InputState } from './inputState.js';

export interface DomInputOptions {
  readonly target: HTMLElement;
  readonly input: InputState;
  readonly bindings?: Bindings;
  /** Called when pointer lock is gained or lost. */
  readonly onPointerLockChange?: (locked: boolean) => void;
}

export class DomInput {
  private readonly target: HTMLElement;
  private readonly input: InputState;
  private boundCodes: ReadonlySet<string>;
  private readonly onPointerLockChange: (locked: boolean) => void;
  private attached = false;

  constructor(options: DomInputOptions) {
    this.target = options.target;
    this.input = options.input;
    this.onPointerLockChange = options.onPointerLockChange ?? (() => {});
    this.boundCodes = new Set(Object.values(options.bindings ?? DEFAULT_BINDINGS).flat());
  }

  /**
   * Swaps the key table, including which codes get `preventDefault`.
   *
   * `boundCodes` is what keeps the browser's own shortcuts working: F5 and F12 are
   * only swallowed once something is actually bound to them, so rebinding has to
   * move this set with the table.
   */
  setBindings(bindings: Bindings): void {
    this.input.setBindings(bindings);
    this.boundCodes = new Set(Object.values(bindings).flat());
  }

  get pointerLocked(): boolean {
    return document.pointerLockElement === this.target;
  }

  /** Whether this environment implements the Pointer Lock API at all. */
  get pointerLockSupported(): boolean {
    return typeof this.target.requestPointerLock === 'function';
  }

  attach(): void {
    if (this.attached) return;
    this.attached = true;

    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
    document.addEventListener('pointerlockchange', this.handlePointerLockChange);
    document.addEventListener('pointerlockerror', this.handlePointerLockError);
    document.addEventListener('mousemove', this.handleMouseMove);
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;

    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
    document.removeEventListener('pointerlockchange', this.handlePointerLockChange);
    document.removeEventListener('pointerlockerror', this.handlePointerLockError);
    document.removeEventListener('mousemove', this.handleMouseMove);
    this.input.clear();
  }

  /** Requests pointer lock. Must be called from a user-gesture handler. */
  requestPointerLock(): void {
    if (this.pointerLocked) return;

    // The API is absent in some embedded browsers and in test environments.
    // This is not a lock *loss*, so it must not be reported as one: the game
    // is still playable, just without mouse look.
    if (!this.pointerLockSupported) {
      logger.warn('input', 'pointer lock is not supported here - mouse look unavailable');
      return;
    }

    // Chrome returns a promise, Firefox returns undefined. A rejection is
    // routine (the user pressed Esc recently), so it is only logged.
    const result: unknown = this.target.requestPointerLock();
    if (result instanceof Promise) {
      result.catch((error: unknown) => {
        logger.debug('input', 'pointer lock request rejected', { error: String(error) });
      });
    }
  }

  exitPointerLock(): void {
    if (typeof document.exitPointerLock !== 'function') return;
    if (this.pointerLocked) document.exitPointerLock();
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    this.input.keyDown(event.code, event.repeat);
    // Only swallow keys the game actually binds; F5, F12 and friends must keep
    // working for the player.
    if (this.boundCodes.has(event.code)) event.preventDefault();
  };

  private handleKeyUp = (event: KeyboardEvent): void => {
    this.input.keyUp(event.code);
  };

  private handleBlur = (): void => {
    // Without this, alt-tabbing while holding W would leave the player walking
    // forever with no key-up event to release them.
    this.input.clear();
  };

  private handleMouseMove = (event: MouseEvent): void => {
    if (!this.pointerLocked) return;
    this.input.addPointerDelta(event.movementX, event.movementY);
  };

  private handlePointerLockChange = (): void => {
    const locked = this.pointerLocked;
    if (!locked) this.input.clear();
    this.onPointerLockChange(locked);
  };

  private handlePointerLockError = (): void => {
    // A refused request is not a loss of an existing lock, so the game is not
    // paused: it keeps running with keyboard control only.
    logger.warn('input', 'pointer lock was refused - mouse look unavailable');
  };
}
