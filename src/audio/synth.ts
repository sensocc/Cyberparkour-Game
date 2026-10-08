/**
 * Offline synthesis for every sound in the demo.
 *
 * There are no audio files. V0.2 asks for "basic sound effects" and "basic
 * background music", and generating them is the same trick the textures use:
 * the palette lives in code, it is reviewable in a diff, and it cannot drift
 * from what ships.
 *
 * Everything here is a pure function from parameters to a mono `Float32Array` at
 * `SAMPLE_RATE`, so the whole soundbank is verifiable numerically - length, peak,
 * RMS, DC offset - without a browser or a speaker.
 */

import { createRandom } from '../core/random.js';
import type { AcousticMaterial } from '../game/level/surfaces.js';

export const SAMPLE_RATE = 48000;

/** Write `source` into `target` at `offset`, scaled, summing rather than replacing. */
export function mixInto(
  target: Float32Array,
  source: Float32Array,
  offset: number,
  gain = 1,
): void {
  for (let index = 0; index < source.length; index += 1) {
    const at = offset + index;
    if (at < 0 || at >= target.length) continue;
    target[at] = (target[at] as number) + (source[index] as number) * gain;
  }
}

export function scaleInPlace(samples: Float32Array, gain: number): void {
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = (samples[index] as number) * gain;
  }
}

/** Scales so the loudest sample sits at `peak`, leaving headroom by default. */
export function normalise(samples: Float32Array, peak = 0.9): void {
  let loudest = 0;
  for (const sample of samples) loudest = Math.max(loudest, Math.abs(sample));
  if (loudest <= 1e-9) return;
  scaleInPlace(samples, peak / loudest);
}

export function peakOf(samples: Float32Array): number {
  let loudest = 0;
  for (const sample of samples) loudest = Math.max(loudest, Math.abs(sample));
  return loudest;
}

export function rmsOf(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let total = 0;
  for (const sample of samples) total += sample * sample;
  return Math.sqrt(total / samples.length);
}

export function meanOf(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let total = 0;
  for (const sample of samples) total += sample;
  return total / samples.length;
}

// ------------------------------------------------------------- primitives

function whiteNoise(length: number, seed: number): Float32Array {
  const random = createRandom(seed);
  const samples = new Float32Array(length);
  for (let index = 0; index < length; index += 1) samples[index] = random() * 2 - 1;
  return samples;
}

/** One-pole low-pass. Cheap, and enough to shape noise into a material. */
export function lowpass(samples: Float32Array, cutoffHz: number, sampleRate = SAMPLE_RATE): void {
  const dt = 1 / sampleRate;
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const alpha = dt / (rc + dt);
  let previous = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const current = samples[index] as number;
    previous += alpha * (current - previous);
    samples[index] = previous;
  }
}

/** One-pole high-pass, the complement of `lowpass`. */
export function highpass(samples: Float32Array, cutoffHz: number, sampleRate = SAMPLE_RATE): void {
  const dt = 1 / sampleRate;
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const alpha = rc / (rc + dt);
  let previousInput = samples[0] as number;
  let previousOutput = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const current = samples[index] as number;
    previousOutput = alpha * (previousOutput + current - previousInput);
    previousInput = current;
    samples[index] = previousOutput;
  }
}

/** An exponential decay envelope with a short attack ramp. */
export function decayEnvelope(
  length: number,
  attackSeconds: number,
  decaySeconds: number,
  sampleRate = SAMPLE_RATE,
): Float32Array {
  const envelope = new Float32Array(length);
  const attack = Math.max(1, attackSeconds * sampleRate);
  const decay = Math.max(1, decaySeconds * sampleRate);

  for (let index = 0; index < length; index += 1) {
    const rise = index < attack ? index / attack : 1;
    envelope[index] = rise * Math.exp(-index / decay);
  }
  return envelope;
}

/** A decaying sine, optionally sweeping its frequency (a "thud" or a "kick"). */
export function decayingTone(
  length: number,
  startHz: number,
  endHz: number,
  decaySeconds: number,
  sampleRate = SAMPLE_RATE,
): Float32Array {
  const samples = new Float32Array(length);
  const decay = Math.max(1, decaySeconds * sampleRate);
  let phase = 0;

  for (let index = 0; index < length; index += 1) {
    const t = index / length;
    const frequency = startHz + (endHz - startHz) * t;
    phase += (2 * Math.PI * frequency) / sampleRate;
    samples[index] = Math.sin(phase) * Math.exp(-index / decay);
  }
  return samples;
}

/** A rectangular pulse train used as a crude oscillator, for the music pad. */
function padVoice(
  length: number,
  frequency: number,
  detuneHz: number,
  sampleRate = SAMPLE_RATE,
): Float32Array {
  const samples = new Float32Array(length);
  const phaseA = 2 * Math.PI * frequency;
  const phaseB = 2 * Math.PI * (frequency + detuneHz);
  // A slow tremolo keeps a sustained pad from sounding like a test tone.
  const tremolo = 2 * Math.PI * 0.14;

  for (let index = 0; index < length; index += 1) {
    const t = index / sampleRate;
    const body =
      Math.sin(phaseA * t) * 0.5 +
      Math.sin(phaseB * t) * 0.35 +
      Math.sin(phaseA * 2 * t) * 0.15;
    samples[index] = body * (0.68 + 0.32 * Math.sin(tremolo * t));
  }
  return samples;
}

// ------------------------------------------------------------ sound events

export type FootstepVariant = 0 | 1 | 2 | 3;

export interface FootstepOptions {
  readonly variant: FootstepVariant;
  readonly gait: 'walk' | 'sprint' | 'crouch';
  /**
   * What was stepped on.
   *
   * Defaults to metal, the demo's commonest surface and the V0.3 sound, so a
   * caller that does not care about surfaces gets exactly what it used to.
   */
  readonly surface?: AcousticMaterial;
}

/**
 * How a footstep differs by material, before the gait is applied.
 *
 * Four numbers carry the whole character: where the scuff is filtered, the pitch
 * and length of the body thump, and how the two are balanced. A metal deck rings,
 * a concrete roof thuds, a grate rattles and a glass panel tinks - and that is
 * all the difference there is.
 */
interface AcousticProfile {
  /** Seed offset, so one variant is not identical noise across materials. */
  readonly seed: number;
  /** Scuff low-pass at walking pace (Hz). */
  readonly scuffCutoff: number;
  readonly scuffHighpass: number;
  /** Body tone at walking pace (Hz). */
  readonly bodyHz: number;
  /** Body decay at walking pace (s). */
  readonly bodyDecay: number;
  /** Scuff level relative to metal. */
  readonly scuffMix: number;
  /** Body level relative to metal. */
  readonly bodyMix: number;
}

const ACOUSTIC_PROFILE: Readonly<Record<AcousticMaterial, AcousticProfile>> = {
  // Tread plate and panels: the V0.3 sound, and the baseline everything scales from.
  metal: { seed: 0, scuffCutoff: 1050, scuffHighpass: 95, bodyHz: 68, bodyDecay: 44, scuffMix: 1, bodyMix: 1 },
  // Bare concrete: duller, lower, and mostly body.
  concrete: { seed: 7, scuffCutoff: 700, scuffHighpass: 70, bodyHz: 58, bodyDecay: 42, scuffMix: 0.6, bodyMix: 1.15 },
  // A grated walkway: bright and noisy, and hollow underneath.
  grate: { seed: 13, scuffCutoff: 2400, scuffHighpass: 320, bodyHz: 96, bodyDecay: 62, scuffMix: 1.3, bodyMix: 0.5 },
  // Glass: a high tick with almost no thump at all.
  glass: { seed: 19, scuffCutoff: 3600, scuffHighpass: 900, bodyHz: 150, bodyDecay: 80, scuffMix: 1.15, bodyMix: 0.4 },
};

/**
 * A footstep: a soft filtered scuff over a low body thump.
 *
 * Deliberately *soft*. An earlier version had a 2 ms attack, a 35 ms decay and a
 * bright 2.6 kHz filter, which made a run sound like a snare drum: a sharp tick
 * every step, and at three and a half steps a second that is exhausting. Now the
 * attack is a slow-in over 10 ms, the decay is three times as long, the filter is
 * darker, and most of the level is in the low body rather than the scuff.
 *
 * V0.4 makes it **surface-aware**: the gait picks the pace, the material picks
 * the character, and the two are independent so every combination is covered
 * without a sample per case.
 */
export function renderFootstep(options: FootstepOptions): Float32Array {
  const gait = options.gait;
  const profile = ACOUSTIC_PROFILE[options.surface ?? 'metal'];

  const length = Math.round(SAMPLE_RATE * (gait === 'crouch' ? 0.2 : 0.26));
  const scuff = whiteNoise(length, 0x1000 + options.variant * 97 + gait.length + profile.seed);
  lowpass(scuff, profile.scuffCutoff * (gait === 'sprint' ? 1.43 : gait === 'crouch' ? 0.62 : 1));
  // A gentle high-pass keeps the low body from booming on a big speaker, without
  // putting any brightness back.
  highpass(scuff, profile.scuffHighpass);

  const envelope = decayEnvelope(
    length,
    0.01,
    gait === 'sprint' ? 0.095 : gait === 'crouch' ? 0.06 : 0.075,
  );
  for (let index = 0; index < length; index += 1) {
    scuff[index] = (scuff[index] as number) * (envelope[index] as number);
  }

  const body = decayingTone(
    length,
    (gait === 'crouch' ? profile.bodyHz * 0.794 : profile.bodyHz) + options.variant * 5,
    gait === 'crouch' ? profile.bodyDecay * 0.909 : profile.bodyDecay,
    0.075,
  );
  const bodyEnvelope = decayEnvelope(length, 0.006, 0.07);
  for (let index = 0; index < length; index += 1) {
    body[index] = (body[index] as number) * (bodyEnvelope[index] as number);
  }

  const samples = new Float32Array(length);
  // Mostly body, a little scuff: a footfall, not a click.
  const scuffGain = (gait === 'sprint' ? 0.42 : gait === 'crouch' ? 0.16 : 0.3) * profile.scuffMix;
  const bodyGain = (gait === 'crouch' ? 0.3 : 0.72) * profile.bodyMix;
  mixInto(samples, scuff, 0, scuffGain);
  mixInto(samples, body, 0, bodyGain);
  // Well under full scale, so footsteps sit beneath the music instead of over it.
  normalise(samples, 0.6);
  return samples;
}

/**
 * A breathy swell of air, for the moves that are mostly a change of direction.
 *
 * A wall run, a wall jump and a roll are all the same sound really: air moving
 * past. Filtered noise with a slow attack and a long tail, which sits under the
 * scrape or the landing that follows rather than competing with it.
 */
export function renderWhoosh(): Float32Array {
  const length = Math.round(SAMPLE_RATE * 0.55);
  const samples = whiteNoise(length, 0x4400);
  lowpass(samples, 2200);
  highpass(samples, 260);

  // In over a third of the sound and out over the rest: a swell, not a burst.
  const envelope = decayEnvelope(length, 0.16, 0.3);
  for (let index = 0; index < length; index += 1) {
    samples[index] = (samples[index] as number) * (envelope[index] as number);
  }
  normalise(samples, 0.4);
  return samples;
}

/** A short scrape, retriggered while sliding. */
export function renderScrape(variant: number): Float32Array {
  const length = Math.round(SAMPLE_RATE * 0.42);
  const noise = whiteNoise(length, 0x2200 + variant * 31);
  highpass(noise, 240);
  lowpass(noise, 3400);

  const envelope = decayEnvelope(length, 0.04, 0.17);
  const samples = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    // A slow wobble over the top, so the scrape has a grain to it.
    const grain = 0.75 + 0.25 * Math.sin((index / SAMPLE_RATE) * 2 * Math.PI * 17);
    samples[index] = (noise[index] as number) * (envelope[index] as number) * grain;
  }
  normalise(samples, 0.5);
  return samples;
}

/** The thud of a landing, at three intensities. */
export function renderLanding(intensity: 0 | 1 | 2): Float32Array {
  const length = Math.round(SAMPLE_RATE * (0.24 + intensity * 0.1));
  const thud = decayingTone(length, 62 + intensity * 14, 34, 0.1 + intensity * 0.05);

  const crack = whiteNoise(length, 0x3300 + intensity);
  lowpass(crack, 800);
  const crackEnvelope = decayEnvelope(length, 0.008, 0.07);
  for (let index = 0; index < length; index += 1) {
    crack[index] = (crack[index] as number) * (crackEnvelope[index] as number);
  }

  const samples = new Float32Array(length);
  mixInto(samples, thud, 0, 0.9);
  mixInto(samples, crack, 0, 0.18 + intensity * 0.16);
  normalise(samples, 0.72);
  return samples;
}

/** A gust of wind, retriggered while falling. */
export function renderGust(variant: number): Float32Array {
  const length = Math.round(SAMPLE_RATE * 0.85);
  const noise = whiteNoise(length, 0x4400 + variant * 53);
  lowpass(noise, 700);
  highpass(noise, 120);

  const samples = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const t = index / length;
    // A lumpy, asymmetric envelope, so a gust swells and dies rather than
    // fading linearly.
    const swell = Math.sin(Math.PI * t) ** 1.6;
    samples[index] = (noise[index] as number) * swell;
  }
  normalise(samples, 0.55);
  return samples;
}

/** The sound of a hand closing on a ledge. */
export function renderGrab(): Float32Array {
  const length = Math.round(SAMPLE_RATE * 0.22);
  const noise = whiteNoise(length, 0x5501);
  lowpass(noise, 1400);

  const envelope = decayEnvelope(length, 0.004, 0.06);
  const samples = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    samples[index] = (noise[index] as number) * (envelope[index] as number);
  }

  const thump = decayingTone(length, 120, 60, 0.05);
  mixInto(samples, thump, 0, 0.35);
  normalise(samples, 0.7);
  return samples;
}

/**
 * A pickup: a short bell that rises in pitch with each one taken.
 *
 * The rising pitch is the sound's whole job. It tells the player how many they
 * have without them having to read the counter, which is the difference between
 * a pickup that feels like progress and one that feels like a checkbox.
 */
export function renderPickup(index: number): Float32Array {
  const steps = Math.min(10, Math.max(0, Math.round(index) - 1));
  const frequency = 740 * Math.pow(2, (steps * 2) / 12);
  const length = Math.round(SAMPLE_RATE * 0.34);

  const softness = decayEnvelope(length, 0.006, 0.12);
  const tone = decayingTone(length, frequency, frequency, 0.09);
  const overtone = decayingTone(length, frequency * 2.01, frequency * 2.01, 0.06);
  for (let index = 0; index < length; index += 1) {
    tone[index] = (tone[index] as number) * (softness[index] as number);
    overtone[index] = (overtone[index] as number) * (softness[index] as number);
  }

  const samples = new Float32Array(length);
  mixInto(samples, tone, 0, 0.9);
  mixInto(samples, overtone, 0, 0.22);
  normalise(samples, 0.5);
  return samples;
}

/**
 * Crossing the finish line: a major chord that opens outward.
 *
 * Four voices on the same root, each entering a little later and fading a little
 * longer, so it blooms rather than strikes - which is what a run's end should
 * sound like, after however many minutes of footfalls.
 */
export function renderComplete(): Float32Array {
  const length = Math.round(SAMPLE_RATE * 1.2);
  const samples = new Float32Array(length);
  const root = 523.25;

  for (const [index, ratio] of [1, 1.26, 1.5, 2].entries()) {
    const frequency = root * ratio;
    const voice = decayingTone(length, frequency, frequency, 0.34 + index * 0.08);
    const envelope = decayEnvelope(length, 0.012 + index * 0.02, 0.5);
    for (let sample = 0; sample < length; sample += 1) {
      voice[sample] = (voice[sample] as number) * (envelope[sample] as number);
    }
    mixInto(samples, voice, 0, 0.5 - index * 0.07);
  }

  normalise(samples, 0.65);
  return samples;
}

/** A foot scraping onto a ledge, for the climb cadence. */
export function renderClimbTick(variant: number): Float32Array {  const length = Math.round(SAMPLE_RATE * 0.22);
  const noise = whiteNoise(length, 0x6600 + variant * 17);
  lowpass(noise, 1200);
  highpass(noise, 300);

  const envelope = decayEnvelope(length, 0.01, 0.07);
  const samples = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    samples[index] = (noise[index] as number) * (envelope[index] as number);
  }
  normalise(samples, 0.5);
  return samples;
}

/** A short, dull impact for taking damage. */
export function renderHurt(): Float32Array {
  const length = Math.round(SAMPLE_RATE * 0.5);
  const samples = decayingTone(length, 210, 70, 0.16);
  const noise = whiteNoise(length, 0x7701);
  lowpass(noise, 900);
  const envelope = decayEnvelope(length, 0.002, 0.09);
  for (let index = 0; index < length; index += 1) {
    noise[index] = (noise[index] as number) * (envelope[index] as number);
  }
  mixInto(samples, noise, 0, 0.6);
  normalise(samples, 0.85);
  return samples;
}

/** A descending two-tone for dying. */
export function renderDeath(): Float32Array {
  const length = Math.round(SAMPLE_RATE * 1.5);
  const samples = new Float32Array(length);
  mixInto(samples, decayingTone(length, 180, 40, 0.5), 0, 0.8);
  mixInto(samples, decayingTone(length, 90, 28, 0.8), 0, 0.6);

  const tail = whiteNoise(length, 0x8801);
  lowpass(tail, 500);
  const envelope = decayEnvelope(length, 0.05, 0.4);
  for (let index = 0; index < length; index += 1) {
    tail[index] = (tail[index] as number) * (envelope[index] as number);
  }
  mixInto(samples, tail, 0, 0.35);
  normalise(samples, 0.9);
  return samples;
}

// ---------------------------------------------------------------- the music

/** Bars in the music loop. */
export const MUSIC_BARS = 8;

/** Seconds per bar at 120 BPM in 4/4. */
export const MUSIC_BAR_SECONDS = 2;

/** Total length of the loop, in seconds. */
export const MUSIC_SECONDS = MUSIC_BARS * MUSIC_BAR_SECONDS;

/** Root notes of a four-bar minor progression, repeated twice. */
const BASS_LINE = [55, 43.65, 65.41, 49, 55, 43.65, 65.41, 49];

/** A pad above the bass, as (semitone offset from the root, voice index). */
const PAD_INTERVALS = [2, 3.5];

/**
 * A slow ambient loop: bass pulse, sustained pad, soft kick, quiet ticks.
 *
 * Deliberately very quiet and unhurried - this plays under everything else. The
 * loop point is bar-aligned and every voice decays well before the end, so the
 * seam is silent rather than a click.
 */
export function renderMusic(): Float32Array {
  const total = Math.round(SAMPLE_RATE * MUSIC_SECONDS);
  const samples = new Float32Array(total);
  const barSamples = Math.round(SAMPLE_RATE * MUSIC_BAR_SECONDS);
  const beatSamples = barSamples / 4;

  for (let bar = 0; bar < MUSIC_BARS; bar += 1) {
    const root = BASS_LINE[bar % BASS_LINE.length] as number;
    const barStart = bar * barSamples;

    // Pad: a long voice across the whole bar.
    for (const [index, interval] of PAD_INTERVALS.entries()) {
      const voice = padVoice(
        Math.round(barSamples * 1.1),
        root * Math.pow(2, interval),
        index === 0 ? 0.6 : -0.9,
      );
      const fade = decayEnvelope(voice.length, 0.25, barSamples * 0.7);
      for (let sample = 0; sample < voice.length; sample += 1) {
        voice[sample] = (voice[sample] as number) * (fade[sample] as number);
      }
      mixInto(samples, voice, barStart, 0.16);
    }

    // Bass pulse on every beat, with the first beat of the bar accented.
    for (let beat = 0; beat < 4; beat += 1) {
      const accent = beat === 0 ? 1 : beat === 2 ? 0.8 : 0.6;
      const pulse = decayingTone(Math.round(SAMPLE_RATE * 0.42), root, root * 0.98, 0.1);
      mixInto(samples, pulse, barStart + beat * beatSamples, 0.3 * accent);
    }

    // Kick on one and three.
    for (const beat of [0, 2]) {
      const kick = decayingTone(Math.round(SAMPLE_RATE * 0.3), 105, 42, 0.06);
      mixInto(samples, kick, barStart + beat * beatSamples, 0.28);
    }

    // A quiet tick on the off-beats, for movement without a full drum kit.
    for (const beat of [1, 3]) {
      const tick = whiteNoise(Math.round(SAMPLE_RATE * 0.06), 0x9900 + bar * 3 + beat);
      highpass(tick, 4000);
      const envelope = decayEnvelope(tick.length, 0.001, 0.012);
      for (let sample = 0; sample < tick.length; sample += 1) {
        tick[sample] = (tick[sample] as number) * (envelope[sample] as number);
      }
      mixInto(samples, tick, barStart + beat * beatSamples + beatSamples / 2, 0.06);
    }
  }

  normalise(samples, 0.5);
  return samples;
}
