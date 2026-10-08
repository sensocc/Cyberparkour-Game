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
}

/**
 * A footstep: a filtered noise scuff plus a low body thump.
 *
 * Each of the four variants changes the filter, the thump pitch and the seed, so
 * a run does not sound like one sample on repeat.
 */
export function renderFootstep(options: FootstepOptions): Float32Array {
  const gait = options.gait;
  const length = Math.round(SAMPLE_RATE * (gait === 'crouch' ? 0.13 : 0.18));
  const scuff = whiteNoise(length, 0x1000 + options.variant * 97 + gait.length);
  lowpass(scuff, gait === 'sprint' ? 2600 : gait === 'crouch' ? 900 : 1700);

  const envelope = decayEnvelope(length, 0.002, gait === 'sprint' ? 0.05 : 0.035);
  for (let index = 0; index < length; index += 1) {
    scuff[index] = (scuff[index] as number) * (envelope[index] as number);
  }

  const body = decayingTone(
    length,
    gait === 'crouch' ? 58 : 76 + options.variant * 6,
    gait === 'crouch' ? 42 : 48,
    0.04,
  );

  const samples = new Float32Array(length);
  const gain = gait === 'sprint' ? 0.85 : gait === 'crouch' ? 0.34 : 0.6;
  mixInto(samples, scuff, 0, gain);
  mixInto(samples, body, 0, gait === 'crouch' ? 0.25 : 0.5);
  normalise(samples, 0.82);
  return samples;
}

/** A short scrape, retriggered while sliding. */
export function renderScrape(variant: number): Float32Array {
  const length = Math.round(SAMPLE_RATE * 0.42);
  const noise = whiteNoise(length, 0x2200 + variant * 31);
  highpass(noise, 380);
  lowpass(noise, 5200);

  const envelope = decayEnvelope(length, 0.02, 0.16);
  const samples = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    // A slow wobble over the top, so the scrape has a grain to it.
    const grain = 0.75 + 0.25 * Math.sin((index / SAMPLE_RATE) * 2 * Math.PI * 17);
    samples[index] = (noise[index] as number) * (envelope[index] as number) * grain;
  }
  normalise(samples, 0.62);
  return samples;
}

/** The thud of a landing, at three intensities. */
export function renderLanding(intensity: 0 | 1 | 2): Float32Array {
  const length = Math.round(SAMPLE_RATE * (0.24 + intensity * 0.1));
  const thud = decayingTone(length, 62 + intensity * 14, 34, 0.1 + intensity * 0.05);

  const crack = whiteNoise(length, 0x3300 + intensity);
  lowpass(crack, 1100);
  const crackEnvelope = decayEnvelope(length, 0.001, 0.05);
  for (let index = 0; index < length; index += 1) {
    crack[index] = (crack[index] as number) * (crackEnvelope[index] as number);
  }

  const samples = new Float32Array(length);
  mixInto(samples, thud, 0, 0.9);
  mixInto(samples, crack, 0, 0.25 + intensity * 0.2);
  normalise(samples, 0.9);
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

/** A foot scraping onto a ledge, for the climb cadence. */
export function renderClimbTick(variant: number): Float32Array {
  const length = Math.round(SAMPLE_RATE * 0.22);
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

  normalise(samples, 0.62);
  return samples;
}
