/**
 * A PNG decoder for the test suite.
 *
 * Supports exactly what `tools/textures/png.ts` emits: 8-bit RGBA with filter
 * type 0. Anything else throws, which is itself a useful assertion - if the
 * encoder ever starts emitting filtered rows, the refusal makes that obvious
 * instead of silently decoding wrong pixels.
 */

import zlib from 'node:zlib';

import { CHANNELS, type RgbaImage } from '../../tools/textures/png.ts';

const PNG_SIGNATURE = '89504e470d0a1a0a';

export interface DecodedPng extends RgbaImage {
  readonly filterTypes: readonly number[];
}

export function decodePng(buffer: Uint8Array): DecodedPng {
  const data = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (data.subarray(0, 8).toString('hex') !== PNG_SIGNATURE) {
    throw new Error('not a PNG: bad signature');
  }

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colourType = 0;
  const idat: Buffer[] = [];

  let position = 8;
  while (position < data.length) {
    const length = data.readUInt32BE(position);
    const type = data.subarray(position + 4, position + 8).toString('ascii');
    const body = data.subarray(position + 8, position + 8 + length);

    const expectedCrc = data.readUInt32BE(position + 8 + length);
    const actualCrc = zlib.crc32(data.subarray(position + 4, position + 8 + length)) >>> 0;
    if (expectedCrc !== actualCrc) throw new Error(`bad CRC in ${type} chunk`);

    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body[8] as number;
      colourType = body[9] as number;
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(body));
    }

    position += 12 + length;
  }

  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
  if (colourType !== 6) throw new Error(`unsupported colour type ${colourType}`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * CHANNELS;
  if (raw.length !== (stride + 1) * height) {
    throw new Error(`unexpected inflated size ${raw.length}`);
  }

  const pixels = new Uint8Array(width * height * CHANNELS);
  const filterTypes: number[] = [];
  for (let row = 0; row < height; row += 1) {
    const source = row * (stride + 1);
    const filter = raw[source] as number;
    filterTypes.push(filter);
    if (filter !== 0) throw new Error(`unsupported PNG filter ${filter} on row ${row}`);
    pixels.set(raw.subarray(source + 1, source + 1 + stride), row * stride);
  }

  return { width, height, pixels, filterTypes };
}
