/**
 * Turning cues into sound.
 *
 * All the synthesis happens up front, once, into plain buffers; this class only
 * schedules them. That keeps the Web Audio surface tiny - create a context, build
 * buffers, play them - and means the interesting code is testable without it.
 *
 * Every entry point is defensive. Audio must never be able to break the game, so
 * a browser that refuses a context, or throws on playback, degrades to silence.
 */

import type { GameConfig } from '../core/config.js';
import { clamp01 } from '../core/math.js';
import { logger } from '../core/log.js';
import type { AudioCue } from './director.js';
import {
  MUSIC_SECONDS,
  SAMPLE_RATE,
  renderClimbTick,
  renderDeath,
  renderFootstep,
  renderGrab,
  renderGust,
  renderHurt,
  renderLanding,
  renderMusic,
  renderScrape,
  renderWhoosh,
  type FootstepVariant,
} from './synth.js';

/** Everything the game needs from an audio backend. */
export interface AudioOutput {
  /** True when this backend produces no sound, e.g. Web Audio is unavailable. */
  readonly isSilent: boolean;
  /** Plays one cue. Never throws. */
  play(cue: AudioCue): void;
  /** Sets the continuous wind level, 0..1. */
  setWind(intensity: number): void;
  /** Starts or stops the ambient music. */
  setMusic(enabled: boolean): void;
  setMuted(muted: boolean): void;
  /** Called from a user gesture, which is what browsers require. */
  resume(): void;
  /** Stops every sound, for a respawn or a pause. */
  silence(): void;
  dispose(): void;
}

/** A do-nothing backend, used when audio is unavailable or turned off. */
export class SilentAudio implements AudioOutput {
  readonly isSilent = true;
  play(): void {}
  setWind(): void {}
  setMusic(): void {}
  setMuted(): void {}
  resume(): void {}
  silence(): void {}
  dispose(): void {}
}

export interface WebAudioOptions {
  readonly config: GameConfig;
  /** Injectable for tests; defaults to the real thing. */
  readonly contextFactory?: () => AudioContext;
}

/** Web Audio playback of the synthesised soundbank. */
export class WebAudio implements AudioOutput {
  readonly isSilent = false;
  private readonly context: AudioContext;
  private readonly master: GainNode;
  private readonly musicGain: GainNode;
  private readonly windGain: GainNode;
  private readonly windSource: AudioBufferSourceNode | null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private musicSource: AudioBufferSourceNode | null = null;
  private muted = false;
  private wind = 0;

  constructor(options: WebAudioOptions) {
    const factory = options.contextFactory ?? (() => new AudioContext({ sampleRate: SAMPLE_RATE }));
    this.context = factory();

    this.master = this.context.createGain();
    this.master.gain.value = 1;
    this.master.connect(this.context.destination);

    this.musicGain = this.context.createGain();
    this.musicGain.gain.value = 0;
    this.musicGain.connect(this.master);

    this.windGain = this.context.createGain();
    this.windGain.gain.value = 0;
    this.windGain.connect(this.master);

    // The wind is the only continuous sound, so it is a looping source whose
    // gain the game nudges rather than a cue that retriggers.
    const windBuffer = this.buffer('gust-0', () => renderGust(0));
    this.windSource = this.context.createBufferSource();
    this.windSource.buffer = windBuffer;
    this.windSource.loop = true;
    this.windSource.connect(this.windGain);
    this.windSource.start();

    void options.config;
  }

  private buffer(key: string, render: () => Float32Array): AudioBuffer {
    const cached = this.buffers.get(key);
    if (cached) return cached;

    const samples = render();
    const buffer = this.context.createBuffer(1, samples.length, SAMPLE_RATE);
    buffer.getChannelData(0).set(samples);
    this.buffers.set(key, buffer);
    return buffer;
  }

  private oneShot(key: string, render: () => Float32Array, gain = 1): void {
    try {
      const source = this.context.createBufferSource();
      source.buffer = this.buffer(key, render);
      const node = this.context.createGain();
      node.gain.value = gain;
      source.connect(node);
      node.connect(this.master);
      source.start();
    } catch (error) {
      logger.debug('audio', `could not play "${key}"`, { error: String(error) });
    }
  }

  play(cue: AudioCue): void {
    if (this.muted) return;

    try {
      switch (cue.kind) {
        case 'footstep':
          this.oneShot(`step-${cue.gait}-${cue.variant}`, () =>
            renderFootstep({ variant: cue.variant as FootstepVariant, gait: cue.gait === 'slide' ? 'sprint' : cue.gait }),
          );
          break;
        case 'scrape':
          this.oneShot(`scrape-${cue.variant % 3}`, () => renderScrape(cue.variant % 3));
          break;
        case 'climb-tick':
          this.oneShot(`climb-${cue.variant % 2}`, () => renderClimbTick(cue.variant % 2));
          break;
        case 'land':
          this.oneShot(`land-${cue.intensity}`, () => renderLanding(cue.intensity));
          break;
        case 'grab':
          this.oneShot('grab', renderGrab);
          break;
        case 'mantle':
          this.oneShot('mantle', renderGrab, 0.7);
          break;
        case 'pull-up':
          this.oneShot('pull-up', renderGrab, 1.1);
          break;
        case 'gust':
          break; // continuous, handled by setWind
        case 'hurt':
          this.oneShot('hurt', renderHurt);
          break;
        case 'death':
          this.oneShot('death', renderDeath);
          break;
        case 'slide-start':
          this.oneShot('scrape-0', () => renderScrape(0), 1.2);
          break;
        case 'slide-stop':
          break;
        case 'whoosh':
          this.oneShot('whoosh', renderWhoosh);
          break;
      }
    } catch (error) {
      logger.debug('audio', 'cue failed', { cue: cue.kind, error: String(error) });
    }
  }

  setWind(intensity: number): void {
    this.wind = clamp01(intensity);
    if (this.muted) return;
    try {
      this.windGain.gain.setTargetAtTime(this.wind * 0.5, this.context.currentTime, 0.15);
    } catch {
      // A scheduler hiccup is not worth surfacing.
    }
  }

  setMusic(enabled: boolean): void {
    try {
      if (enabled && !this.musicSource) {
        const source = this.context.createBufferSource();
        source.buffer = this.buffer('music', renderMusic);
        source.loop = true;
        source.loopEnd = MUSIC_SECONDS;
        source.connect(this.musicGain);
        source.start();
        this.musicSource = source;
      }
      this.musicGain.gain.setTargetAtTime(enabled && !this.muted ? 0.34 : 0, this.context.currentTime, 0.4);
    } catch (error) {
      logger.debug('audio', 'music could not be started', { error: String(error) });
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      this.master.gain.setTargetAtTime(muted ? 0 : 1, this.context.currentTime, 0.05);
      this.windGain.gain.setTargetAtTime(muted ? 0 : this.wind * 0.5, this.context.currentTime, 0.05);
      this.musicGain.gain.setTargetAtTime(muted || !this.musicSource ? 0 : 0.34, this.context.currentTime, 0.05);
    } catch {
      // Ignore.
    }
  }

  get isMuted(): boolean {
    return this.muted;
  }

  resume(): void {
    try {
      void this.context.resume();
    } catch (error) {
      logger.debug('audio', 'context could not resume', { error: String(error) });
    }
  }

  silence(): void {
    try {
      this.windGain.gain.value = 0;
    } catch {
      // Ignore.
    }
  }

  dispose(): void {
    try {
      this.windSource?.stop();
      this.musicSource?.stop();
      this.musicSource = null;
      for (const buffer of this.buffers.values()) void buffer;
      this.buffers.clear();
      void this.context.close();
    } catch {
      // Ignore.
    }
  }
}

/**
 * Builds the best audio backend available.
 *
 * A browser without Web Audio, a context the browser refuses to create, or a
 * synthesiser that throws all end up as `SilentAudio`, because a demo with no
 * sound is fine and a demo that crashes on start is not.
 */
export function createAudio(options: WebAudioOptions): AudioOutput {
  try {
    if (typeof globalThis.AudioContext === 'undefined') {
      logger.warn('audio', 'Web Audio is unavailable - running silently');
      return new SilentAudio();
    }
    return new WebAudio(options);
  } catch (error) {
    logger.warn('audio', 'audio could not start - running silently', { error: String(error) });
    return new SilentAudio();
  }
}
