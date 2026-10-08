/**
 * The Web Audio backend.
 *
 * The synthesiser is tested numerically elsewhere; what matters here is the
 * wiring - that cues map to the right sounds, that the wind is continuous, that
 * the music loops, and above all that a browser which refuses any of it degrades
 * to silence instead of breaking the game.
 */

import { describe, expect, it, vi } from 'vitest';

import { SilentAudio, WebAudio, createAudio, type AudioOutput } from '../../src/audio/engine.js';
import type { AudioCue } from '../../src/audio/director.js';
import { DEFAULT_CONFIG } from '../../src/core/config.js';
import { logsFrom, messages } from '../helpers/logs.js';

/** The smallest AudioContext that satisfies the engine. */
function fakeContext() {
  const gains: { value: number; events: number }[] = [];
  const sources: FakeSource[] = [];
  const buffers: { length: number }[] = [];

  interface FakeSource {
    loop: boolean;
    loopEnd: number;
    buffer: unknown;
    started: boolean;
    stopped: boolean;
    connect(): void;
    start(): void;
    stop(): void;
  }

  const gainNode = (): unknown => {
    const record = { value: 0, events: 0 };
    gains.push(record);
    return {
      gain: {
        get value() {
          return record.value;
        },
        set value(next: number) {
          record.value = next;
        },
        setTargetAtTime(next: number) {
          record.value = next;
          record.events += 1;
        },
      },
      connect() {},
    };
  };

  const context = {
    currentTime: 0,
    destination: {},
    sampleRate: 48000,
    createGain: gainNode,
    createBuffer: (_channels: number, length: number) => {
      buffers.push({ length });
      const data = new Float32Array(length);
      return { length, getChannelData: () => data, copyToChannel() {} } as unknown as AudioBuffer;
    },
    createBufferSource: (): FakeSource => {
      const node: FakeSource = {
        buffer: null,
        loop: false,
        loopEnd: 0,
        started: false,
        stopped: false,
        connect() {},
        start() {
          node.started = true;
        },
        stop() {
          node.stopped = true;
        },
      };
      sources.push(node);
      return node;
    },
    resume: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };

  return { context: context as unknown as AudioContext, gains, sources, buffers };
}

function makeEngine() {
  const fake = fakeContext();
  const engine = new WebAudio({ config: DEFAULT_CONFIG, contextFactory: () => fake.context });
  return { engine, ...fake };
}

const EVERY_CUE: AudioCue[] = [
  { kind: 'footstep', gait: 'walk', variant: 0, surface: 'metal' },
  { kind: 'footstep', gait: 'sprint', variant: 1, surface: 'grate' },
  { kind: 'footstep', gait: 'crouch', variant: 2, surface: 'concrete' },
  { kind: 'scrape', variant: 0 },
  { kind: 'climb-tick', variant: 1 },
  { kind: 'land', intensity: 0 },
  { kind: 'land', intensity: 2 },
  { kind: 'grab' },
  { kind: 'mantle' },
  { kind: 'pull-up' },
  { kind: 'slide-start' },
  { kind: 'slide-stop' },
  { kind: 'gust' },
  { kind: 'hurt', damage: 20 },
  { kind: 'death' },
  { kind: 'pickup', index: 3 },
  { kind: 'complete' },
];

describe('SilentAudio', () => {
  it('accepts every call without doing anything', () => {
    const silent = new SilentAudio();
    expect(() => {
      const output = silent as unknown as AudioOutput;
      for (const cue of EVERY_CUE) output.play(cue);
      output.setWind(1);
      output.setMusic(true);
      output.setMuted(true);
      output.resume();
      output.silence();
      output.dispose();
    }).not.toThrow();
    expect(silent.isSilent).toBe(true);
  });
});

describe('WebAudio', () => {
  it('builds its gain nodes, and a looping wind source, up front', () => {
    const { engine, sources } = makeEngine();
    try {
      expect(sources).toHaveLength(1);
      expect(sources[0]?.loop).toBe(true);
      expect(sources[0]?.started).toBe(true);
    } finally {
      engine.dispose();
    }
  });

  it('plays every cue without throwing', () => {
    const { engine, sources } = makeEngine();
    try {
      const before = sources.length;
      for (const cue of EVERY_CUE) engine.play(cue);
      // `gust` is continuous and `slide-stop` is a silence, so neither starts a
      // source of its own.
      expect(sources.length).toBe(before + EVERY_CUE.length - 2);
      expect(sources.slice(before).every((source) => source.started)).toBe(true);
    } finally {
      engine.dispose();
    }
  });

  it('synthesises each sound once and reuses the buffer', () => {
    const { engine, buffers } = makeEngine();
    try {
      const before = buffers.length;
      for (let repeat = 0; repeat < 3; repeat += 1) {
        engine.play({ kind: 'footstep', gait: 'walk', variant: 0, surface: 'metal' });
      }
      expect(buffers.length).toBe(before + 1);
    } finally {
      engine.dispose();
    }
  });

  it('does nothing while muted', () => {
    const { engine, sources } = makeEngine();
    try {
      engine.setMuted(true);
      const before = sources.length;
      for (const cue of EVERY_CUE) engine.play(cue);
      expect(sources.length).toBe(before);
    } finally {
      engine.dispose();
    }
  });

  it('fades the wind rather than snapping it', () => {
    const { engine, gains } = makeEngine();
    try {
      // The last gain node is the wind bus.
      const wind = gains[gains.length - 1];
      engine.setWind(0.5);
      expect(wind?.events).toBeGreaterThan(0);
      expect(wind?.value).toBeCloseTo(0.25, 6);

      // Out-of-range values are clamped.
      engine.setWind(5);
      expect(wind?.value).toBeCloseTo(0.5, 6);
      engine.setWind(-2);
      expect(wind?.value).toBe(0);
    } finally {
      engine.dispose();
    }
  });

  it('starts the music once and stops asking after that', () => {
    const { engine, sources } = makeEngine();
    try {
      const before = sources.length;
      engine.setMusic(true);
      engine.setMusic(true);
      engine.setMusic(true);
      expect(sources.length).toBe(before + 1);
      expect(sources[before]?.loop).toBe(true);

      engine.setMusic(false);
      expect(sources.length).toBe(before + 1);
    } finally {
      engine.dispose();
    }
  });

  it('dispose stops the wind, the music and the context', () => {
    const { engine, sources, context } = makeEngine();
    engine.setMusic(true);
    engine.dispose();

    expect(sources.every((source) => source.stopped)).toBe(true);
    expect(context.close).toHaveBeenCalled();
  });

  it('resume is best-effort', () => {
    const { engine, context } = makeEngine();
    try {
      expect(() => engine.resume()).not.toThrow();
      expect(context.resume).toHaveBeenCalled();
    } finally {
      engine.dispose();
    }
  });

  it('leaves the caller to catch a context that cannot make nodes', () => {
    // The engine builds its graph in the constructor, so a broken context throws
    // there - which is exactly the case `createAudio` exists to absorb.
    const broken = {
      createGain() {
        throw new Error('device busy');
      },
    } as unknown as AudioContext;

    expect(() => new WebAudio({ config: DEFAULT_CONFIG, contextFactory: () => broken })).toThrow();
  });
});

describe('createAudio', () => {
  it('returns a working engine when the browser has Web Audio', () => {
    const fake = fakeContext();
    const previous = (globalThis as { AudioContext?: unknown }).AudioContext;
    (globalThis as { AudioContext?: unknown }).AudioContext = function AudioContext() {
      return fake.context;
    } as unknown;

    try {
      const audio: AudioOutput = createAudio({ config: DEFAULT_CONFIG });
      expect(audio.isSilent).toBe(false);
      audio.dispose();
    } finally {
      (globalThis as { AudioContext?: unknown }).AudioContext = previous;
    }
  });

  it('falls back to silence when Web Audio is missing', () => {
    const previous = (globalThis as { AudioContext?: unknown }).AudioContext;
    (globalThis as { AudioContext?: unknown }).AudioContext = undefined;

    try {
      const { result, logs } = logsFrom(() => createAudio({ config: DEFAULT_CONFIG }));
      expect(result.isSilent).toBe(true);
      expect(messages(logs).join(' ')).toContain('Web Audio is unavailable');
    } finally {
      (globalThis as { AudioContext?: unknown }).AudioContext = previous;
    }
  });

  it('falls back to silence when the context cannot be created', () => {
    const previous = (globalThis as { AudioContext?: unknown }).AudioContext;
    (globalThis as { AudioContext?: unknown }).AudioContext = function AudioContext() {
      throw new Error('blocked by policy');
    } as unknown;

    try {
      const { result, logs } = logsFrom(() => createAudio({ config: DEFAULT_CONFIG }));
      expect(result.isSilent).toBe(true);
      expect(messages(logs).join(' ')).toContain('could not start');
    } finally {
      (globalThis as { AudioContext?: unknown }).AudioContext = previous;
    }
  });

  it('falls back to silence when the synthesiser itself fails', () => {
    const previous = (globalThis as { AudioContext?: unknown }).AudioContext;
    (globalThis as { AudioContext?: unknown }).AudioContext = function AudioContext() {
      return {
        createGain() {
          throw new Error('no nodes for you');
        },
      };
    } as unknown;

    try {
      const { result } = logsFrom(() => createAudio({ config: DEFAULT_CONFIG }));
      expect(result.isSilent).toBe(true);
    } finally {
      (globalThis as { AudioContext?: unknown }).AudioContext = previous;
    }
  });
});
