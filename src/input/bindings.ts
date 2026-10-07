/**
 * Key bindings.
 *
 * Codes are `KeyboardEvent.code` values, so the layout is physical: WASD stays
 * under the same fingers on AZERTY and Dvorak keyboards. V0.6 turns this table
 * into user-editable settings.
 */

export type KeyAction =
  | 'moveForward'
  | 'moveBackward'
  | 'moveLeft'
  | 'moveRight'
  | 'toggleDebug'
  | 'pause'
  | 'restart';

export type Bindings = Record<KeyAction, readonly string[]>;

export const DEFAULT_BINDINGS: Bindings = {
  moveForward: ['KeyW', 'ArrowUp'],
  moveBackward: ['KeyS', 'ArrowDown'],
  moveLeft: ['KeyA', 'ArrowLeft'],
  moveRight: ['KeyD', 'ArrowRight'],
  toggleDebug: ['F3', 'Backquote'],
  pause: ['Escape'],
  restart: ['KeyR'],
};

/** Actions typed into the DOM, drained once per frame. */
export const UI_ACTIONS: readonly KeyAction[] = ['toggleDebug', 'pause', 'restart'];

export function isUiAction(action: KeyAction): boolean {
  return UI_ACTIONS.includes(action);
}

/** Reverse lookup: which action (if any) a key code is bound to. */
export function actionForKey(bindings: Bindings, code: string): KeyAction | null {
  for (const [action, codes] of Object.entries(bindings) as [KeyAction, readonly string[]][]) {
    if (codes.includes(code)) return action;
  }
  return null;
}
