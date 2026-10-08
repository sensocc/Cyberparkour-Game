/**
 * The synthesiser.
 *
 * There are no audio files, so this is where the soundbank is checked: length,
 * level, silence, DC offset and determinism. Structure is all a test can judge -
 * whether it *sounds* good is a human question - so the tests are written to
 * catch the failures that would be audible as a fault rather than as taste.
 */

import { describe, expect, it } from 'vitest';

import {
  MUSIC_BARS,
  MUSIC_SECONDS,
  SAMPLE_RATE,
  decayEnvelope,
  decayingTone,
  highpass,
  lowpass,
  meanOf,
  mixInto,
  normalise,
  peakOf,
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
  rmsOf,
  scaleInPlace,
} from '../../src/audio/synth.js';
import type { FootstepVariant } from '../../src/audio/synth.js';

const VARIANTS: FootstepVariant[] = [0, 1, 2, 3];

/** Peak of a raw slice, for envelope-shape checks. */
function peakOfPlain(samples: Float32Array): number {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  return peak;
}

describe('buffer helpers', () => {
  it('mixInto sums rather than replaces, and clips out of range', () => {
    const target = new Float32Array(4);
    mixInto(target, Float32Array.from([1, 1, 1, 1]), 1, 0.5);
    expect([...target]).toEqual([0, 0.5, 0.5, 0.5]);

    const short = new Float32Array(2);
    mixInto(short, Float32Array.from([1, 1, 1, 1]), 0);
    expect([...short]).toEqual([1, 1]);
  });

  it('normalise scales the loudest sample to the requested peak', () => {
    const samples = Float32Array.from([0, 0.2, -0.5, 0.1]);
    normalise(samples, 1);
    expect(peakOf(samples)).toBeCloseTo(1, 6);
    expect(samples[2]).toBeCloseTo(-1, 6);
  });

  it('normalise leaves silence alone', () => {
    const samples = new Float32Array(8);
    normalise(samples);
    expect(peakOf(samples)).toBe(0);
  });

  it('scaleInPlace and the measurements agree', () => {
    const samples = Float32Array.from([1, -1, 1, -1]);
    expect(rmsOf(samples)).toBeCloseTo(1, 6);
    expect(meanOf(samples)).toBe(0);
    scaleInPlace(samples, 0.5);
    expect(peakOf(samples)).toBeCloseTo(0.5, 6);
  });
});

describe('filters and envelopes', () => {
  it('lowpass removes the fast changes and highpass removes the slow ones', () => {
    const noise = Float32Array.from({ length: 2048 }, (_unused, index) => (index % 2 === 0 ? 1 : -1));
    const smoothed = Float32Array.from(noise);
    lowpass(smoothed, 200, SAMPLE_RATE);

    // A 24 kHz square wave through a 200 Hz filter is nearly flat.
    expect(peakOf(smoothed)).toBeLessThan(peakOf(noise));

    const offset = new Float32Array(2048).fill(0.5);
    highpass(offset, 500, SAMPLE_RATE);
    expect(Math.abs(meanOf(offset))).toBeLessThan(0.2);
  });

  it('an envelope rises then decays, and ends quieter than it started', () => {
    const envelope = decayEnvelope(2400, 0.002, 0.02);
    expect(envelope[0]).toBe(0);
    expect(envelope[100]).toBeGreaterThan(envelope[0] as number);
    expect(envelope[2399]).toBeLessThan(envelope[100] as number);
    // 2400 samples at a 20 ms decay is e^-2.5, so about 8% is left.
    expect(envelope[2399]).toBeLessThan(0.15);
  });

  it('a decaying tone sweeps its frequency and dies away', () => {
    const tone = decayingTone(4800, 400, 100, 0.05);
    expect(peakOf(tone)).toBeGreaterThan(0.9);
    expect(Math.abs(tone[4700] as number)).toBeLessThan(0.2);
    // Fewer sign changes per sample at the end, because the pitch dropped.
    const crossings = (from: number, to: number): number => {
      let count = 0;
      for (let index = from + 1; index < to; index += 1) {
        if ((tone[index - 1] as number) * (tone[index] as number) < 0) count += 1;
      }
      return count;
    };
    expect(crossings(0, 480)).toBeGreaterThan(crossings(4320, 4800));
  });
});

describe('every sound is a usable buffer', () => {
  const sounds: [string, () => Float32Array][] = [
    ...VARIANTS.flatMap((variant): [string, () => Float32Array][] => [
      [`footstep walk ${variant}`, () => renderFootstep({ variant, gait: 'walk' })],
      [`footstep sprint ${variant}`, () => renderFootstep({ variant, gait: 'sprint' })],
      [`footstep crouch ${variant}`, () => renderFootstep({ variant, gait: 'crouch' })],
    ]),
    ...([0, 1, 2] as const).map(
      (intensity): [string, () => Float32Array] => [
        `landing ${intensity}`,
        () => renderLanding(intensity),
      ],
    ),
    ...([0, 1, 2] as const).map(
      (variant): [string, () => Float32Array] => [`scrape ${variant}`, () => renderScrape(variant)],
    ),
    ...([0, 1] as const).map(
      (variant): [string, () => Float32Array] => [`gust ${variant}`, () => renderGust(variant)],
    ),
    ...([0, 1] as const).map(
      (variant): [string, () => Float32Array] => [
        `climb tick ${variant}`,
        () => renderClimbTick(variant),
      ],
    ),
    ['grab', renderGrab],
    ['hurt', renderHurt],
    ['death', renderDeath],
    ['music', renderMusic],
  ];

  it.each(sounds)('%s is finite, in range and audible', (_name, render) => {
    const samples = render();

    expect(samples.length).toBeGreaterThan(0);
    expect(samples.every((value) => Number.isFinite(value))).toBe(true);

    // Headroom for the mixer: nothing peaks above 1, and nothing is silent.
    const peak = peakOf(samples);
    expect(peak).toBeLessThanOrEqual(1);
    expect(peak).toBeGreaterThan(0.05);

    // A DC offset would thump the speakers.
    expect(Math.abs(meanOf(samples))).toBeLessThan(0.12);

    // And it actually has energy in it.
    expect(rmsOf(samples)).toBeGreaterThan(0.005);
  });

  it.each(sounds)('%s is deterministic', (_name, render) => {
    expect(Buffer.from(render()).equals(Buffer.from(render()))).toBe(true);
  });
});

describe('the individual sounds', () => {
  it('a sprint footstep is longer and carries more energy than a crouched one', () => {
    const sprint = renderFootstep({ variant: 0, gait: 'sprint' });
    const crouch = renderFootstep({ variant: 0, gait: 'crouch' });

    // Every sound is normalised to the same peak so the mixer can reason about
    // levels, so a gait's character is its *length*, not its amplitude.
    expect(sprint.length).toBeGreaterThan(crouch.length);
    expect(sprint.length / SAMPLE_RATE).toBeGreaterThan(0.1);
  });

  it('footsteps differ between variants, so a run is not one sample on repeat', () => {
    // Compared by energy rather than by bytes: two variants are the same length
    // and normalised to the same peak, so their *level* is what distinguishes
    // them audibly.
    const levels = VARIANTS.map((variant) => rmsOf(renderFootstep({ variant, gait: 'walk' })));
    expect(new Set(levels.map((level) => level.toFixed(4))).size).toBe(VARIANTS.length);
  });

  it('harder landings are longer and louder', () => {
    const soft = renderLanding(0);
    const hard = renderLanding(2);
    expect(hard.length).toBeGreaterThan(soft.length);
    expect(peakOf(hard)).toBeGreaterThanOrEqual(peakOf(soft) * 0.95);
  });

  it('steps in softly rather than clicking', () => {
    // The complaint that started this: a run sounded like a snare drum, because
    // each step was a 2 ms attack over a 35 ms decay. The envelope is now a
    // slow-in, so the first few milliseconds carry almost no energy - which is
    // what "soft" means numerically.
    for (const gait of ['walk', 'sprint', 'crouch'] as const) {
      const step = renderFootstep({ variant: 0, gait });

      // Where the sound is loudest. A click peaks in the first millisecond; a
      // sound with a real attack peaks where its envelope does, which is several
      // milliseconds in.
      let loudestAt = 0;
      for (let index = 1; index < step.length; index += 1) {
        if (Math.abs(step[index] as number) > Math.abs(step[loudestAt] as number)) loudestAt = index;
      }
      expect(loudestAt / SAMPLE_RATE, gait).toBeGreaterThan(0.004);

      // And it is still rising in those first few milliseconds.
      const head = step.slice(0, Math.round(SAMPLE_RATE * 0.002));
      const rise = step.slice(Math.round(SAMPLE_RATE * 0.002), Math.round(SAMPLE_RATE * 0.006));
      expect(peakOfPlain(head), gait).toBeLessThan(peakOfPlain(rise));
    }
  });

  it('sits well below full scale, so steps do not dominate the mix', () => {
    for (const gait of ['walk', 'sprint', 'crouch'] as const) {
      const step = renderFootstep({ variant: 0, gait });
      expect(peakOf(step), gait).toBeLessThanOrEqual(0.65);
      // ...and is still a real signal, not a whisper.
      expect(peakOf(step), gait).toBeGreaterThan(0.3);
    }
  });

  it('decays over a long tail instead of stopping dead', () => {
    const step = renderFootstep({ variant: 0, gait: 'walk' });
    const tail = step.slice(Math.round(SAMPLE_RATE * 0.12), Math.round(SAMPLE_RATE * 0.2));
    const peak = step.slice(0, Math.round(SAMPLE_RATE * 0.02) + 1);
    // There is still something in the tail, and it is quiet.
    expect(rmsOf(tail)).toBeGreaterThan(0);
    expect(rmsOf(tail)).toBeLessThan(rmsOf(peak));
  });

  it('sounds different on each surface underfoot', () => {
    // V0.4: the same step is a different sound on metal, concrete, a grate and
    // glass - which is the whole feature, so they must not come out identical.
    const surfaces = ['metal', 'concrete', 'grate', 'glass'] as const;
    const steps = surfaces.map((surface) => renderFootstep({ variant: 0, gait: 'walk', surface }));

    for (const [index, step] of steps.entries()) {
      const surface = surfaces[index] as string;
      expect(step.length, surface).toBe(steps[0]?.length);
      expect(peakOf(step), surface).toBeLessThanOrEqual(0.65);
      expect(rmsOf(step), surface).toBeGreaterThan(0);
    }

    // A grated walkway is brighter (more scuff, higher up) than bare concrete:
    // the simplest numeric proxy is how often the waveform crosses zero.
    const crossings = (samples: Float32Array): number => {
      let count = 0;
      for (let index = 1; index < samples.length; index += 1) {
        if (((samples[index] as number) >= 0) !== ((samples[index - 1] as number) >= 0)) count += 1;
      }
      return count;
    };
    expect(crossings(steps[2] as Float32Array)).toBeGreaterThan(crossings(steps[1] as Float32Array));
  });

  it('keeps the default footstep exactly as it was', () => {
    // A caller that does not know about surfaces gets metal, which is the V0.3
    // sound, byte for byte - so nothing else has to change.
    for (const gait of ['walk', 'sprint', 'crouch'] as const) {
      const explicit = renderFootstep({ variant: 2, gait, surface: 'metal' });
      const fallback = renderFootstep({ variant: 2, gait });
      expect(Array.from(explicit), gait).toEqual(Array.from(fallback));
    }
  });

  it('renders a whoosh for the airborne moves', () => {
    const whoosh = renderWhoosh();
    const at = (fraction: number): number => Math.abs(whoosh[Math.floor(whoosh.length * fraction)] as number);
    expect(whoosh.length / SAMPLE_RATE).toBeGreaterThan(0.2);
    // A swell: quiet at the start, loudest in the middle.
    expect(at(0.4)).toBeGreaterThan(at(0.02));
    expect(peakOf(whoosh)).toBeLessThanOrEqual(0.45);
  });

  it('gusts swell and die away', () => {
    const gust = renderGust(0);
    const at = (fraction: number): number => Math.abs(gust[Math.floor(gust.length * fraction)] as number);
    expect(at(0.5)).toBeGreaterThan(at(0.02));
    expect(at(0.98)).toBeLessThan(at(0.5));
  });
});

describe('the music loop', () => {
  it('is exactly the declared length', () => {
    const music = renderMusic();
    expect(music.length).toBe(Math.round(SAMPLE_RATE * MUSIC_SECONDS));
    expect(MUSIC_BARS).toBeGreaterThan(0);
  });

  it('loops without a click: the waveform returns to rest at the seam', () => {
    const music = renderMusic();
    const peak = peakOf(music);

    // A click at a loop point is a step in the waveform, so what matters is the
    // samples immediately either side of the seam - not the overall level.
    expect(Math.abs(music[0] as number)).toBeLessThan(peak * 0.1);
    expect(Math.abs(music[music.length - 1] as number)).toBeLessThan(peak * 0.1);
    expect(peakOf(music.subarray(0, 240))).toBeLessThan(peak * 0.8);
  });

  it('has energy throughout rather than one long note', () => {
    const music = renderMusic();
    const window = Math.floor(music.length / 8);
    for (let index = 0; index < 8; index += 1) {
      const slice = music.subarray(index * window, (index + 1) * window);
      expect(rmsOf(slice), `bar ${index}`).toBeGreaterThan(0.02);
    }
  });

  it('is quiet enough to sit under everything else', () => {
    expect(peakOf(renderMusic())).toBeLessThanOrEqual(0.65);
  });
});
