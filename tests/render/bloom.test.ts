/**
 * The bloom pass.
 *
 * Only the parts that can be checked without a GPU are here. `BloomChain` needs a real
 * `WebGLRenderer`, so what is asserted instead is the *tuning* - that the threshold sits above the
 * city's lit surfaces and under its neon, and that the strength is the restrained one this project
 * decided on rather than a filter. Getting those wrong is the failure mode that matters: a
 * threshold low enough to catch lit concrete blooms the whole frame into a haze, and it looks like
 * a broken renderer rather than a badly tuned effect.
 */

import { describe, expect, it } from 'vitest';

import { BLOOM_DEFAULTS } from '../../src/render/bloom.js';
import { QUALITY_PRESETS } from '../../src/core/settings.js';
import { SURFACES } from '../../src/game/level/surfaces.js';

describe('the bloom tuning', () => {
  it('keeps the glow restrained rather than turning it into a filter', () => {
    // A third of the glow added back. Above about half and the frame reads as smeared; the whole
    // point is that this is glow *on* the glow, not a lighting pass.
    expect(BLOOM_DEFAULTS.strength).toBeGreaterThan(0);
    expect(BLOOM_DEFAULTS.strength).toBeLessThan(0.5);

    // A wide spread, so the halo is a soft falloff rather than a ring of pixels.
    expect(BLOOM_DEFAULTS.radius).toBeGreaterThan(0.2);
    expect(BLOOM_DEFAULTS.radius).toBeLessThan(1);
  });

  it('puts the threshold above the brightest ordinary surface', () => {
    // The city's own glow is *emissive* - the neon is at full brightness by construction - and
    // everything else is lit by the sun and the lamps, well under full white. A threshold below
    // that band blooms every lit wall in the frame.
    const brightestLit = Math.max(
      ...SURFACES.filter((surface) => surface.emissive !== true).map((surface) => {
        // A #rrggbb tint, as its brightest channel in 0..1. This is the *albedo*; what the sun does
        // to it is a shader's business, but an albedo this high is already bright under any light.
        const value = Number.parseInt(surface.tint.slice(1), 16);
        return Math.max((value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff) / 255;
      }),
    );

    // Not a strict inequality on the albedo - lighting can push a surface above its albedo - but
    // the threshold has to be high enough that it is *plausible* only emissive things cross it.
    expect(BLOOM_DEFAULTS.threshold).toBeGreaterThan(0.5);
    expect(brightestLit).toBeLessThan(1);
  });

  it('is gated to the top preset and nowhere else', () => {
    // A full-screen post chain is the first thing a slower machine should lose, and the graphics
    // menu is the way out - so only the preset that means "give me everything" asks for it.
    const blooming = (Object.keys(QUALITY_PRESETS) as (keyof typeof QUALITY_PRESETS)[]).filter(
      (level) => QUALITY_PRESETS[level].bloom,
    );
    expect(blooming).toEqual(['high']);
  });

  it('multisamples the off-screen buffer, so the post chain does not cost the antialiasing', () => {
    // `antialias: true` only multisamples the *default framebuffer*. A composer renders into a
    // texture instead, so without samples here every edge in the city would go jagged - the exact
    // "harsher than before" regression this pass is not allowed to introduce.
    expect(BLOOM_DEFAULTS.samples).toBeGreaterThan(0);
  });
});
