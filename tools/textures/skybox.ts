/**
 * The skybox.
 *
 * V0.1's sky was a single gradient stretched over a sphere. V0.2 replaced it with
 * a real cube skybox, built by evaluating one function of *direction*:
 *
 *     skyColorAt(direction) -> colour
 *
 * Each of the six faces is then just that function sampled over the directions
 * its texels point at. This is what makes the seams disappear for free - two
 * neighbouring faces agree along their shared edge because the edge's texels
 * point the same way on both - and it also makes the whole thing testable: a
 * test can sample a face's pixels and compare them to the function evaluated at
 * the same directions.
 *
 * V0.5 makes it a *better* sky rather than a bigger one. A four-stop gradient
 * alone reads as a gradient; what sells a night city is layering:
 *
 *  - a **star field**, sparse and dim, that thins towards the horizon
 *  - a warm **city-glow band** just above the skyline, brightest where the
 *    district is
 *  - **two cloud layers** at different scales, so the band has structure at more
 *    than one size, lit from below near the horizon
 *
 * Every one of those is still an exact function of direction, so the sky is still
 * seamless by construction and still deterministic: the stars come from a hash of
 * the direction's cell, not from a random walk.
 */

import { createImage, hexColor, mixColors, setPixel, type RgbaColor, type RgbaImage } from './png.ts';

export type SkyboxFace = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz';

/** The order three.js expects for a `CubeTexture`. */
export const SKYBOX_FACES: readonly SkyboxFace[] = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Texture coordinates to a direction, following the OpenGL cube map convention.
 *
 * `s` runs left to right across the face and `t` runs top to bottom, matching
 * the pixel order of the generated image.
 */
export function skyboxFaceDirection(face: SkyboxFace, s: number, t: number): Vec3 {
  switch (face) {
    case 'px':
      return { x: 1, y: -t, z: -s };
    case 'nx':
      return { x: -1, y: -t, z: s };
    case 'py':
      return { x: s, y: 1, z: t };
    case 'ny':
      return { x: s, y: -1, z: -t };
    case 'pz':
      return { x: s, y: -t, z: 1 };
    case 'nz':
      return { x: -s, y: -t, z: -1 };
  }
}

/** Pixel centre to `(s, t)` in [-1, 1]. */
export function pixelToFaceCoordinates(index: number, size: number): number {
  return (2 * (index + 0.5)) / size - 1;
}

// ------------------------------------------------------------------- sky

const ZENITH = hexColor('#040613');
const UPPER = hexColor('#0c1430');
const HIGH_HAZE = hexColor('#1d2a52');
const HORIZON = hexColor('#5b3f7d');
const HORIZON_WARM = hexColor('#7c4270');
const BELOW_HORIZON = hexColor('#2e2749');
const LOWER = hexColor('#131730');
const NADIR = hexColor('#060a14');

/** The cloud band, tinted by the city glow underneath it. */
const CLOUD_HIGH = hexColor('#3f3560');
const CLOUD_LOW = hexColor('#6a4a7d');

/** The sodium-and-neon wash of a lit city, just above its skyline. */
const CITY_GLOW = hexColor('#c06a86');
const CITY_COOL = hexColor('#4d6fa8');
const STARLIGHT = hexColor('#eef2ff');

/** Smoothstep, for band edges that do not look like band edges. */
function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Linear blend across an elevation window, ascending. */
function between(from: number, to: number, at: number): number {
  return Math.max(0, Math.min(1, (at - from) / (to - from)));
}

/**
 * Linear blend across an elevation window, *descending*: 0 at `from`, 1 at `to`.
 *
 * The below-horizon stops were originally written with `between`, which walks the
 * wrong way for a gradient that is supposed to continue downwards - the result
 * was that the sky went straight to its darkest tone just under the horizon
 * instead of carrying the glow down.
 */
function descend(from: number, to: number, at: number): number {
  return Math.max(0, Math.min(1, (from - at) / (from - to)));
}

/** A 32-bit integer hash of two integers, as a float in `[0, 1)`. */
function hash2(a: number, b: number): number {
  let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Star cells across the azimuth and elevation.
 *
 * A star sits *inside* its cell, never touching the edge, so sampling only the
 * pixel's own cell is exact rather than an approximation - which is what keeps
 * the field cheap enough to evaluate per pixel.
 */
const STAR_COLUMNS = 190;
const STAR_ROWS = 95;

/** Fraction of cells that hold a star at all. */
const STAR_PRESENCE = 0.42;

/** Brightness of the star at `(u, v)`, both in `[0, 1)`. */
function starBrightness(u: number, v: number): number {
  const column = Math.floor(u * STAR_COLUMNS);
  const row = Math.floor(v * STAR_ROWS);
  if (hash2(column * 7 + 3, row * 11 + 5) > STAR_PRESENCE) return 0;

  const cellWidth = 1 / STAR_COLUMNS;
  const cellHeight = 1 / STAR_ROWS;
  const radius = (0.14 + hash2(column + 977, row + 613) * 0.2) * Math.min(cellWidth, cellHeight);
  const marginX = radius / cellWidth;
  const marginY = radius / cellHeight;
  const starU = (column + marginX + hash2(column + 31, row + 17) * (1 - 2 * marginX)) * cellWidth;
  const starV = (row + marginY + hash2(column + 53, row + 79) * (1 - 2 * marginY)) * cellHeight;

  const dx = u - starU;
  const dy = v - starV;
  // `sqrt` rather than `hypot`: it is exactly rounded (so the field is identical
  // on every engine, which matters because the result feeds a hard threshold) and
  // several times faster, which matters because this is per pixel.
  const distance = Math.sqrt(dx * dx + dy * dy);
  if (distance >= radius) return 0;
  const falloff = 1 - distance / radius;
  return (0.22 + 0.5 * hash2(column + 5, row + 41)) * falloff * falloff;
}

export interface SkyOptions {
  /** Rotates the cloud pattern, in radians. */
  readonly cloudRotation?: number;
  /** Overall cloud coverage, 0 to 1. */
  readonly cloudCoverage?: number;
  /** Overall star density, 0 to 1. */
  readonly starDensity?: number;
}

/**
 * The colour of the sky in a given direction.
 *
 * Elevation drives the gradient; the azimuth adds a directional city glow and
 * drives the cloud pattern, which is a sum of sines of the azimuth - a function
 * that wraps, so the pattern is continuous all the way around and the faces stay
 * seamless.
 */
export function skyColorAt(direction: Vec3, options: SkyOptions = {}): RgbaColor {
  // `sqrt` rather than `hypot`: exactly rounded, so the sky is identical on every
  // engine, and several times faster - which matters at half a million pixels a
  // face. The vector is only used to normalise the elevation, so any consistent
  // length would do.
  const { x, y, z } = direction;
  const length = Math.sqrt(x * x + y * y + z * z) || 1;
  const elevation = Math.asin(Math.max(-1, Math.min(1, y / length)));
  const azimuth = Math.atan2(x, z);
  // One cosine, two uses: the horizon glow and the city's pooled light both lean
  // towards the same quarter of the sky.
  const towardsCity = Math.cos(azimuth - 0.9);

  // Above the horizon, a four-stop gradient keyed on elevation. Everything below
  // reuses the *same* value at elevation zero and carries it downwards, which is
  // what stops the skyline being a hard line across the sky.
  const above = Math.max(0, elevation);
  let colour: RgbaColor;
  if (above > 0.6) {
    colour = mixColors(HIGH_HAZE, ZENITH, between(0.6, 1.5708, above));
  } else if (above > 0.2) {
    colour = mixColors(UPPER, HIGH_HAZE, between(0.2, 0.6, above));
  } else {
    colour = mixColors(HORIZON, UPPER, between(0.0, 0.2, above));
  }

  // A brighter, warmer glow towards one side of the horizon, as if the city were
  // lit from there. Applied unconditionally, so a point just below the horizon
  // inherits exactly the colour a point just above it has.
  const directional = 0.55 + 0.45 * towardsCity;
  colour = mixColors(colour, HORIZON_WARM, smoothstep(0.5, 0.0, above) * directional * 0.55);

  // The city's light, pooled along the skyline and fading out below it.
  const glowBand = smoothstep(0.34, 0.02, elevation) * smoothstep(-0.3, -0.02, elevation);
  if (glowBand > 0) {
    const warm = 0.5 + 0.5 * towardsCity;
    colour = mixColors(colour, CITY_GLOW, glowBand * (0.45 + 0.55 * warm * warm) * 0.4);
    const cool = glowBand * (0.5 + 0.5 * Math.cos(2 * azimuth + 2.1)) * 0.4;
    colour = mixColors(colour, CITY_COOL, cool * 0.25);
  }

  // Below the horizon: darken *from the horizon colour*, rather than restarting
  // at a different one.
  if (elevation < 0) {
    colour = mixColors(colour, BELOW_HORIZON, descend(0, -0.25, elevation));
    colour = mixColors(colour, LOWER, descend(-0.25, -0.6, elevation));
    if (elevation < -0.6) colour = mixColors(colour, NADIR, descend(-0.6, -1.5708, elevation));
  }

  // Clouds: a broad layer and a fine one, under one elevation window.
  const rotation = options.cloudRotation ?? 0.7;
  const coverage = options.cloudCoverage ?? 1;
  const band = smoothstep(0.05, 0.22, elevation) * smoothstep(0.78, 0.42, elevation);
  const broad =
    (0.5 + 0.5 * Math.sin(2 * (azimuth + rotation))) *
    (0.5 + 0.5 * Math.sin(3 * (azimuth + rotation * 2) + 2.4));
  const fine = 0.5 + 0.5 * Math.sin(9 * (azimuth - rotation) - 1.9);
  const cloudAmount = band * broad * (0.5 + 0.5 * fine) * coverage;

  // Low cloud, near the horizon, is lit from below by the city; high cloud keeps
  // its own colour. One mix, chosen by elevation.
  const cloudColour = mixColors(CLOUD_HIGH, CLOUD_LOW, smoothstep(0.38, 0.06, elevation));
  colour = mixColors(colour, cloudColour, cloudAmount * 0.62);

  // Stars, above the haze and below the zenith, thinned by the clouds.
  const density = options.starDensity ?? 1;
  if (elevation > 0.06 && density > 0) {
    const u = azimuth / (2 * Math.PI) + 0.5;
    const v = elevation / Math.PI + 0.5;
    const visibility =
      smoothstep(0.06, 0.26, elevation) * smoothstep(0.98, 0.86, elevation) * (1 - cloudAmount * 0.85);
    const brightness = starBrightness(u, v) * visibility * density;
    if (brightness > 0) colour = mixColors(colour, STARLIGHT, Math.min(1, brightness * 1.6));
  }

  return colour;
}

// --------------------------------------------------------------- rendering

export function generateSkyboxFace(face: SkyboxFace, size = 256): RgbaImage {
  if (!Number.isInteger(size) || size <= 0) throw new RangeError('skybox face size must be a positive integer');

  const image = createImage(size, size);

  for (let y = 0; y < size; y += 1) {
    const t = pixelToFaceCoordinates(y, size);
    for (let x = 0; x < size; x += 1) {
      const s = pixelToFaceCoordinates(x, size);
      setPixel(image, x, y, skyColorAt(skyboxFaceDirection(face, s, t)));
    }
  }

  return image;
}

/** Convenience for tests and tools: the whole skybox as face images. */
export function generateSkybox(size = 256): Record<SkyboxFace, RgbaImage> {
  const faces = {} as Record<SkyboxFace, RgbaImage>;
  for (const face of SKYBOX_FACES) faces[face] = generateSkyboxFace(face, size);
  return faces;
}
