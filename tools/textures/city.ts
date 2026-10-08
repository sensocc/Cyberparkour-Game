/**
 * The painted city skyline.
 *
 * A layered night skyline drawn far-to-near. Above the silhouette the alpha
 * channel stays 0, so the skybox shows through the gaps - which is the whole
 * point of a flat backdrop. Buildings are packed edge to edge across the full
 * width with the last one clipped, so the texture wraps around a cylinder
 * without a visible seam: the wrap point just looks like two neighbouring
 * buildings of different heights.
 */

import {
  blendPixel,
  createImage,
  createRandom,
  fillRect,
  getPixel,
  hexColor,
  randomInt,
  type RgbaColor,
  type RgbaImage,
} from './png.ts';

// ---------------------------------------------------------- city backdrop

interface SkylineLayer {
  readonly color: RgbaColor;
  /** Building height as a fraction of the image height. */
  readonly minHeight: number;
  readonly maxHeight: number;
  /** Building width, in pixels. */
  readonly minWidth: number;
  readonly maxWidth: number;
  /** Probability that any one window is lit. */
  readonly litChance: number;
  readonly windowColor: RgbaColor;
  readonly windowSize: number;
  readonly windowGapX: number;
  readonly windowGapY: number;
  /** Probability of a rooftop beacon on a given building. */
  readonly beaconChance: number;
  readonly beaconColor: RgbaColor;
}

export interface CityBackdropOptions {
  readonly width?: number;
  readonly height?: number;
  readonly seed?: number;
}

/**
 * A layered night skyline, drawn far-to-near.
 *
 * Above the silhouette the alpha channel stays 0, so the gradient sky shows
 * through the gaps - which is the whole point of a flat backdrop.
 *
 * Buildings are packed edge to edge across the full width with the last one
 * clipped, so the texture wraps around a cylinder without a visible seam: the
 * wrap point just looks like two neighbouring buildings of different heights.
 */
export function generateCityBackdrop(options: CityBackdropOptions = {}): RgbaImage {
  const width = options.width ?? 2048;
  const height = options.height ?? 512;
  const random = createRandom(options.seed ?? 0x0c17b3a5);

  const image = createImage(width, height);

  // Far to near: distant layers are paler (atmospheric haze) and shorter, near
  // layers are darker silhouettes with the most lit windows.
  const layers: SkylineLayer[] = [
    {
      color: hexColor('#48587f'),
      minHeight: 0.3,
      maxHeight: 0.62,
      minWidth: 26,
      maxWidth: 74,
      litChance: 0.05,
      windowColor: hexColor('#a8c7ec'),
      windowSize: 2,
      windowGapX: 6,
      windowGapY: 7,
      beaconChance: 0.04,
      beaconColor: hexColor('#ffe2b0'),
    },
    {
      color: hexColor('#2e3b57'),
      minHeight: 0.18,
      maxHeight: 0.46,
      minWidth: 36,
      maxWidth: 104,
      litChance: 0.08,
      windowColor: hexColor('#ffc27a'),
      windowSize: 3,
      windowGapX: 8,
      windowGapY: 10,
      beaconChance: 0.06,
      beaconColor: hexColor('#ff9d5c'),
    },
    {
      color: hexColor('#1e2636'),
      minHeight: 0.1,
      maxHeight: 0.32,
      minWidth: 52,
      maxWidth: 140,
      litChance: 0.11,
      windowColor: hexColor('#58deff'),
      windowSize: 3,
      windowGapX: 9,
      windowGapY: 12,
      beaconChance: 0.09,
      beaconColor: hexColor('#ff4fa3'),
    },
  ];

  for (const layer of layers) {
    let x = 0;
    while (x < width) {
      const buildingWidth = Math.min(randomInt(random, layer.minWidth, layer.maxWidth), width - x);
      const buildingHeight = Math.round(
        height * (layer.minHeight + random() * (layer.maxHeight - layer.minHeight)),
      );
      const top = height - buildingHeight;

      fillRect(image, x, top, buildingWidth, buildingHeight, layer.color);
      drawWindows(image, random, layer, x, top, buildingWidth, buildingHeight);

      if (random() < layer.beaconChance && buildingWidth > 24) {
        const beaconX = x + Math.floor(buildingWidth / 2);
        fillRect(image, beaconX, top - 1, 2, 3, layer.beaconColor);
      }

      x += buildingWidth;
    }
  }

  // A faint single-pixel rim on the near silhouettes keeps the skyline crisp
  // against the sky at a distance, where the texture is minified.
  outline(image, hexColor('#39496e'));

  return image;
}

function drawWindows(
  image: RgbaImage,
  random: () => number,
  layer: SkylineLayer,
  buildingX: number,
  buildingTop: number,
  buildingWidth: number,
  buildingHeight: number,
): void {
  const size = layer.windowSize;
  // Leave a margin so windows do not sit on the building's edge.
  const inset = size + 3;
  if (buildingWidth < inset * 2 || buildingHeight < inset * 2) return;

  for (let y = buildingTop + inset; y + size <= buildingTop + buildingHeight - 2; y += layer.windowGapY) {
    for (let x = buildingX + inset; x + size <= buildingX + buildingWidth - 2; x += layer.windowGapX) {
      if (random() >= layer.litChance) continue;
      // Jitter the brightness so a lit block does not look like a solid slab.
      const brightness = 0.55 + random() * 0.45;
      const color: RgbaColor = {
        r: Math.round(layer.windowColor.r * brightness),
        g: Math.round(layer.windowColor.g * brightness),
        b: Math.round(layer.windowColor.b * brightness),
        a: 255,
      };
      fillRect(image, x, y, size, size, color);
    }
  }
}

/** Adds a one-pixel highlight along the top edge of every silhouette run. */
function outline(image: RgbaImage, color: RgbaColor): void {
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const here = getPixel(image, x, y);
      if (here.a === 0) continue;
      const above = y === 0 ? { r: 0, g: 0, b: 0, a: 0 } : getPixel(image, x, y - 1);
      if (above.a === 0) blendPixel(image, x, y, { ...color, a: 90 });
    }
  }
}
