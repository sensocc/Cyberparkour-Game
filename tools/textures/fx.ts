/**
 * Effect textures: the soft shapes that are drawn rather than built.
 *
 * V0.5's smoke is a camera-facing sprite, so what it needs from art is one puff -
 * a blob with a soft, slightly irregular edge and a lot of transparency. Like
 * every other texture here it is generated rather than drawn, so it stays in the
 * diff and cannot drift.
 */

import {
  createImage,
  createValueNoise,
  hexColor,
  setPixel,
  type RgbaColor,
  type RgbaImage,
} from './png.ts';

/** Smoothstep, matching the sky's, for soft edges. */
function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export interface SmokeOptions {
  /** Edge length of the square sprite, in pixels. */
  readonly size?: number;
  readonly colour?: string;
  /** How far the noisy edge pushes the falloff around, 0 to 1. */
  readonly raggedness?: number;
}

/**
 * One smoke puff: a soft blob with a noise-broken edge.
 *
 * The alpha falls off quadratically from the middle, and the *distance* at which
 * it starts falling is pushed around by value noise, so the silhouette is a
 * cloud rather than a disc. A fine second noise pass breaks up the interior so it
 * does not read as a flat blur.
 */
export function generateSmoke(options: SmokeOptions = {}): RgbaImage {
  const size = options.size ?? 128;
  if (!Number.isInteger(size) || size <= 0) throw new RangeError('smoke size must be a positive integer');

  const image = createImage(size, size);
  const colour: RgbaColor = hexColor(options.colour ?? '#98a4c0');
  const raggedness = options.raggedness ?? 0.45;

  const shape = createValueNoise(0x5c0f, 7);
  const grain = createValueNoise(0x23a1, 19);

  const centre = (size - 1) / 2;
  const radius = size / 2;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x - centre) / radius;
      const dy = (y - centre) / radius;
      const distance = Math.hypot(dx, dy);
      if (distance >= 1) continue;

      const u = x / size;
      const v = y / size;

      // Where the falloff begins, wobbled by the noise so the edge is ragged.
      const wobble = shape(u * 1.3, v * 1.3) * raggedness;
      const edge = 1 - smoothstep(0.12 + wobble, 1, distance);
      if (edge <= 0) continue;

      // A little interior structure, so the puff is not a flat blur.
      const texture = 0.74 + 0.26 * grain(u * 2.4, v * 2.4);
      const alpha = Math.round(255 * Math.min(1, edge * edge * texture * 0.8));
      if (alpha <= 0) continue;

      setPixel(image, x, y, { ...colour, a: alpha });
    }
  }

  return image;
}
