/**
 * Player settings: what the demo remembers about how you want to play it.
 *
 * Everything here is *data*, and everything that reads it is given it - the input
 * layer, the camera, the renderer and the mixer all take their numbers from here
 * rather than from `DEFAULT_CONFIG`, because V0.6's whole premise is that the player
 * gets to disagree with the defaults.
 *
 * Two rules run through the file:
 *
 *  - **Normalise, never trust.** What comes back from storage is a JSON blob a
 *    previous version (or a curious player) wrote, so every value is clamped into
 *    range, every enum is checked against its list, and anything unrecognised falls
 *    back to the default. A corrupt settings file must never be able to stop the
 *    game from starting.
 *  - **Defaults live in one place.** `DEFAULT_SETTINGS` is the same object the
 *    "Reset to defaults" button writes, so there is no second copy to drift.
 */

import { DEFAULT_BINDINGS, type Bindings, type KeyAction } from '../input/bindings.js';

/** Graphics presets. One choice, several consequences - see `QUALITY_PRESETS`. */
export type QualityLevel = 'low' | 'medium' | 'high';

/** How much camera motion to apply. */
export type MotionLevel = 'full' | 'reduced' | 'off';

export const QUALITY_LEVELS: readonly QualityLevel[] = ['low', 'medium', 'high'];
export const MOTION_LEVELS: readonly MotionLevel[] = ['full', 'reduced', 'off'];

/**
 * What a graphics preset turns into.
 *
 * Kept as data rather than as a chain of `if (quality === 'low')` checks in the
 * renderer: the preset *is* these numbers, and having them in a table means the
 * settings screen can describe them and a test can hold them to their promises
 * (each preset must beat the one below it).
 */
export interface QualityPreset {
  readonly label: string;
  /** Cap on the drawing-buffer scale. 1 is "one pixel per CSS pixel". */
  readonly pixelRatioCap: number;
  readonly shadows: boolean;
  /** Shadow map resolution, when shadows are on. */
  readonly shadowMapSize: number;
  /** Anisotropic filtering samples to ask for (the GPU may offer fewer). */
  readonly anisotropy: number;
  /** Fraction of the smoke puffs to draw. */
  readonly smokeScale: number;
  /** Fraction of the scene's point lights to keep lit. */
  readonly lightScale: number;
}

export const QUALITY_PRESETS: Record<QualityLevel, QualityPreset> = {
  low: {
    label: 'Low',
    pixelRatioCap: 1,
    shadows: false,
    shadowMapSize: 1024,
    anisotropy: 2,
    smokeScale: 0.35,
    lightScale: 0.4,
  },
  medium: {
    label: 'Medium',
    pixelRatioCap: 1.5,
    shadows: true,
    shadowMapSize: 2048,
    anisotropy: 8,
    smokeScale: 0.7,
    lightScale: 0.75,
  },
  high: {
    label: 'High',
    pixelRatioCap: 2,
    shadows: true,
    shadowMapSize: 4096,
    anisotropy: 16,
    smokeScale: 1,
    lightScale: 1,
  },
};

/**
 * How much of the camera's motion effects to apply.
 *
 * `reduced` is the accessibility choice, and it is deliberately a real reduction
 * rather than a token one: for a player who gets motion sick from a bobbing camera,
 * a quarter of the effect is not a compromise, it is the difference between playing
 * and not playing.
 */
export const MOTION_SCALES: Record<MotionLevel, number> = {
  full: 1,
  reduced: 0.25,
  off: 0,
};

export interface VolumeSettings {
  readonly master: number;
  readonly music: number;
  readonly effects: number;
}

/** Everything the player can change. */
export interface GameSettings {
  /** Mouse-look sensitivity, as a multiple of the tuned base. */
  readonly sensitivity: number;
  /** Whether moving the mouse up looks down. */
  readonly invertY: boolean;
  /** Vertical field of view, in degrees. */
  readonly fov: number;
  readonly quality: QualityLevel;
  readonly motion: MotionLevel;
  readonly volumes: VolumeSettings;
  readonly bindings: Bindings;
}

/** Bounds for each numeric setting: the order the UI shows them in, and the clamps. */
export const SENSITIVITY_RANGE = { min: 0.25, max: 3, step: 0.05 } as const;
export const FOV_RANGE = { min: 65, max: 110, step: 1 } as const;

/**
 * The tuned defaults.
 *
 * The field of view is the value `DEFAULT_CONFIG.camera.fov` ships with - a test
 * asserts the two agree, because a default that disagreed with the config would
 * silently change the demo for everyone who never opens the settings screen.
 */
export const DEFAULT_SETTINGS: GameSettings = {
  sensitivity: 1,
  invertY: false,
  fov: 82,
  quality: 'high',
  motion: 'full',
  volumes: { master: 0.8, music: 0.45, effects: 0.85 },
  bindings: DEFAULT_BINDINGS,
};

export const SETTINGS_STORAGE_KEY = 'cyberparkour.settings.v1';

/** The two-method slice of `localStorage` this module needs. */
export interface SettingsStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const ACTIONS = Object.keys(DEFAULT_BINDINGS) as KeyAction[];

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * Turns anything at all into usable settings.
 *
 * This is the only place that reads untrusted data, which is why it is pure and
 * total: whatever it is handed - a half-written file, a file from an older version,
 * a file someone edited by hand - it returns a complete, in-range set.
 */
export function normaliseSettings(raw: unknown): GameSettings {
  const source = asRecord(raw);
  const volumes = asRecord(source.volumes);

  return {
    sensitivity: clampNumber(
      source.sensitivity,
      SENSITIVITY_RANGE.min,
      SENSITIVITY_RANGE.max,
      DEFAULT_SETTINGS.sensitivity,
    ),
    invertY: typeof source.invertY === 'boolean' ? source.invertY : DEFAULT_SETTINGS.invertY,
    fov: clampNumber(source.fov, FOV_RANGE.min, FOV_RANGE.max, DEFAULT_SETTINGS.fov),
    quality: oneOf(source.quality, QUALITY_LEVELS, DEFAULT_SETTINGS.quality),
    motion: oneOf(source.motion, MOTION_LEVELS, DEFAULT_SETTINGS.motion),
    volumes: {
      master: clampNumber(volumes.master, 0, 1, DEFAULT_SETTINGS.volumes.master),
      music: clampNumber(volumes.music, 0, 1, DEFAULT_SETTINGS.volumes.music),
      effects: clampNumber(volumes.effects, 0, 1, DEFAULT_SETTINGS.volumes.effects),
    },
    bindings: normaliseBindings(source.bindings),
  };
}

/**
 * Bindings, action by action.
 *
 * An action with no key left is not a preference, it is a broken game - the player
 * could never jump again and would have no way to discover why - so a missing or
 * empty binding falls back to the default rather than to nothing.
 */
function normaliseBindings(raw: unknown): Bindings {
  const source = asRecord(raw);
  const result = {} as Record<KeyAction, readonly string[]>;

  for (const action of ACTIONS) {
    const codes = source[action];
    const cleaned = Array.isArray(codes)
      ? codes.filter((code): code is string => typeof code === 'string' && code.length > 0 && code.length < 32)
      : [];
    result[action] = cleaned.length > 0 ? Object.freeze(cleaned) : DEFAULT_BINDINGS[action];
  }

  return result as Bindings;
}

/** Reads settings from storage, falling back to the defaults on anything unusable. */
export function readSettings(store?: SettingsStore): GameSettings {
  if (!store) return DEFAULT_SETTINGS;
  let text: string | null = null;
  try {
    text = store.getItem(SETTINGS_STORAGE_KEY);
  } catch {
    // A store that throws (private mode, a quota in the middle of a write) is the
    // same as one that is empty.
    return DEFAULT_SETTINGS;
  }
  if (!text) return DEFAULT_SETTINGS;

  try {
    return normaliseSettings(JSON.parse(text));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Writes settings, reporting whether they were stored. */
export function writeSettings(store: SettingsStore | undefined, settings: GameSettings): boolean {
  if (!store) return false;
  try {
    store.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch {
    // Storage being unavailable is not a reason to lose the change: it applies for
    // this session either way.
    return false;
  }
}

/**
 * Which actions share a key.
 *
 * Not an error - a player may genuinely want one key to do two things, and the input
 * layer resolves it by declaration order - but it is almost always a mistake, and the
 * settings screen says so rather than silently letting a jump key stop crouching.
 */
export function bindingConflicts(settings: GameSettings): { code: string; actions: KeyAction[] }[] {
  const owners = new Map<string, KeyAction[]>();
  for (const action of ACTIONS) {
    for (const code of settings.bindings[action]) {
      const list = owners.get(code) ?? [];
      list.push(action);
      owners.set(code, list);
    }
  }

  const conflicts: { code: string; actions: KeyAction[] }[] = [];
  for (const [code, actions] of owners) {
    if (actions.length > 1) conflicts.push({ code, actions });
  }
  return conflicts.sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * A copy of `settings` with one action bound to exactly `codes`.
 *
 * The binding is *replaced* rather than appended to, and the same code is stripped
 * from whatever else had it: rebinding jump to the key that used to sprint should
 * move sprint off it, not leave one key doing both.
 */
export function rebind(settings: GameSettings, action: KeyAction, codes: readonly string[]): GameSettings {
  const cleaned = codes.filter((code) => typeof code === 'string' && code.length > 0);
  if (cleaned.length === 0) return settings;

  const bindings = {} as Record<KeyAction, readonly string[]>;
  for (const key of ACTIONS) bindings[key] = settings.bindings[key];
  bindings[action] = Object.freeze([...cleaned]);

  for (const other of ACTIONS) {
    if (other === action) continue;
    const kept = bindings[other].filter((code) => !cleaned.includes(code));
    // Never leave an action unbound: if taking the key away would empty it, the
    // other action keeps it and this one shares it instead.
    if (kept.length > 0) bindings[other] = Object.freeze(kept);
  }

  return { ...settings, bindings: bindings as Bindings };
}
