/**
 * Simplistic, tileable object textures.
 *
 * Every roof prop is textured with one of these instead of being a flat colour.
 * They are deliberately small, low-contrast and repeatable: the look the game is
 * going for is low-poly with just enough surface detail to read as metal,
 * concrete or tread plate at a distance.
 *
 * All six tile in both axes, because the scene builder repeats them in world
 * space so a texture keeps a constant physical size whatever the prop's
 * dimensions.
 */

import {
  createRandom,
  createValueNoise,
  createImage,
  fillRect,
  fillRectWrapped,
  hexColor,
  mixColors,
  scaleColor,
  setPixel,
  setPixelWrapped,
  type RgbaColor,
  type RgbaImage,
} from './png.ts';

export type SurfaceTextureId =
  | 'deck-plate'
  | 'metal-panel'
  | 'concrete'
  | 'hazard'
  | 'grille'
  | 'glass'
  | 'sign';

export interface SurfaceTextureDefinition {
  readonly id: SurfaceTextureId;
  /** Edge length of the square texture, in pixels. */
  readonly size: number;
  /** How many world metres one tile covers. */
  readonly metresPerTile: number;
  readonly generate: () => RgbaImage;
}

const DEFAULT_SIZE = 128;

/** Speckle radius and count used by the roughness passes. */
function speckle(
  image: RgbaImage,
  random: () => number,
  count: number,
  base: RgbaColor,
  spread: number,
): void {
  for (let index = 0; index < count; index += 1) {
    const x = Math.floor(random() * image.width);
    const y = Math.floor(random() * image.height);
    const shade = 1 + (random() - 0.5) * spread;
    setPixelWrapped(image, x, y, scaleColor(base, shade));
  }
}

/** A soft, wrapping blotch pass, used to break up flat fills. */
function mottle(
  image: RgbaImage,
  seed: number,
  base: RgbaColor,
  strength: number,
  gridSize = 6,
): void {
  const noise = createValueNoise(seed, gridSize);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const amount = noise(x / image.width, y / image.height);
      setPixel(image, x, y, scaleColor(base, 1 - strength / 2 + amount * strength));
    }
  }
}

// ------------------------------------------------------------ deck plate

function generateDeckPlate(size = DEFAULT_SIZE): RgbaImage {
  const image = createImage(size, size);
  const base = hexColor('#b6c1cf');
  mottle(image, 0x51de, base, 0.22, 5);

  const random = createRandom(0x51de);

  // Raised tread diamonds, the thing that makes tread plate read as tread plate.
  const step = Math.round(size / 8);
  const half = Math.max(2, Math.round(step / 4));
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      const centreX = column * step + (row % 2 === 0 ? step / 2 : 0);
      const centreY = row * step + step / 2;
      const tone = scaleColor(base, 1.18 + random() * 0.1);
      const shadow = scaleColor(base, 0.72);
      for (let dy = -half; dy <= half; dy += 1) {
        const span = half - Math.abs(dy);
        for (let dx = -span; dx <= span; dx += 1) {
          setPixelWrapped(image, Math.round(centreX + dx), Math.round(centreY + dy), tone);
          setPixelWrapped(image, Math.round(centreX + dx), Math.round(centreY + dy) + 1, shadow);
        }
      }
    }
  }

  // Plate seams.
  const seam = hexColor('#7d8b9c');
  fillRectWrapped(image, 0, 0, size, 2, seam);
  fillRectWrapped(image, 0, 0, 2, size, seam);

  speckle(image, random, Math.round(size * size * 0.02), base, 0.5);
  return image;
}

// ----------------------------------------------------------- metal panel

function generateMetalPanel(size = DEFAULT_SIZE): RgbaImage {
  const image = createImage(size, size);
  const base = hexColor('#cfd7e1');
  mottle(image, 0x9a31, base, 0.16, 4);

  const random = createRandom(0x9a31);
  const seam = scaleColor(base, 0.58);
  const highlight = scaleColor(base, 1.24);

  // Four panels, so the sheet has structure at any repeat scale.
  const half = Math.round(size / 2);
  fillRectWrapped(image, 0, 0, size, 2, seam);
  fillRectWrapped(image, 0, 0, 2, size, seam);
  fillRectWrapped(image, half, 0, 2, size, seam);
  fillRectWrapped(image, 0, half, size, 2, seam);

  // A light catch along one edge of each seam.
  fillRectWrapped(image, 0, 2, size, 1, highlight);
  fillRectWrapped(image, half + 2, 0, 1, size, highlight);

  // Rivets at the panel corners.
  const rivet = scaleColor(base, 1.32);
  const rivetShadow = scaleColor(base, 0.62);
  for (const [x, y] of [
    [6, 8],
    [half - 8, 8],
    [6, half - 8],
    [half - 8, half - 8],
  ] as const) {
    setPixelWrapped(image, x, y, rivet);
    setPixelWrapped(image, x + 1, y, rivet);
    setPixelWrapped(image, x, y + 1, rivetShadow);
    setPixelWrapped(image, x + 1, y + 1, rivetShadow);
  }

  // Streaks of grime running down the panel.
  for (let index = 0; index < 14; index += 1) {
    const x = Math.floor(random() * size);
    const start = Math.floor(random() * size);
    const length = 6 + Math.floor(random() * 24);
    for (let offset = 0; offset < length; offset += 1) {
      setPixelWrapped(image, x, start + offset, scaleColor(base, 0.86));
    }
  }

  speckle(image, random, Math.round(size * size * 0.015), base, 0.35);
  return image;
}

// --------------------------------------------------------------- concrete

function generateConcrete(size = DEFAULT_SIZE): RgbaImage {
  const image = createImage(size, size);
  const base = hexColor('#d6dade');
  mottle(image, 0x2e77, base, 0.26, 5);

  const random = createRandom(0x2e77);
  const grit = Math.max(1, Math.round(size / 64));

  // Aggregate: light and dark grains.
  for (let index = 0; index < Math.round(size * size * 0.05); index += 1) {
    const x = Math.floor(random() * size);
    const y = Math.floor(random() * size);
    const lighter = random() > 0.5;
    const tone = scaleColor(base, lighter ? 1.3 : 0.74);
    fillRectWrapped(image, x, y, grit, grit, tone);
  }

  // A couple of hairline cracks.
  for (let crack = 0; crack < 3; crack += 1) {
    let x = Math.floor(random() * size);
    let y = Math.floor(random() * size);
    const length = 18 + Math.floor(random() * 30);
    for (let offset = 0; offset < length; offset += 1) {
      setPixelWrapped(image, x, y, scaleColor(base, 0.62));
      x += random() > 0.5 ? 1 : 0;
      y += random() > 0.3 ? 1 : 0;
    }
  }

  return image;
}

// ----------------------------------------------------------------- hazard

function generateHazard(size = DEFAULT_SIZE): RgbaImage {
  const image = createImage(size, size);
  const amber = hexColor('#cf9a33');
  const dark = hexColor('#262a32');

  // Diagonal stripes drawn by wrapping the coordinates, so the band pattern
  // survives tiling in both axes.
  const period = Math.round(size / 6);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const band = Math.floor((((x + y) % size) + size) % size / period) % 2;
      setPixel(image, x, y, band === 0 ? amber : dark);
    }
  }

  // Worn edges and grime, so it does not look like a sticker.
  const random = createRandom(0x77c1);
  for (let index = 0; index < Math.round(size * size * 0.06); index += 1) {
    const x = Math.floor(random() * size);
    const y = Math.floor(random() * size);
    const current = image.pixels[(y * size + x) * 4] as number;
    const wear = current > 120 ? scaleColor(dark, 1.1) : scaleColor(amber, 0.8);
    setPixel(image, x, y, wear);
  }

  return image;
}

// ----------------------------------------------------------------- grille

function generateGrille(size = DEFAULT_SIZE): RgbaImage {
  const image = createImage(size, size);
  const frame = hexColor('#dae1ea');
  const slat = hexColor('#b9c4d3');
  const gap = hexColor('#3b4351');

  fillRect(image, 0, 0, size, size, slat);

  // Horizontal louvres: a lit top edge and a dark gap under each one.
  const pitch = Math.max(6, Math.round(size / 12));
  for (let y = 0; y < size; y += pitch) {
    fillRect(image, 0, y, size, 1, scaleColor(slat, 1.35));
    fillRect(image, 0, y + 1, size, Math.max(2, pitch - 4), gap);
    fillRect(image, 0, y + pitch - 3, size, 2, scaleColor(slat, 1.1));
  }

  // A frame around the sheet, so a vent reads as recessed when it repeats.
  const border = Math.max(2, Math.round(size / 32));
  fillRect(image, 0, 0, size, border, frame);
  fillRect(image, 0, size - border, size, border, frame);
  fillRect(image, 0, 0, border, size, frame);
  fillRect(image, size - border, 0, border, size, frame);

  return image;
}

// ------------------------------------------------------------------ glass

function generateGlass(size = DEFAULT_SIZE): RgbaImage {
  const image = createImage(size, size);
  const deep = hexColor('#7fb4c6');
  const lit = hexColor('#d3ecf4');

  // A soft vertical gradient with a diagonal sheen, which is all "glass" needs
  // to read at low poly.
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const vertical = y / (size - 1);
      const sheen = Math.max(0, 1 - Math.abs((x / size + y / size * 0.4) - 0.55) * 6);
      const base = mixColors(deep, lit, 0.18 + vertical * 0.2);
      setPixel(image, x, y, mixColors(base, lit, sheen * 0.35));
    }
  }

  // Muntin bars, so a skylight has panes rather than being a blue rectangle.
  const bar = hexColor('#e6edf5');
  const middle = Math.round(size / 2);
  const width = Math.max(1, Math.round(size / 42));
  fillRect(image, middle, 0, width, size, bar);
  fillRect(image, 0, middle, size, width, bar);

  return image;
}

// ------------------------------------------------------------------ signage

/**
 * A neon sign panel: bright glyphs on a dark backing.
 *
 * The texture is used as both the albedo and the emissive map, so the glyphs are
 * what glows and the dark panel settles behind them. The glyphs are abstract
 * blocks rather than letters: at the distance a sign is read in this demo a real
 * typeface would only be mush, and bars read as "sign" from across the canyon.
 */
function generateSign(size = DEFAULT_SIZE): RgbaImage {
  const image = createImage(size, size);
  const random = createRandom(0x519a);

  const backing = hexColor('#0b1118');
  const tracing = hexColor('#1d2b3a');
  const glyph = hexColor('#f2fbff');

  // Dark backing with a faint panel edge, so the sign has a shape of its own.
  fillRect(image, 0, 0, size, size, backing);
  const inset = Math.max(2, Math.round(size / 32));
  fillRect(image, inset, inset, size - inset * 2, 1, tracing);
  fillRect(image, inset, size - inset - 1, size - inset * 2, 1, tracing);
  fillRect(image, inset, inset, 1, size - inset * 2, tracing);
  fillRect(image, size - inset - 1, inset, 1, size - inset * 2, tracing);

  // Three rows of abstract glyphs, each a handful of strokes inside a cell.
  const columns = 6;
  const rows = 3;
  const cellWidth = Math.floor(size / (columns + 1));
  const cellHeight = Math.floor(size / (rows + 1));
  const stroke = Math.max(1, Math.round(size / 56));

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const originX = Math.round(cellWidth * (column + 0.5));
      const originY = Math.round(cellHeight * (row + 0.5));
      const strokes = 2 + Math.floor(random() * 3);

      for (let index = 0; index < strokes; index += 1) {
        const length = Math.round((0.35 + random() * 0.55) * Math.min(cellWidth, cellHeight) * 0.85);
        const offset = Math.round((random() - 0.5) * cellHeight * 0.4);
        if (random() < 0.6) {
          fillRect(image, originX - Math.round(length / 2), originY + offset, length, stroke, glyph);
        } else {
          fillRect(image, originX + offset, originY - Math.round(length / 2), stroke, length, glyph);
        }
      }
    }
  }

  // A little dim wear, so the panel is not perfectly regular.
  for (let index = 0; index < Math.round(size * size * 0.008); index += 1) {
    const x = Math.floor(random() * size);
    const y = Math.floor(random() * size);
    setPixel(image, x, y, scaleColor(tracing, 0.5 + random() * 0.7));
  }

  return image;
}

// -------------------------------------------------------------------------

export const SURFACE_TEXTURES: readonly SurfaceTextureDefinition[] = [
  { id: 'deck-plate', size: DEFAULT_SIZE, metresPerTile: 2.5, generate: generateDeckPlate },
  { id: 'metal-panel', size: DEFAULT_SIZE, metresPerTile: 2, generate: generateMetalPanel },
  { id: 'concrete', size: DEFAULT_SIZE, metresPerTile: 3, generate: generateConcrete },
  { id: 'hazard', size: DEFAULT_SIZE, metresPerTile: 1.2, generate: generateHazard },
  { id: 'grille', size: DEFAULT_SIZE, metresPerTile: 0.8, generate: generateGrille },
  { id: 'glass', size: DEFAULT_SIZE, metresPerTile: 2, generate: generateGlass },
  { id: 'sign', size: DEFAULT_SIZE, metresPerTile: 2, generate: generateSign },
];

export function surfaceMetresPerTile(id: SurfaceTextureId): number {
  const found = SURFACE_TEXTURES.find((entry) => entry.id === id);
  if (!found) throw new RangeError(`unknown surface texture "${id}"`);
  return found.metresPerTile;
}
