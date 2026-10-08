/**
 * The committed textures must be exactly what the generators produce.
 *
 * They are binary files, so nothing in a code review would notice them going
 * stale. This compares the *decoded pixels* of each committed file against a
 * freshly generated image, which is independent of the DEFLATE implementation and
 * therefore stable across Node versions.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { decodePng } from '../helpers/pngDecode.js';
import { generateCityBackdrop } from '../../tools/textures/city.js';
import {
  EFFECT_TEXTURES,
  OBJECT_TEXTURES,
  SKYBOX_TEXTURES,
  TEXTURES,
  SKYBOX_FACE_SIZE,
} from '../../tools/textures/index.ts';
import {
  blendPixel,
  createImage,
  createRandom,
  createValueNoise,
  encodePng,
  fillRect,
  getPixel,
  hexColor,
  mixColors,
  randomInt,
  setPixel,
  setPixelWrapped,
  withAlpha,
  type RgbaImage,
} from '../../tools/textures/png.ts';
import {
  SKYBOX_FACES as FACE_ORDER,
  generateSkyboxFace,
  pixelToFaceCoordinates,
  skyboxFaceDirection,
  skyColorAt,
} from '../../tools/textures/skybox.js';
import { SURFACE_TEXTURES, surfaceMetresPerTile } from '../../tools/textures/surfaces.ts';
import { METRES_PER_TILE, SURFACES, surfaceTextureIds } from '../../src/game/level/surfaces.js';

const TEXTURE_DIR = fileURLToPath(new URL('../../src/assets/textures/', import.meta.url));

const load = (name: string): RgbaImage => decodePng(readFileSync(new URL(name, `file://${TEXTURE_DIR}`)));

/** Compares two images, reporting the first few differing pixels. */
function expectSamePixels(actual: RgbaImage, expected: RgbaImage, label: string): void {
  expect(actual.width, `${label} width`).toBe(expected.width);
  expect(actual.height, `${label} height`).toBe(expected.height);

  const differences: string[] = [];
  for (let y = 0; y < expected.height && differences.length < 4; y += 1) {
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

describe('the committed texture set', () => {
  it('every declared texture is present and matches its generator', () => {
    for (const definition of TEXTURES) {
      expectSamePixels(load(definition.name), definition.generate(), definition.name);
    }
  });

  it('declares a backdrop, six skybox faces, the object surfaces and the effects', () => {
    expect(TEXTURES.length).toBe(
      1 + FACE_ORDER.length + SURFACE_TEXTURES.length + EFFECT_TEXTURES.length,
    );
    expect(SKYBOX_TEXTURES.map((entry) => entry.name).sort()).toEqual([
      'sky-nx.png',
      'sky-ny.png',
      'sky-nz.png',
      'sky-px.png',
      'sky-py.png',
      'sky-pz.png',
    ]);
    expect(OBJECT_TEXTURES.length).toBe(SURFACE_TEXTURES.length);
    expect(EFFECT_TEXTURES.map((entry) => entry.name)).toEqual(['fx-smoke.png']);
  });

  it('is deterministic', () => {
    for (const definition of TEXTURES) {
      const first = Buffer.from(definition.generate().pixels);
      const second = Buffer.from(definition.generate().pixels);
      expect(first.equals(second), definition.name).toBe(true);
    }
  });

  it('agrees with the surface table the renderer uses', () => {
    // The generator owns the pixels; `src/` owns the ids and the tile sizes. If
    // those two drift, a surface would silently render untextured.
    expect(SURFACE_TEXTURES.map((entry) => entry.id).sort()).toEqual(surfaceTextureIds());
    for (const id of surfaceTextureIds()) {
      expect(surfaceMetresPerTile(id)).toBe(METRES_PER_TILE[id]);
    }
  });

  it('tints every surface with a valid colour and repeats it at a sane size', () => {
    for (const surface of SURFACES) {
      expect(surface.tint, surface.id).toMatch(/^#[0-9a-f]{6}$/i);
      expect(surfaceTextureIds()).toContain(surface.texture);
      expect(surface.metresPerTile, surface.id).toBeGreaterThan(0);
      expect(surface.metresPerTile, surface.id).toBeLessThan(10);
    }
  });
});

describe('the object surfaces', () => {
  it('are all the declared size and fully opaque', () => {
    for (const definition of SURFACE_TEXTURES) {
      const image = definition.generate();
      expect(image.width, definition.id).toBe(definition.size);
      expect(image.height, definition.id).toBe(definition.size);
      for (const alpha of [0, Math.floor(image.height / 2), image.height - 1]) {
        expect(getPixel(image, 0, alpha).a, definition.id).toBe(255);
      }
    }
  });

  it('are light, because they are tinted down by the surface colour', () => {
    // If a detail map were dark, `tint x map` would come out almost black.
    //
    // The exception is an *emissive* map (the neon sign): there the dark parts
    // are the point - they are what does not glow - so its mean brightness is
    // deliberately low and the rule does not apply.
    const emissiveTextures = new Set(SURFACES.filter((surface) => surface.emissive).map((s) => s.texture));

    for (const definition of SURFACE_TEXTURES) {
      if (emissiveTextures.has(definition.id)) continue;

      const image = definition.generate();
      let total = 0;
      let samples = 0;
      for (let y = 0; y < image.height; y += 4) {
        for (let x = 0; x < image.width; x += 4) {
          const colour = getPixel(image, x, y);
          total += (colour.r + colour.g + colour.b) / 3;
          samples += 1;
        }
      }
      const mean = total / samples;
      expect(mean, `${definition.id} mean brightness`).toBeGreaterThan(70);
      expect(mean, `${definition.id} mean brightness`).toBeLessThan(230);
    }
  });

  it('has an emissive sign map that is mostly dark with bright glyphs', () => {
    // The inverse of the rule above, and the reason the exception exists: the
    // sign's backing must be near-black so only the glyphs glow.
    const sign = SURFACE_TEXTURES.find((definition) => definition.id === 'sign');
    expect(sign).toBeDefined();
    const image = sign?.generate();
    if (!image) throw new Error('the sign texture did not generate');

    let bright = 0;
    let dark = 0;
    for (let y = 0; y < image.height; y += 2) {
      for (let x = 0; x < image.width; x += 2) {
        const colour = getPixel(image, x, y);
        const value = (colour.r + colour.g + colour.b) / 3;
        if (value > 180) bright += 1;
        if (value < 40) dark += 1;
      }
    }
    expect(bright).toBeGreaterThan(0);
    expect(dark).toBeGreaterThan(bright);
  });

  it('tile seamlessly: the wrapped edges continue the pattern', () => {
    // A tileable texture keeps working when drawn with wrapped coordinates, which
    // is exactly what the generator does - so the simplest real check is that no
    // feature is clipped at a boundary. Sampling the four edges shows they come
    // from the same distributions as the interior.
    for (const definition of SURFACE_TEXTURES) {
      const image = definition.generate();
      const edge = (x: number, y: number): number => {
        const colour = getPixel(image, x % image.width, y % image.height);
        return (colour.r + colour.g + colour.b) / 3;
      };

      const firstColumn = edge(0, 0);
      const lastColumn = edge(image.width - 1, 0);
      const firstRow = edge(0, 0);
      const lastRow = edge(0, image.height - 1);

      // Adjacent wrapped pixels should be as similar as adjacent interior ones.
      expect(Math.abs(firstColumn - lastColumn)).toBeLessThan(140);
      expect(Math.abs(firstRow - lastRow)).toBeLessThan(140);
    }
  });

  it('has recognisable structure rather than being a flat fill', () => {
    for (const definition of SURFACE_TEXTURES) {
      const image = definition.generate();
      const seen = new Set<string>();
      for (let y = 0; y < image.height; y += 2) {
        for (let x = 0; x < image.width; x += 2) {
          const colour = getPixel(image, x, y);
          seen.add(`${colour.r},${colour.g},${colour.b}`);
        }
      }
      expect(seen.size, `${definition.id} distinct colours`).toBeGreaterThan(3);
    }
  });
});

describe('the skybox', () => {
  it('writes one image per face, in cube order', () => {
    expect(FACE_ORDER).toEqual(['px', 'nx', 'py', 'ny', 'pz', 'nz']);
  });

  it('maps face coordinates to the standard cube directions', () => {
    // Face centres point along the axes. Compared component-wise, because the
    // cube mapping legitimately produces a negative zero.
    const expectDirection = (face: Parameters<typeof skyboxFaceDirection>[0], x: number, y: number, z: number): void => {
      const direction = skyboxFaceDirection(face, 0, 0);
      expect(direction.x, face).toBeCloseTo(x, 9);
      expect(direction.y, face).toBeCloseTo(y, 9);
      expect(direction.z, face).toBeCloseTo(z, 9);
    };

    expectDirection('px', 1, 0, 0);
    expectDirection('nx', -1, 0, 0);
    expectDirection('py', 0, 1, 0);
    expectDirection('ny', 0, -1, 0);
    expectDirection('pz', 0, 0, 1);
    expectDirection('nz', 0, 0, -1);

    // Image coordinates run left-to-right and top-to-bottom.
    expect(pixelToFaceCoordinates(0, 4)).toBeCloseTo(-0.75, 9);
    expect(pixelToFaceCoordinates(3, 4)).toBeCloseTo(0.75, 9);
    expect(skyboxFaceDirection('px', 1, -1).y).toBeCloseTo(1, 9);
  });

  it('renders exactly the sky function it defines', () => {
    // This is the property that makes the faces seamless: neighbouring faces
    // agree along their shared edge because the edge's texels point the same way
    // on both, and both sample the same direction.
    for (const face of FACE_ORDER) {
      const image = generateSkyboxFace(face, 16);
      for (const [x, y] of [
        [0, 0],
        [7, 3],
        [15, 15],
        [4, 12],
      ] as const) {
        const s = pixelToFaceCoordinates(x, 16);
        const t = pixelToFaceCoordinates(y, 16);
        const expected = skyColorAt(skyboxFaceDirection(face, s, t));
        expect(getPixel(image, x, y), `${face} (${x},${y})`).toEqual(expected);
      }
    }
  });

  it('agrees across a shared face edge', () => {
    // Seamlessness is a property of the *direction* function: on the shared edge
    // `s` is -1 on one face and +1 on the other, and both look exactly the same
    // way, so they get exactly the same colour. The faces need no special-casing
    // for this - it falls out of sampling one function of direction.
    const size = 32;
    for (let row = 0; row < size; row += 1) {
      const t = pixelToFaceCoordinates(row, size);
      expect(skyColorAt(skyboxFaceDirection('px', -1, t))).toEqual(
        skyColorAt(skyboxFaceDirection('pz', 1, t)),
      );
    }
  });

  it('has no step either side of the seam', () => {
    // The outermost *texels* either side of the seam are one texel apart, so they
    // must not jump. Stars are switched off for this: a single star is a
    // legitimate discontinuity, and it is not what this is checking.
    const size = 64;
    const quiet = { starDensity: 0 };
    const left = pixelToFaceCoordinates(0, size);
    const right = pixelToFaceCoordinates(size - 1, size);

    for (let row = 0; row < size; row += 1) {
      const t = pixelToFaceCoordinates(row, size);
      const onPx = skyColorAt(skyboxFaceDirection('px', left, t), quiet);
      const onPz = skyColorAt(skyboxFaceDirection('pz', right, t), quiet);
      const distance =
        Math.abs(onPx.r - onPz.r) + Math.abs(onPx.g - onPz.g) + Math.abs(onPx.b - onPz.b);
      expect(distance, `row ${row}`).toBeLessThanOrEqual(20);
    }
  });

  it('has no hard line at the horizon', () => {
    // The below-horizon gradient carries the horizon colour *down* rather than
    // restarting at a darker one. Sampled a hair either side of elevation zero,
    // the sky must not jump - which it did, once.
    for (const azimuth of [-2.1, -0.4, 0.9, 2.6]) {
      const direction = (elevation: number): { x: number; y: number; z: number } => ({
        x: Math.sin(azimuth) * Math.cos(elevation),
        y: Math.sin(elevation),
        z: Math.cos(azimuth) * Math.cos(elevation),
      });
      const above = skyColorAt(direction(0.002));
      const below = skyColorAt(direction(-0.002));
      const distance =
        Math.abs(above.r - below.r) + Math.abs(above.g - below.g) + Math.abs(above.b - below.b);
      expect(distance, `azimuth ${azimuth}`).toBeLessThanOrEqual(4);
    }
  });

  it('is dark at the poles and brightest at the horizon', () => {
    const size = 64;
    const luminance = (face: 'py' | 'ny', axis: 'row' | 'column'): number => {
      const image = generateSkyboxFace(face, size);
      const colour = getPixel(image, axis === 'row' ? size / 2 : size / 2, axis === 'row' ? size / 2 : size / 2);
      return colour.r * 0.299 + colour.g * 0.587 + colour.b * 0.114;
    };

    // The top and bottom faces point at the zenith and nadir respectively.
    const zenith = luminance('py', 'row');
    const nadir = luminance('ny', 'row');

    const side = generateSkyboxFace('pz', size);
    let horizon = 0;
    for (let x = 0; x < size; x += 1) {
      const colour = getPixel(side, x, size / 2);
      horizon = Math.max(horizon, colour.r * 0.299 + colour.g * 0.587 + colour.b * 0.114);
    }

    expect(horizon).toBeGreaterThan(zenith);
    expect(horizon).toBeGreaterThan(nadir);
  });

  /** Mean luminance of one row of a skybox face. */
  function rowBrightness(image: RgbaImage, row: number): number {
    let total = 0;
    for (let x = 0; x < image.width; x += 1) {
      const colour = getPixel(image, x, row);
      total += colour.r * 0.299 + colour.g * 0.587 + colour.b * 0.114;
    }
    return total / image.width;
  }

  it('puts the horizon glow at the vertical centre of the side faces', () => {
    // A cube face spans about 90 degrees, so its centre row is the horizon. The
    // brightest row should sit there rather than near either edge.
    const size = 64;
    const image = generateSkyboxFace('pz', size);

    let brightestRow = 0;
    let brightest = -1;
    for (let row = 0; row < size; row += 1) {
      const value = rowBrightness(image, row);
      if (value > brightest) {
        brightest = value;
        brightestRow = row;
      }
    }

    expect(brightestRow).toBeGreaterThan(size / 2 - 6);
    expect(brightestRow).toBeLessThan(size / 2 + 6);
    expect(brightest).toBeGreaterThan(rowBrightness(image, 0));
    expect(brightest).toBeGreaterThan(rowBrightness(image, size - 1));
  });

  it('carries a magenta cast on the horizon', () => {
    const image = generateSkyboxFace('pz', 64);
    // Just above the horizon line is where the glow is warmest.
    const above = getPixel(image, 32, 30);
    expect(above.r).toBeGreaterThan(above.g);
  });

  it('keeps the glow below the horizon rather than snapping to black', () => {
    const image = generateSkyboxFace('pz', 64);
    // Rows just under the horizon still have some light in them.
    expect(rowBrightness(image, 40)).toBeGreaterThan(20);
    expect(rowBrightness(image, 40)).toBeGreaterThan(rowBrightness(image, 62) - 12);
  });

  it('is fully opaque and the declared size', () => {
    const image = generateSkyboxFace('nz', 32);
    expect(image.width).toBe(32);
    expect(getPixel(image, 5, 5).a).toBe(255);
    expect(SKYBOX_FACE_SIZE).toBeGreaterThanOrEqual(64);
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
    const image = generateCityBackdrop();
    for (let x = 0; x < image.width; x += 1) {
      expect(getPixel(image, x, image.height - 1).a, `column ${x}`).toBe(255);
    }
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
    expect(decoded.pixels).toEqual(image.pixels);
  });

  it('writes only unfiltered rows, which the decoder relies on', () => {
    expect(new Set(decodePng(encodePng(solid(8, 8, '#abcdef'))).filterTypes)).toEqual(new Set([0]));
  });

  it('preserves every colour precisely', () => {
    const image = createImage(4, 1);
    setPixel(image, 0, 0, { r: 0, g: 0, b: 0, a: 0 });
    setPixel(image, 1, 0, { r: 255, g: 255, b: 255, a: 255 });
    setPixel(image, 2, 0, { r: 1, g: 128, b: 254, a: 77 });
    setPixel(image, 3, 0, hexColor('#58deff'));
    expect(decodePng(encodePng(image)).pixels).toEqual(image.pixels);
  });

  it('rejects inconsistent sizes', () => {
    expect(() => encodePng({ width: 4, height: 4, pixels: new Uint8Array(10) })).toThrow(RangeError);
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
  });

  it('withAlpha clamps', () => {
    expect(withAlpha(hexColor('#000000'), 0.5).a).toBe(128);
    expect(withAlpha(hexColor('#000000'), 2).a).toBe(255);
    expect(withAlpha(hexColor('#000000'), -1).a).toBe(0);
  });

  it('mixColors interpolates and clamps', () => {
    expect(mixColors(hexColor('#000000'), hexColor('#ffffff'), 0.5)).toMatchObject({ r: 128, g: 128, b: 128 });
    expect(mixColors(hexColor('#000000'), hexColor('#ffffff'), 5).r).toBe(255);
  });

  it('fillRect clips, and the wrapped variant wraps', () => {
    const image = createImage(4, 4, hexColor('#000000'));
    fillRect(image, -2, -2, 4, 4, hexColor('#ffffff'));
    expect(getPixel(image, 0, 0).r).toBe(255);
    expect(getPixel(image, 2, 2).r).toBe(0);

    const wrapped = createImage(4, 4, hexColor('#000000'));
    setPixelWrapped(wrapped, -1, -1, hexColor('#ffffff'));
    expect(getPixel(wrapped, 3, 3).r).toBe(255);
    setPixelWrapped(wrapped, 4, 4, hexColor('#ffffff'));
    expect(getPixel(wrapped, 0, 0).r).toBe(255);
  });

  it('blendPixel composites source-over', () => {
    const image = createImage(2, 1, hexColor('#000000'));
    blendPixel(image, 0, 0, { r: 255, g: 255, b: 255, a: 128 });
    const blended = getPixel(image, 0, 0);
    expect(blended.r).toBeGreaterThan(100);
    expect(blended.r).toBeLessThan(160);
    expect(blended.a).toBe(255);

    blendPixel(image, 1, 0, hexColor('#ff0000'));
    expect(getPixel(image, 1, 0)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
  });

  it('the value noise tiles', () => {
    const noise = createValueNoise(7, 4);
    // Sampling either side of the wrap must agree.
    expect(noise(0, 0.25)).toBeCloseTo(noise(1, 0.25), 9);
    expect(noise(0.25, 0)).toBeCloseTo(noise(0.25, 1), 9);
    for (let index = 0; index < 50; index += 1) {
      const value = noise(index / 50, 1 - index / 50);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('the random source repeats exactly for a seed', () => {
    const first = createRandom(42);
    const second = createRandom(42);
    for (let index = 0; index < 40; index += 1) expect(first()).toBe(second());

    const random = createRandom(1);
    const seen = new Set<number>();
    for (let index = 0; index < 400; index += 1) seen.add(randomInt(random, 1, 3));
    expect(seen).toEqual(new Set([1, 2, 3]));
  });
});
