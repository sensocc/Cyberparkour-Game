/**
 * The settings screen.
 *
 * Built as its own component rather than as another arm of `GameUi`, because it is
 * the only screen with *inputs* - sliders, segmented choices and key capture - and
 * that is enough machinery to deserve a file that can be read on its own.
 *
 * The panel holds no state of its own. It is handed the settings that are actually
 * in force and it draws them; every interaction reports a *patch* upward. That is
 * what keeps the sliders honest: the number under a slider is the number the game
 * accepted, not the number the player dragged to, so a value clamped by
 * `normaliseSettings` shows up as clamped.
 */

import {
  ACTION_LABELS,
  ACTION_ORDER,
  describeBinding,
  type KeyAction,
} from '../input/bindings.js';
import {
  DEFAULT_SETTINGS,
  FOV_RANGE,
  MOTION_LEVELS,
  QUALITY_LEVELS,
  QUALITY_PRESETS,
  SENSITIVITY_RANGE,
  bindingConflicts,
  rebind,
  type GameSettings,
  type MotionLevel,
  type QualityLevel,
  type VolumeSettings,
} from '../core/settings.js';

export interface SettingsPanelCallbacks {
  /** Applies a change. */
  readonly onChange: (patch: Partial<GameSettings>) => void;
  /** Puts everything back to the defaults. */
  readonly onReset: () => void;
  /** Leaves the screen. */
  readonly onBack: () => void;
}

/** A labelled slider: the row to place, and the way to show a value on it. */
interface Slider {
  readonly row: HTMLElement;
  readonly input: HTMLInputElement;
  readonly output: HTMLElement;
  /** Draws a value without reporting it back as a change. */
  readonly set: (value: number) => void;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A row of selectable chips: one group of mutually exclusive choices. */
class Choices<T extends string> {
  readonly row: HTMLElement;
  private readonly buttons = new Map<T, HTMLButtonElement>();

  constructor(
    label: string,
    values: readonly T[],
    describe: (value: T) => string,
    private readonly onPick: (value: T) => void,
  ) {
    this.row = element('div', 'settings__row');
    this.row.append(element('span', 'settings__label', label));

    const group = element('div', 'choices');
    for (const value of values) {
      const button = element('button', 'choice', describe(value));
      button.type = 'button';
      button.addEventListener('click', () => this.onPick(value));
      this.buttons.set(value, button);
      group.append(button);
    }
    this.row.append(group);
  }

  set(value: T): void {
    for (const [candidate, button] of this.buttons) {
      const selected = candidate === value;
      button.classList.toggle('choice--on', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
  }
}

export class SettingsPanel {
  readonly element: HTMLElement;
  private readonly callbacks: SettingsPanelCallbacks;

  private readonly sensitivity: Slider;
  private readonly fov: Slider;
  private readonly volumes: Record<keyof VolumeSettings, Slider> = {
    master: this.slider('Master', 0, 1, 0.05),
    music: this.slider('Music', 0, 1, 0.05),
    effects: this.slider('Effects', 0, 1, 0.05),
  };
  private readonly invertY: Choices<'no' | 'yes'>;
  private readonly motion: Choices<MotionLevel>;
  private readonly quality: Choices<QualityLevel>;
  private readonly invertYRow: HTMLElement;
  private readonly keys = new Map<KeyAction, HTMLButtonElement>();
  private readonly conflict: HTMLElement;
  private readonly note: HTMLElement;
  /** The action waiting for a key, if any. */
  private capturing: KeyAction | null = null;
  /** The last settings drawn, so a rebind can merge into them. */
  private last: GameSettings = DEFAULT_SETTINGS;

  constructor(callbacks: SettingsPanelCallbacks) {
    this.callbacks = callbacks;

    this.sensitivity = this.slider(
      'Mouse sensitivity',
      SENSITIVITY_RANGE.min,
      SENSITIVITY_RANGE.max,
      SENSITIVITY_RANGE.step,
      (value) => `${value.toFixed(2)}\u00d7`,
      (value) => this.callbacks.onChange({ sensitivity: value }),
    );
    this.fov = this.slider(
      'Field of view',
      FOV_RANGE.min,
      FOV_RANGE.max,
      FOV_RANGE.step,
      (value) => `${Math.round(value)}\u00b0`,
      (value) => this.callbacks.onChange({ fov: value }),
    );

    this.invertY = new Choices<'no' | 'yes'>(
      'Invert vertical look',
      ['no', 'yes'],
      (value) => (value === 'yes' ? 'On' : 'Off'),
      (value) => this.callbacks.onChange({ invertY: value === 'yes' }),
    );
    this.invertYRow = this.invertY.row;

    this.motion = new Choices<MotionLevel>(
      'Camera motion',
      MOTION_LEVELS,
      (value) => MOTION_LABELS[value],
      (value) => this.callbacks.onChange({ motion: value }),
    );
    this.quality = new Choices<QualityLevel>(
      'Graphics',
      QUALITY_LEVELS,
      (value) => QUALITY_PRESETS[value].label,
      (value) => this.callbacks.onChange({ quality: value }),
    );

    this.conflict = element('p', 'settings__warn');
    this.note = element('p', 'settings__note');

    this.element = element('div', 'screen screen--settings');
    const panel = element('div', 'panel');
    panel.append(
      element('h2', 'screen__heading', 'SETTINGS'),
      this.group('Look', [
        this.sensitivity.row,
        this.fov.row,
        this.invertYRow,
        this.motion.row,
      ]),
      this.group('Graphics', [this.quality.row, this.note]),
      this.group('Audio', [this.volumes.master.row, this.volumes.music.row, this.volumes.effects.row]),
      this.group('Keys', [this.buildKeys(), this.conflict]),
      this.footer(),
    );
    this.element.append(panel);

    // One listener for whichever key is being captured. Registered once and
    // consulted only while `capturing` is set, so there is nothing to leak and
    // nothing to remove.
    globalThis.addEventListener('keydown', this.handleCapture);
  }

  /** Redraws from the settings actually in force. */
  update(settings: GameSettings): void {
    this.last = settings;
    this.sensitivity.set(settings.sensitivity);
    this.fov.set(settings.fov);
    this.invertY.set(settings.invertY ? 'yes' : 'no');
    this.motion.set(settings.motion);
    this.quality.set(settings.quality);

    for (const key of ['master', 'music', 'effects'] as const) {
      this.volumes[key].set(settings.volumes[key]);
    }

    for (const [action, button] of this.keys) {
      const capturing = this.capturing === action;
      button.textContent = capturing ? 'Press a key…' : describeBinding(settings.bindings[action]);
      button.classList.toggle('key--waiting', capturing);
    }

    const conflicts = bindingConflicts(settings);
    this.conflict.textContent =
      conflicts.length === 0
        ? ''
        : `Shared keys: ${conflicts
            .map((entry) => `${describeBinding([entry.code])} (${entry.actions.length} actions)`)
            .join(', ')}`;
    this.conflict.hidden = conflicts.length === 0;

    this.note.textContent = QUALITY_NOTES[settings.quality];
  }

  /** Stops listening for a key, so the screen can be closed mid-capture. */
  cancelCapture(): void {
    if (this.capturing === null) return;
    this.capturing = null;
  }

  destroy(): void {
    globalThis.removeEventListener('keydown', this.handleCapture);
    this.element.remove();
  }

  // ------------------------------------------------------------------ private

  private group(title: string, rows: readonly HTMLElement[]): HTMLElement {
    const section = element('section', 'settings__group');
    section.append(element('h3', 'settings__title', title));
    const list = element('div', 'settings__rows');
    list.append(...rows);
    section.append(list);
    return section;
  }

  private footer(): HTMLElement {
    const footer = element('div', 'settings__footer');
    const reset = element('button', 'btn', 'Reset to defaults');
    reset.type = 'button';
    reset.addEventListener('click', () => this.callbacks.onReset());

    const back = element('button', 'btn btn--primary', 'Back');
    back.type = 'button';
    back.addEventListener('click', () => this.callbacks.onBack());

    footer.append(reset, back);
    return footer;
  }

  private slider(
    label: string,
    min: number,
    max: number,
    step: number,
    format: (value: number) => string = (value) => value.toFixed(2),
    onInput?: (value: number) => void,
  ): Slider {
    const row = element('div', 'settings__row');
    const name = element('span', 'settings__label', label);
    const input = element('input', 'settings__slider');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.setAttribute('aria-label', label);
    const output = element('output', 'settings__value');

    input.addEventListener('input', () => {
      const value = Number(input.value);
      output.textContent = format(value);
      onInput?.(value);
    });

    row.append(name, input, output);
    return {
      row,
      input,
      output,
      set: (value: number) => {
        input.value = String(value);
        output.textContent = format(value);
      },
    };
  }

  private buildKeys(): HTMLElement {
    const list = element('div', 'keys');
    for (const action of ACTION_ORDER) {
      const row = element('div', 'keys__row');
      const label = element('span', 'settings__label', ACTION_LABELS[action]);

      const button = element('button', 'key');
      button.type = 'button';
      button.setAttribute('aria-label', `${ACTION_LABELS[action]} key`);
      button.addEventListener('click', () => {
        this.capturing = action;
        button.textContent = 'Press a key…';
        button.classList.add('key--waiting');
        button.focus();
      });

      this.keys.set(action, button);
      row.append(label, button);
      list.append(row);
    }
    return list;
  }

  /**
   * Captures the next key for whichever action is waiting.
   *
   * Escape cancels rather than binding: it is already the pause key, and a player who
   * has changed their mind should not have to bind something to escape.
   */
  private handleCapture = (event: KeyboardEvent): void => {
    const action = this.capturing;
    if (action === null) return;

    // The key is the answer to a question the panel asked, so it must not also be
    // the game's business: nothing else hears it, and the browser's own default
    // (scrolling on Space, say) does not happen either.
    event.preventDefault();
    event.stopPropagation();
    this.capturing = null;

    if (event.code === 'Escape') {
      // Redraw from what is in force, which puts the old key back on the button.
      this.update(this.last);
      return;
    }

    // `rebind` also takes the key off whatever else had it, so a rebind cannot
    // quietly leave one key doing two jobs.
    const next = rebind(this.last, action, [event.code]);
    this.callbacks.onChange({ bindings: next.bindings });
  };
}

const MOTION_LABELS: Record<MotionLevel, string> = {
  full: 'Full',
  reduced: 'Reduced',
  off: 'Off',
};

const QUALITY_NOTES: Record<QualityLevel, string> = {
  low: 'No shadows, fewer lamps, less smoke. For a laptop on battery.',
  medium: 'Shadows at half resolution, most of the lighting, all the smoke.',
  high: 'Everything: 4K shadows, full lighting, every plume, 16x filtering.',
};
