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
  /** The lift's two direction buttons: up to the roof, down to the street. */
  | 'liftUp'
  | 'liftDown';

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
  // **Two lift buttons, not one per floor.**
  //
  // A lift goes to the roof or to the street and nowhere else that matters: the intermediate
  // floors are places the building has, not places the player is going. Nine floor keys meant a
  // prompt listing nine floors and a phone picker with nine buttons stacked off the bottom of the
  // screen. Up and down are the whole interaction, they fit a thumb, and they are on the row the
  // hand is already using for W and S.
  //
  // **Digits 1 and 2, not W and S.** `actionForKey` returns the first action bound to a code, and
  // `moveForward`/`moveBackward` already own W and S - binding the lift to them would have made
  // the buttons dead on a keyboard. These are the same two keys the old floor picker used, so the
  // muscle memory survives the change.
  liftUp: ['Digit1'],
  liftDown: ['Digit2'],
};

/** The lift's two direction buttons, in order. */
export const LIFT_ACTIONS: readonly KeyAction[] = ['liftUp', 'liftDown'];

/**
 * The most floors a car may serve.
 *
 * **No longer tied to the number of buttons.** It used to *be* the button count, because a floor
 * with no key could not be selected - which is how five towers shipped with nine floors and eight
 * keys in V2.0.2. With up/down there is no per-floor key to run out of: every car reaches its own
 * roof from its own street with two buttons, so this is only a sanity ceiling on the generator.
 */
export const MAX_LIFT_FLOORS = 9;

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
  ...LIFT_ACTIONS,
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
  ...LIFT_ACTIONS,
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
  liftUp: 'Lift: up to the roof',
  liftDown: 'Lift: down to the street',
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
