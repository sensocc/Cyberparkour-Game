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
import { DEFAULT_SETTINGS, type VolumeSettings } from '../core/settings.js';
import { logger } from '../core/log.js';
import type { AudioCue } from './director.js';
import {
  MUSIC_SECONDS,
  SAMPLE_RATE,
  pitchStep,
  renderCheckpoint,
  renderClimbTick,
  renderComplete,
  renderDeath,
  renderFootstep,
  renderGrab,
  renderGust,
  renderHurt,
  renderLanding,
  renderMusic,
  renderPickup,
  renderScrape,
  renderUiClick,
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
  /**
   * Sets the three volume sliders.
   *
   * Effects covers everything the game triggers - footsteps, landings, the pickup
   * bell, the wind - and music covers the ambient track. Master multiplies both, so
   * pulling it to zero is silence without disturbing what the other two are set to.
   */
  setVolumes(volumes: VolumeSettings): void;
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
  setVolumes(): void {}
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
  private readonly sfxGain: GainNode;
  private readonly musicGain: GainNode;
  private readonly windGain: GainNode;
  private volumes: VolumeSettings = DEFAULT_SETTINGS.volumes;
  private musicEnabled = false;
  private readonly windSource: AudioBufferSourceNode | null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private musicSource: AudioBufferSourceNode | null = null;
  private muted = false;
  private wind = 0;

  constructor(options: WebAudioOptions) {
    const factory = options.contextFactory ?? (() => new AudioContext({ sampleRate: SAMPLE_RATE }));
    this.context = factory();

    this.master = this.context.createGain();
    this.master.gain.value = this.volumes.master;
    this.master.connect(this.context.destination);

    // One node for everything the game triggers, so the effects slider is a single
    // multiplication rather than a gain per cue.
    this.sfxGain = this.context.createGain();
    this.sfxGain.gain.value = this.volumes.effects;
    this.sfxGain.connect(this.master);

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
      node.connect(this.sfxGain);
      source.start();
    } catch (error) {
      logger.debug('audio', `could not play "${key}"`, { error: String(error) });
    }
  }

  play(cue: AudioCue): void {
    if (this.muted) return;

    try {
      switch (cue.kind) {
        case 'footstep': {
          // A slide borrows the sprint sample; there is no such thing as a
          // "sliding footstep", and it would only add a buffer nobody asked for.
          const gait = cue.gait === 'slide' ? 'sprint' : cue.gait;
          this.oneShot(`step-${gait}-${cue.surface}-${cue.variant}`, () =>
            renderFootstep({ variant: cue.variant as FootstepVariant, gait, surface: cue.surface }),
          );
          break;
        }
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
        case 'pickup':
          // One buffer per pitch step, so a pickup does not have to be
          // re-synthesised every time one is taken. The key is the *step*, not the
          // index: `renderPickup` clamps its own pitch, so keying on the index would
          // cache a separate (identical) buffer for every past the tenth.
          this.oneShot(`pickup-${pitchStep(cue.index)}`, () => renderPickup(cue.index));
          break;
        case 'complete':
          this.oneShot('complete', renderComplete);
          break;
        case 'checkpoint':
          this.oneShot('checkpoint', renderCheckpoint);
          break;
        case 'ui-click':
          // Quieter than everything else: it plays on every button, and it is the
          // one cue that must never be the loudest thing in the room.
          this.oneShot('ui-click', renderUiClick, 0.6);
          break;
      }
    } catch (error) {
      logger.debug('audio', 'cue failed', { cue: cue.kind, error: String(error) });
    }
  }

  setWind(intensity: number): void {
    this.wind = clamp01(intensity);
    this.applyGains(0.15);
  }

  setVolumes(volumes: VolumeSettings): void {
    this.volumes = volumes;
    this.applyGains(0.05);
  }

  /**
   * Pushes the mute flag and the three volumes into the graph.
   *
   * The only place any gain is written, and that is the point: mute used to be
   * re-applied by hand in three methods, which is how a "muted" game ended up with
   * the wind still audible after a volume change.
   */
  private applyGains(smoothing: number): void {
    try {
      const time = this.context.currentTime;
      const master = this.muted ? 0 : this.volumes.master;
      this.master.gain.setTargetAtTime(master, time, smoothing);
      this.sfxGain.gain.setTargetAtTime(this.volumes.effects, time, smoothing);
      this.windGain.gain.setTargetAtTime(this.wind * 0.5 * this.volumes.effects, time, smoothing);
      const music = this.musicSource ? 0.34 : 0;
      this.musicGain.gain.setTargetAtTime(this.musicEnabled ? music * this.volumes.music : 0, time, smoothing);
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
      this.musicEnabled = enabled;
      this.applyGains(0.4);
    } catch (error) {
      logger.debug('audio', 'music could not be started', { error: String(error) });
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyGains(0.05);
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
      this.wind = 0;
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
