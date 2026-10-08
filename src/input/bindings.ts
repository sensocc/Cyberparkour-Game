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
  | 'sprint'
  | 'jump'
  | 'crouch'
  | 'toggleDebug'
  | 'mute'
  | 'pause'
  | 'restart';

export type Bindings = Record<KeyAction, readonly string[]>;

export const DEFAULT_BINDINGS: Bindings = {
  moveForward: ['KeyW', 'ArrowUp'],
  moveBackward: ['KeyS', 'ArrowDown'],
  moveLeft: ['KeyA', 'ArrowLeft'],
  moveRight: ['KeyD', 'ArrowRight'],
  // Both shifts, so either hand can sprint.
  sprint: ['ShiftLeft', 'ShiftRight'],
  jump: ['Space'],
  // Control is the usual crouch key; C is there for keyboards/browsers that
  // swallow it, and for players used to console layouts.
  crouch: ['ControlLeft', 'ControlRight', 'KeyC'],
  toggleDebug: ['F3', 'Backquote'],
  mute: ['KeyM'],
  pause: ['Escape'],
  restart: ['KeyR'],
};

/**
 * Actions that are held down as part of movement.
 *
 * These are read straight from the key state each step, unlike the one-shot
 * actions below.
 */
export const MOVEMENT_ACTIONS: readonly KeyAction[] = [
  'moveForward',
  'moveBackward',
  'moveLeft',
  'moveRight',
  'sprint',
  'jump',
  'crouch',
];

/** Actions triggered by a key press and drained once per frame. */
export const UI_ACTIONS: readonly KeyAction[] = ['toggleDebug', 'mute', 'pause', 'restart'];

export function isUiAction(action: KeyAction): boolean {
  return UI_ACTIONS.includes(action);
}

export function isMovementAction(action: KeyAction): boolean {
  return MOVEMENT_ACTIONS.includes(action);
}

/** Reverse lookup: which action (if any) a key code is bound to. */
export function actionForKey(bindings: Bindings, code: string): KeyAction | null {
  for (const [action, codes] of Object.entries(bindings) as [KeyAction, readonly string[]][]) {
    if (codes.includes(code)) return action;
  }
  return null;
}
