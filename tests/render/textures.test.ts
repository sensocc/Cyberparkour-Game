/**
 * The committed PNGs must be exactly what the generators produce.
 *
 * They are binary files, so nothing in a code review would notice them going
 * stale. This compares the *decoded pixels* of the committed file against a
 * freshly generated image, which is independent of the DEFLATE implementation
 * and therefore stable across Node versions.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { decodePng } from '../helpers/pngDecode.js';
import {
  TEXTURES,
  generateCityBackdrop,
  generateSkyGradient,
} from '../../tools/textures/generate.ts';
import {
  blendPixel,
  createImage,
  createRandom,
  encodePng,
  fillRect,
  getPixel,
  hexColor,
  mixColors,
  randomInt,
  setPixel,
  withAlpha,
  type RgbaImage,
} from '../../tools/textures/png.ts';

const TEXTURE_DIR = fileURLToPath(new URL('../../src/assets/textures/', import.meta.url));

function readCommitted(name: string): RgbaImage {
  return decodePng(readFileSync(new URL(name, `file://${TEXTURE_DIR}`)));
}

function expectSamePixels(actual: RgbaImage, expected: RgbaImage, label: string): void {
  expect(actual.width, `${label} width`).toBe(expected.width);
  expect(actual.height, `${label} height`).toBe(expected.height);

  const differences: string[] = [];
  for (let y = 0; y < expected.height && differences.length < 5; y += 1) {
    for (let x = 0; x < expected.width; x += 1) {
      const a = getPixel(actual, x, y);
      const b = getPixel(expected, x, y);
      if (a.r !== b.r || a.g !== b.g || a.b !== b.b || a.a !== b.a) {
        differences.push(`(${x},${y}) committed=${JSON.stringify(a)} generated=${JSON.stringify(b)}`);
        break;
      }
    }
  }

  expect(differences, `${label} has stale pixels`).toEqual([]);
}

describe('committed textures', () => {
  it('ships exactly the textures the generators declare', () => {
    expect(TEXTURES.map((entry) => entry.name).sort()).toEqual([
      'city-backdrop.png',
      'sky-gradient.png',
    ]);
  });

  it('the committed city backdrop matches the generator', () => {
    expectSamePixels(readCommitted('city-backdrop.png'), generateCityBackdrop(), 'city-backdrop.png');
  });

  it('the committed sky gradient matches the generator', () => {
    expectSamePixels(readCommitted('sky-gradient.png'), generateSkyGradient(), 'sky-gradient.png');
  });

  it('the generators are deterministic', () => {
    // `toEqual` on a 4 MB typed array is pathologically slow; memcmp is not.
    const first = Buffer.from(generateCityBackdrop().pixels);
    const second = Buffer.from(generateCityBackdrop().pixels);
    expect(first.equals(second)).toBe(true);
  });

  it('a different seed produces a different skyline', () => {
    const other = generateCityBackdrop({ seed: 12345 });
    expect(other.pixels).not.toEqual(generateCityBackdrop().pixels);
    expect(other.width).toBe(generateCityBackdrop().width);
  });
});

describe('the sky gradient', () => {
  const luminance = (color: { r: number; g: number; b: number }): number =>
    color.r * 0.299 + color.g * 0.587 + color.b * 0.114;

  it('is authored for a sphere: bright at the horizon, dark at both poles', () => {
    const image = generateSkyGradient();
    const zenith = getPixel(image, 0, 0);
    const horizon = getPixel(image, 0, Math.floor(image.height / 2));
    const nadir = getPixel(image, 0, image.height - 1);

    // three.js maps row 0 to the top of the sphere and the vertical centre to
    // the horizon, so the bright band must be in the middle.
    expect(luminance(horizon)).toBeGreaterThan(luminance(zenith));
    expect(luminance(horizon)).toBeGreaterThan(luminance(nadir));
  });

  it('is fully opaque', () => {
    const image = generateSkyGradient();
    for (let y = 0; y < image.height; y += 16) {
      expect(getPixel(image, 0, y).a).toBe(255);
    }
  });

  it('carries a magenta cast on the horizon, for the cyberpunk glow', () => {
    const image = generateSkyGradient();
    const horizon = getPixel(image, 0, Math.floor(image.height / 2));
    // More red than green is what makes it read as magenta rather than blue.
    expect(horizon.r).toBeGreaterThan(horizon.g);
  });

  it('is continuous: no single row jumps by more than a few levels', () => {
    const image = generateSkyGradient();
    for (let y = 1; y < image.height; y += 1) {
      const previous = getPixel(image, 0, y - 1);
      const current = getPixel(image, 0, y);
      expect(Math.abs(current.r - previous.r)).toBeLessThan(8);
      expect(Math.abs(current.g - previous.g)).toBeLessThan(8);
      expect(Math.abs(current.b - previous.b)).toBeLessThan(8);
    }
  });
});

describe('the city backdrop', () => {
  it('is transparent above the skyline and opaque below it', () => {
    const image = generateCityBackdrop();
    for (let x = 0; x < image.width; x += 64) {
      expect(getPixel(image, x, 0).a, `top row at x=${x}`).toBe(0);
      expect(getPixel(image, x, image.height - 1).a, `bottom row at x=${x}`).toBe(255);
    }
  });

  it('leaves real gaps in the skyline for the sky to show through', () => {
    const image = generateCityBackdrop();

    let mixedRows = 0;
    for (let row = 0; row < image.height; row += 1) {
      let clear = 0;
      for (let x = 0; x < image.width; x += 1) {
        if (getPixel(image, x, row).a === 0) clear += 1;
      }
      if (clear > 0 && clear < image.width) mixedRows += 1;
    }

    // A backdrop with no gaps is a wall; one with no buildings is empty sky.
    expect(mixedRows).toBeGreaterThan(50);
  });

  it('packs buildings edge to edge, so the texture wraps without a gap', () => {
    // A gap would show as a vertical strip of sky at the bottom of the cylinder.
    const image = generateCityBackdrop();
    for (let x = 0; x < image.width; x += 1) {
      expect(getPixel(image, x, image.height - 1).a, `column ${x}`).toBe(255);
    }
  });

  it('lights windows across a range of colours', () => {
    const image = generateCityBackdrop();
    const seen = new Set<string>();
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const color = getPixel(image, x, y);
        if (color.a === 255 && color.r + color.g + color.b > 400) {
          seen.add(`${color.r},${color.g},${color.b}`);
        }
      }
    }
    expect(seen.size).toBeGreaterThan(50);
  });

  it('keeps the tallest building below the top of the frame', () => {
    const image = generateCityBackdrop();
    for (let x = 0; x < image.width; x += 1) {
      expect(getPixel(image, x, 0).a, `column ${x} reaches the top`).toBe(0);
    }
  });
});

describe('the PNG encoder', () => {
  const solid = (width: number, height: number, color: string): RgbaImage =>
    createImage(width, height, hexColor(color));

  it('round-trips through its own decoder', () => {
    const image = solid(4, 3, '#123456');
    const decoded = decodePng(encodePng(image));

    expect(decoded.width).toBe(4);
    expect(decoded.height).toBe(3);
    expect(decoded.pixels).toEqual(image.pixels);
  });

  it('writes only unfiltered rows, which the decoder relies on', () => {
    const decoded = decodePng(encodePng(solid(8, 8, '#abcdef')));
    expect(new Set(decoded.filterTypes)).toEqual(new Set([0]));
  });

  it('preserves every colour precisely', () => {
    const image = createImage(4, 1);
    setPixel(image, 0, 0, { r: 0, g: 0, b: 0, a: 0 });
    setPixel(image, 1, 0, { r: 255, g: 255, b: 255, a: 255 });
    setPixel(image, 2, 0, { r: 1, g: 128, b: 254, a: 77 });
    setPixel(image, 3, 0, hexColor('#58deff'));

    expect(decodePng(encodePng(image)).pixels).toEqual(image.pixels);
  });

  it('rejects a pixel buffer that does not match the dimensions', () => {
    expect(() => encodePng({ width: 4, height: 4, pixels: new Uint8Array(10) })).toThrow(RangeError);
  });

  it('rejects nonsensical dimensions', () => {
    expect(() => createImage(0, 4)).toThrow(RangeError);
    expect(() => createImage(4, -1)).toThrow(RangeError);
    expect(() => createImage(1.5, 4)).toThrow(RangeError);
  });

  it('produces a file with the standard PNG framing', () => {
    const png = encodePng(solid(2, 2, '#000000'));
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR');
    expect(png.subarray(png.length - 8, png.length - 4).toString('ascii')).toBe('IEND');
  });
});

describe('image helpers', () => {
  it('hexColor parses a colour and rejects junk', () => {
    expect(hexColor('#ff8000')).toEqual({ r: 255, g: 128, b: 0, a: 255 });
    expect(hexColor('#ff8000', 10).a).toBe(10);
    expect(() => hexColor('ff8000')).toThrow(RangeError);
    expect(() => hexColor('#fff')).toThrow(RangeError);
  });

  it('withAlpha scales and clamps', () => {
    expect(withAlpha(hexColor('#000000'), 0.5).a).toBe(128);
    expect(withAlpha(hexColor('#000000'), 2).a).toBe(255);
    expect(withAlpha(hexColor('#000000'), -1).a).toBe(0);
  });

  it('mixColors interpolates and clamps', () => {
    expect(mixColors(hexColor('#000000'), hexColor('#ffffff'), 0.5)).toMatchObject({
      r: 128,
      g: 128,
      b: 128,
    });
    expect(mixColors(hexColor('#000000'), hexColor('#ffffff'), 5).r).toBe(255);
  });

  it('fillRect clips to the image bounds', () => {
    const image = createImage(4, 4, hexColor('#000000'));
    fillRect(image, -2, -2, 4, 4, hexColor('#ffffff'));
    expect(getPixel(image, 0, 0).r).toBe(255);
    expect(getPixel(image, 2, 2).r).toBe(0);
  });

  it('setPixel ignores out-of-bounds coordinates', () => {
    const image = createImage(2, 2, hexColor('#000000'));
    setPixel(image, -1, 0, hexColor('#ffffff'));
    setPixel(image, 5, 0, hexColor('#ffffff'));
    expect(getPixel(image, 0, 0).r).toBe(0);
  });

  it('blendPixel composites source-over', () => {
    const image = createImage(2, 1, hexColor('#000000'));
    blendPixel(image, 0, 0, { r: 255, g: 255, b: 255, a: 128 });
    const blended = getPixel(image, 0, 0);
    expect(blended.r).toBeGreaterThan(100);
    expect(blended.r).toBeLessThan(160);
    expect(blended.a).toBe(255);
  });

  it('blendPixel is a plain write for an opaque source', () => {
    const image = createImage(2, 1, hexColor('#000000'));
    blendPixel(image, 1, 0, hexColor('#ff0000'));
    expect(getPixel(image, 1, 0)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
  });

  it('blending onto nothing keeps the source colour', () => {
    const image = createImage(1, 1);
    blendPixel(image, 0, 0, { r: 10, g: 20, b: 30, a: 128 });
    expect(getPixel(image, 0, 0)).toMatchObject({ r: 10, g: 20, b: 30 });
  });
});

describe('the deterministic random source', () => {
  it('repeats exactly for the same seed', () => {
    const first = createRandom(42);
    const second = createRandom(42);
    for (let index = 0; index < 50; index += 1) {
      expect(first()).toBe(second());
    }
  });

  it('produces values in [0, 1)', () => {
    const random = createRandom(7);
    for (let index = 0; index < 1000; index += 1) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('randomInt is inclusive on both ends', () => {
    const random = createRandom(1);
    const seen = new Set<number>();
    for (let index = 0; index < 500; index += 1) {
      const value = randomInt(random, 1, 3);
      seen.add(value);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(3);
    }
    expect(seen).toEqual(new Set([1, 2, 3]));
  });
});
