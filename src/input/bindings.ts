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
  | 'interact'
  | 'toggleDebug'
  | 'mute'
  | 'pause'
  | 'restart'
  /** The lift's floor buttons. There are eight, which is more floors than any
   *  building in the city has, and each one is rebindable like any other key. */
  | 'floor1'
  | 'floor2'
  | 'floor3'
  | 'floor4'
  | 'floor5'
  | 'floor6'
  | 'floor7'
  | 'floor8';

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
  // E works a door the player is standing next to. F is a common alternative and
  // costs nothing to accept.
  interact: ['KeyE', 'KeyF'],
  toggleDebug: ['F3', 'Backquote'],
  mute: ['KeyM'],
  pause: ['Escape'],
  restart: ['KeyR'],
  // The floor buttons, on the row the hand is already on.
  floor1: ['Digit1'],
  floor2: ['Digit2'],
  floor3: ['Digit3'],
  floor4: ['Digit4'],
  floor5: ['Digit5'],
  floor6: ['Digit6'],
  floor7: ['Digit7'],
  floor8: ['Digit8'],
};

/** The lift's floor buttons, in order. */
export const FLOOR_ACTIONS: readonly KeyAction[] = [
  'floor1',
  'floor2',
  'floor3',
  'floor4',
  'floor5',
  'floor6',
  'floor7',
  'floor8',
];

/** Which floor a `floorN` action asks for, or null for anything else. */
export function floorFromAction(action: KeyAction): number | null {
  const index = FLOOR_ACTIONS.indexOf(action);
  return index === -1 ? null : index;
}

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
export const UI_ACTIONS: readonly KeyAction[] = [
  'interact',
  'toggleDebug',
  'mute',
  'pause',
  'restart',
  ...FLOOR_ACTIONS,
];

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

/**
 * Every action, in the order a player would look for them.
 *
 * Presentation only - the input layer iterates the bindings object - but the order
 * matters on the settings screen, where "Forward, Back, Left, Right, Sprint" reads
 * like a control scheme and an alphabetical list reads like a config file.
 */
export const ACTION_ORDER: readonly KeyAction[] = [
  'moveForward',
  'moveBackward',
  'moveLeft',
  'moveRight',
  'sprint',
  'jump',
  'crouch',
  'interact',
  'pause',
  'restart',
  'toggleDebug',
  'mute',
  ...FLOOR_ACTIONS,
];

/** What each action is called where a player can see it. */
export const ACTION_LABELS: Record<KeyAction, string> = {
  moveForward: 'Forward',
  moveBackward: 'Back',
  moveLeft: 'Left',
  moveRight: 'Right',
  sprint: 'Sprint',
  jump: 'Jump · pull up · wall kick',
  crouch: 'Crouch · slide · roll',
  interact: 'Open a door · call a lift',
  toggleDebug: 'Debug HUD',
  mute: 'Mute',
  pause: 'Pause',
  restart: 'Restart run',
  floor1: 'Lift floor 1',
  floor2: 'Lift floor 2',
  floor3: 'Lift floor 3',
  floor4: 'Lift floor 4',
  floor5: 'Lift floor 5',
  floor6: 'Lift floor 6',
  floor7: 'Lift floor 7',
  floor8: 'Lift floor 8',
};

/**
 * A `KeyboardEvent.code` as a player would say it.
 *
 * The bindings are physical codes, which is the right thing to *store* and a poor
 * thing to *show*: nobody has ever looked for a key called "Backquote". Anything
 * unrecognised falls back to the code itself, so a key this has never heard of is
 * still identifiable.
 */
export function describeKey(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;

  const named: Record<string, string> = {
    Space: 'Space',
    Escape: 'Esc',
    Enter: 'Enter',
    Tab: 'Tab',
    Backspace: 'Backspace',
    Backquote: '`',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backslash: '\\',
    ArrowUp: '\u2191',
    ArrowDown: '\u2193',
    ArrowLeft: '\u2190',
    ArrowRight: '\u2192',
    ShiftLeft: 'Left Shift',
    ShiftRight: 'Right Shift',
    ControlLeft: 'Left Ctrl',
    ControlRight: 'Right Ctrl',
    AltLeft: 'Left Alt',
    AltRight: 'Right Alt',
  };
  if (code in named) return named[code] as string;
  if (code.startsWith('Arrow')) return code.slice(5);
  return code;
}

/** A binding list as one line: `Space`, or `Space + E`. */
export function describeBinding(codes: readonly string[]): string {
  return codes.map(describeKey).join(' + ');
}
