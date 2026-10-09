/**
 * Settings: the untrusted-data boundary.
 *
 * Everything here is about what happens when the file on disk is not what this
 * version wrote - a half-written save, a save from an older build, a save someone
 * edited by hand. The rule the tests hold it to is that settings can never be the
 * reason the demo fails to start.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '../../src/core/config.js';
import {
  DEFAULT_SETTINGS,
  FOV_RANGE,
  MOTION_LEVELS,
  MOTION_SCALES,
  QUALITY_LEVELS,
  QUALITY_PRESETS,
  SENSITIVITY_RANGE,
  SETTINGS_STORAGE_KEY,
  bindingConflicts,
  normaliseSettings,
  readSettings,
  rebind,
  writeSettings,
  type GameSettings,
  type SettingsStore,
} from '../../src/core/settings.js';
import { DEFAULT_BINDINGS } from '../../src/input/bindings.js';

function memoryStore(initial: Record<string, string> = {}): SettingsStore & { written: string[] } {
  const data = new Map(Object.entries(initial));
  const written: string[] = [];
  return {
    written,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
      written.push(value);
    },
  };
}

describe('the defaults', () => {
  it('matches the shipped configuration, so nothing changes for a player who never opens settings', () => {
    // If these disagreed, the demo would look different for everyone who never
    // touched the settings screen - which is nobody's intent.
    expect(DEFAULT_SETTINGS.fov).toBe(DEFAULT_CONFIG.camera.fov);
    expect(DEFAULT_SETTINGS.bindings).toEqual(DEFAULT_BINDINGS);
    expect(DEFAULT_SETTINGS.quality).toBe('high');
    expect(DEFAULT_SETTINGS.motion).toBe('full');
  });

  it('offers quality presets that get better as they get more expensive', () => {
    const order = ['low', 'medium', 'high'] as const;
    for (let index = 1; index < order.length; index += 1) {
      const worse = QUALITY_PRESETS[order[index - 1]!];
      const better = QUALITY_PRESETS[order[index]!];
      expect(better.pixelRatioCap, order[index]).toBeGreaterThanOrEqual(worse.pixelRatioCap);
      expect(better.shadowMapSize, order[index]).toBeGreaterThanOrEqual(worse.shadowMapSize);
      expect(better.anisotropy, order[index]).toBeGreaterThanOrEqual(worse.anisotropy);
      expect(better.smokeScale, order[index]).toBeGreaterThanOrEqual(worse.smokeScale);
      expect(better.lightScale, order[index]).toBeGreaterThanOrEqual(worse.lightScale);
      expect(better.label.length).toBeGreaterThan(0);
    }
  });

  it('turns motion off completely, and down to a quarter for reduced', () => {
    expect(MOTION_SCALES.off).toBe(0);
    expect(MOTION_SCALES.reduced).toBeGreaterThan(0);
    expect(MOTION_SCALES.reduced).toBeLessThan(0.5);
    expect(MOTION_SCALES.full).toBe(1);
  });
});

describe('normaliseSettings', () => {
  it('returns the defaults for anything that is not settings at all', () => {
    for (const junk of [null, undefined, 42, 'nonsense', [], true, () => {}]) {
      expect(normaliseSettings(junk)).toEqual(DEFAULT_SETTINGS);
    }
  });

  it('fills in what a partial object is missing', () => {
    const settings = normaliseSettings({ fov: 95 });
    expect(settings.fov).toBe(95);
    expect(settings.sensitivity).toBe(DEFAULT_SETTINGS.sensitivity);
    expect(settings.quality).toBe(DEFAULT_SETTINGS.quality);
    expect(settings.volumes).toEqual(DEFAULT_SETTINGS.volumes);
    expect(settings.bindings).toEqual(DEFAULT_BINDINGS);
  });

  it('clamps numbers into their ranges rather than rejecting them', () => {
    expect(normaliseSettings({ fov: 10_000 }).fov).toBe(FOV_RANGE.max);
    expect(normaliseSettings({ fov: -5 }).fov).toBe(FOV_RANGE.min);
    expect(normaliseSettings({ sensitivity: 0 }).sensitivity).toBe(SENSITIVITY_RANGE.min);
    expect(normaliseSettings({ sensitivity: 99 }).sensitivity).toBe(SENSITIVITY_RANGE.max);
    expect(normaliseSettings({ volumes: { master: 4 } }).volumes.master).toBe(1);
    expect(normaliseSettings({ volumes: { master: -1 } }).volumes.master).toBe(0);
  });

  it('refuses values that are not numbers at all', () => {
    const settings = normaliseSettings({ fov: 'wide', sensitivity: null, volumes: { master: 'loud' } });
    expect(settings.fov).toBe(DEFAULT_SETTINGS.fov);
    expect(settings.sensitivity).toBe(DEFAULT_SETTINGS.sensitivity);
    expect(settings.volumes.master).toBe(DEFAULT_SETTINGS.volumes.master);
  });

  it('refuses a non-finite number, which is not a setting anyone can have chosen', () => {
    expect(normaliseSettings({ fov: Number.NaN }).fov).toBe(DEFAULT_SETTINGS.fov);
    expect(normaliseSettings({ fov: Number.POSITIVE_INFINITY }).fov).toBe(DEFAULT_SETTINGS.fov);
  });

  it('only accepts the levels it knows', () => {
    expect(normaliseSettings({ quality: 'ultra' }).quality).toBe(DEFAULT_SETTINGS.quality);
    expect(normaliseSettings({ motion: 'subtle' }).motion).toBe(DEFAULT_SETTINGS.motion);
    for (const level of QUALITY_LEVELS) {
      expect(normaliseSettings({ quality: level }).quality).toBe(level);
    }
    for (const level of MOTION_LEVELS) {
      expect(normaliseSettings({ motion: level }).motion).toBe(level);
    }
  });

  it('keeps the boolean it is given and only that', () => {
    expect(normaliseSettings({ invertY: true }).invertY).toBe(true);
    expect(normaliseSettings({ invertY: 'yes' }).invertY).toBe(false);
  });
});

describe('bindings', () => {
  it('falls back per action, so one broken binding does not cost the others', () => {
    const settings = normaliseSettings({ bindings: { jump: ['KeyJ'] } });
    expect(settings.bindings.jump).toEqual(['KeyJ']);
    expect(settings.bindings.crouch).toEqual(DEFAULT_BINDINGS.crouch);
    expect(settings.bindings.interact).toEqual(DEFAULT_BINDINGS.interact);
  });

  it('refuses an empty binding, because an action with no key is a broken game', () => {
    // There would be no way for the player to discover why jump stopped working.
    expect(normaliseSettings({ bindings: { jump: [] } }).bindings.jump).toEqual(DEFAULT_BINDINGS.jump);
    expect(normaliseSettings({ bindings: { jump: 'Space' } }).bindings.jump).toEqual(DEFAULT_BINDINGS.jump);
    expect(normaliseSettings({ bindings: { jump: [null, 7] } }).bindings.jump).toEqual(DEFAULT_BINDINGS.jump);
  });

  it('drops junk entries but keeps the good ones', () => {
    const settings = normaliseSettings({ bindings: { jump: ['KeyJ', 5, '', null, 'KeyK'] } });
    expect(settings.bindings.jump).toEqual(['KeyJ', 'KeyK']);
  });

  it('reports which keys now do two things', () => {
    const settings = normaliseSettings({ bindings: { jump: ['KeyC'], crouch: ['KeyC', 'KeyZ'] } });
    const conflicts = bindingConflicts(settings);
    expect(conflicts).toEqual([{ code: 'KeyC', actions: ['jump', 'crouch'] }]);
  });

  it('reports nothing when every key is used once', () => {
    expect(bindingConflicts(DEFAULT_SETTINGS)).toEqual([]);
  });
});

describe('rebind', () => {
  it('replaces the action and takes the key off whatever else had it', () => {
    const settings = rebind(DEFAULT_SETTINGS, 'jump', ['KeyC']);
    expect(settings.bindings.jump).toEqual(['KeyC']);
    // C used to crouch; crouch keeps its other keys and loses this one.
    expect(settings.bindings.crouch).toEqual(['ControlLeft', 'ControlRight']);
    expect(bindingConflicts(settings)).toEqual([]);
  });

  it('shares the key rather than emptying another action', () => {
    // `interact` is bound to E and F; taking both would leave it unreachable.
    const settings = rebind(DEFAULT_SETTINGS, 'jump', ['KeyE', 'KeyF']);
    expect(settings.bindings.jump).toEqual(['KeyE', 'KeyF']);
    expect(settings.bindings.interact).toEqual(['KeyE', 'KeyF']);
  });

  it('ignores an empty list, which would unbind the action', () => {
    expect(rebind(DEFAULT_SETTINGS, 'jump', [])).toBe(DEFAULT_SETTINGS);
    expect(rebind(DEFAULT_SETTINGS, 'jump', [''])).toBe(DEFAULT_SETTINGS);
  });

  it('does not mutate what it was given', () => {
    const before = JSON.stringify(DEFAULT_SETTINGS);
    rebind(DEFAULT_SETTINGS, 'jump', ['KeyJ']);
    expect(JSON.stringify(DEFAULT_SETTINGS)).toBe(before);
  });
});

describe('reading and writing', () => {
  it('round-trips', () => {
    const store = memoryStore();
    const settings: GameSettings = {
      ...DEFAULT_SETTINGS,
      fov: 99,
      motion: 'reduced',
      volumes: { master: 0.1, music: 0.2, effects: 0.3 },
    };
    expect(writeSettings(store, settings)).toBe(true);
    expect(readSettings(store)).toEqual(settings);
  });

  it('writes under one documented key', () => {
    const store = memoryStore();
    writeSettings(store, DEFAULT_SETTINGS);
    expect(store.written).toHaveLength(1);
    expect(JSON.parse(store.written[0]!)).toHaveProperty('fov');
    expect(SETTINGS_STORAGE_KEY).toMatch(/^cyberparkour\./);
  });

  it('falls back to the defaults when storage is empty', () => {
    expect(readSettings(memoryStore())).toEqual(DEFAULT_SETTINGS);
  });

  it('falls back to the defaults when the file is corrupt', () => {
    for (const junk of ['{', 'null', '"a string"', '{"fov":', '[]']) {
      expect(readSettings(memoryStore({ [SETTINGS_STORAGE_KEY]: junk }))).toEqual(DEFAULT_SETTINGS);
    }
  });

  it('salvages what it can from a file an older version wrote', () => {
    const store = memoryStore({
      [SETTINGS_STORAGE_KEY]: JSON.stringify({ fov: 100, somethingElse: true }),
    });
    expect(readSettings(store).fov).toBe(100);
  });

  it('survives a store that throws', () => {
    const angry: SettingsStore = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(readSettings(angry)).toEqual(DEFAULT_SETTINGS);
    // The change still counts for this session, even though it could not be stored.
    expect(writeSettings(angry, DEFAULT_SETTINGS)).toBe(false);
  });
});
