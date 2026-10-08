/**
 * A minimal PNG encoder for the demo's flat textures.
 *
 * The city backdrop and the sky gradient ship as real PNG files (as the roadmap
 * asks), and generating them from code rather than hand-drawing them keeps the
 * palette in one place, makes them reproducible, and avoids binary art assets
 * that nobody can review in a diff.
 *
 * Deliberately dependency-free: 8-bit RGBA, filter type 0 (None), one IDAT
 * chunk. That is the simplest valid PNG and it inflates back to exactly the
 * bytes we put in.
 */

import zlib from 'node:zlib';

// Re-exported so the texture generators keep importing their randomness from
// this module, while the implementation stays in one place.
import { createRandom } from '../../src/core/random.ts';

export { createRandom };

/** Raw RGBA pixels, row-major, top row first. */
export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** PNG colour type 6: truecolour with an alpha channel. */
const COLOUR_TYPE_RGBA = 6;

/** PNG bit depth 8: one byte per channel. */
const BIT_DEPTH = 8;

/** Bytes per pixel. */
export const CHANNELS = 4;

export function createImage(width: number, height: number, fill?: RgbaColor): RgbaImage {
  if (!Number.isInteger(width) || width <= 0) throw new RangeError('width must be a positive integer');
  if (!Number.isInteger(height) || height <= 0) throw new RangeError('height must be a positive integer');

  const pixels = new Uint8Array(width * height * CHANNELS);
  const image: RgbaImage = { width, height, pixels };
  if (fill) fillRect(image, 0, 0, width, height, fill);
  return image;
}

export interface RgbaColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/** Builds an opaque colour from a `#rrggbb` string. */
export function hexColor(hex: string, alpha = 255): RgbaColor {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new RangeError(`expected a #rrggbb colour, got "${hex}"`);
  const value = Number.parseInt(match[1] as string, 16);
  return {
    r: (value >> 16) & 0xff,
    g: (value >> 8) & 0xff,
    b: value & 0xff,
    a: alpha,
  };
}

/** The same colour with a different alpha, 0..1 scaled to 0..255. */
export function withAlpha(color: RgbaColor, alpha: number): RgbaColor {
  return { ...color, a: Math.round(Math.max(0, Math.min(1, alpha)) * 255) };
}

export function mixColors(a: RgbaColor, b: RgbaColor, t: number): RgbaColor {
  const amount = Math.max(0, Math.min(1, t));
  const blend = (x: number, y: number): number => Math.round(x + (y - x) * amount);
  return {
    r: blend(a.r, b.r),
    g: blend(a.g, b.g),
    b: blend(a.b, b.b),
    a: blend(a.a, b.a),
  };
}

/** Writes one pixel, ignoring out-of-bounds coordinates. */
export function setPixel(image: RgbaImage, x: number, y: number, color: RgbaColor): void {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
  const offset = (y * image.width + x) * CHANNELS;
  image.pixels[offset] = color.r;
  image.pixels[offset + 1] = color.g;
  image.pixels[offset + 2] = color.b;
  image.pixels[offset + 3] = color.a;
}

/** Source-over blend of `color` onto one pixel. */
export function blendPixel(image: RgbaImage, x: number, y: number, color: RgbaColor): void {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
  const offset = (y * image.width + x) * CHANNELS;
  const sourceAlpha = color.a / 255;
  if (sourceAlpha >= 1) {
    setPixel(image, x, y, color);
    return;
  }

  const pixels = image.pixels;
  const destAlpha = (pixels[offset + 3] as number) / 255;
  const outAlpha = sourceAlpha + destAlpha * (1 - sourceAlpha);
  if (outAlpha === 0) {
    pixels[offset] = 0;
    pixels[offset + 1] = 0;
    pixels[offset + 2] = 0;
    pixels[offset + 3] = 0;
    return;
  }

  const channel = (index: number, source: number): number =>
    Math.round(
      ((source * sourceAlpha + (pixels[offset + index] as number) * destAlpha * (1 - sourceAlpha)) /
        outAlpha) as number,
    );

  pixels[offset] = channel(0, color.r);
  pixels[offset + 1] = channel(1, color.g);
  pixels[offset + 2] = channel(2, color.b);
  pixels[offset + 3] = Math.round(outAlpha * 255);
}

export function getPixel(image: RgbaImage, x: number, y: number): RgbaColor {
  const offset = (y * image.width + x) * CHANNELS;
  return {
    r: image.pixels[offset] as number,
    g: image.pixels[offset + 1] as number,
    b: image.pixels[offset + 2] as number,
    a: image.pixels[offset + 3] as number,
  };
}

/** Fills a rectangle, clipped to the image bounds. */
export function fillRect(
  image: RgbaImage,
  x: number,
  y: number,
  width: number,
  height: number,
  color: RgbaColor,
): void {
  const startX = Math.max(0, x);
  const startY = Math.max(0, y);
  const endX = Math.min(image.width, x + width);
  const endY = Math.min(image.height, y + height);

  for (let row = startY; row < endY; row += 1) {
    for (let column = startX; column < endX; column += 1) {
      setPixel(image, column, row, color);
    }
  }
}

/**
 * Encodes an image as a PNG.
 *
 * @throws RangeError when the width, height or pixel count are inconsistent -
 *   a silent mismatch would produce a corrupt file that only shows up in the
 *   browser.
 */
export function encodePng(image: RgbaImage): Buffer {
  const { width, height, pixels } = image;
  const expected = width * height * CHANNELS;
  if (pixels.length !== expected) {
    throw new RangeError(`expected ${expected} bytes of pixel data, got ${pixels.length}`);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = BIT_DEPTH;
  header[9] = COLOUR_TYPE_RGBA;
  header[10] = 0; // compression method: deflate
  header[11] = 0; // filter method: adaptive
  header[12] = 0; // interlace method: none

  // Each scanline is prefixed with its filter type; 0 means "no filtering",
  // which keeps the decoder trivially simple and the output exactly predictable.
  const stride = width * CHANNELS;
  const raw = Buffer.alloc((stride + 1) * height);
  const source = Buffer.from(pixels.buffer, pixels.byteOffset, pixels.length);
  for (let row = 0; row < height; row += 1) {
    const target = row * (stride + 1);
    raw[target] = 0;
    source.copy(raw, target + 1, row * stride, (row + 1) * stride);
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    createChunk('IHDR', header),
    createChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    createChunk('IEND', Buffer.alloc(0)),
  ]);
}

function createChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(typeAndData) >>> 0, 0);

  return Buffer.concat([length, typeAndData, crc]);
}

/**
 * Writes one pixel, wrapping both axes.
 *
 * Object textures tile, so every feature that lands on an edge has to reappear
 * on the opposite one. Wrapping here is what makes that automatic.
 */
export function setPixelWrapped(image: RgbaImage, x: number, y: number, color: RgbaColor): void {
  const wrappedX = ((x % image.width) + image.width) % image.width;
  const wrappedY = ((y % image.height) + image.height) % image.height;
  setPixel(image, wrappedX, wrappedY, color);
}

/** Fills a rectangle, wrapping both axes. */
export function fillRectWrapped(
  image: RgbaImage,
  x: number,
  y: number,
  width: number,
  height: number,
  color: RgbaColor,
): void {
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      setPixelWrapped(image, x + column, y + row, color);
    }
  }
}

/**
 * Tileable value noise on a `gridSize` lattice.
 *
 * The lattice wraps, so the result is seamless in both axes - which is the
 * whole point: a non-tiling mottle would show as a hard grid on a repeated
 * surface.
 */
export function createValueNoise(seed: number, gridSize = 8): (u: number, v: number) => number {
  const random = createRandom(seed);
  const lattice = new Float64Array(gridSize * gridSize);
  for (let index = 0; index < lattice.length; index += 1) lattice[index] = random();

  const at = (x: number, y: number): number => {
    const wrappedX = ((x % gridSize) + gridSize) % gridSize;
    const wrappedY = ((y % gridSize) + gridSize) % gridSize;
    return lattice[wrappedY * gridSize + wrappedX] as number;
  };

  const smooth = (t: number): number => t * t * (3 - 2 * t);

  return (u: number, v: number) => {
    const x = (((u % 1) + 1) % 1) * gridSize;
    const y = (((v % 1) + 1) % 1) * gridSize;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = smooth(x - x0);
    const ty = smooth(y - y0);

    const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
    const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
    return top + (bottom - top) * ty;
  };
}

/** Multiplies a colour's channels, for cheap shading without a colour-space round trip. */
export function scaleColor(color: RgbaColor, factor: number): RgbaColor {
  const clamp = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));
  return { r: clamp(color.r * factor), g: clamp(color.g * factor), b: clamp(color.b * factor), a: color.a };
}

/** Blends two colours by `t`, keeping the first colour's alpha. */
export function tintToward(color: RgbaColor, target: RgbaColor, t: number): RgbaColor {
  const mixed = mixColors(color, target, t);
  return { ...mixed, a: color.a };
}

/** Inclusive integer in `[min, max]`. */
export function randomInt(random: () => number, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}
