/**
 * The skybox.
 *
 * V0.1's sky was a single gradient stretched over a sphere. V0.2 replaces it
 * with a real cube skybox, built by evaluating one function of *direction*:
 *
 *     skyColorAt(direction) -> colour
 *
 * Each of the six faces is then just that function sampled over the directions
 * its texels point at. This is what makes the seams disappear for free - two
 * neighbouring faces agree along their shared edge because the edge's texels
 * point the same way on both - and it also makes the whole thing testable: a
 * test can sample a face's pixels and compare them to the function evaluated at
 * the same directions.
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

const ZENITH = hexColor('#03050c');
const UPPER = hexColor('#0b1226');
const HIGH_HAZE = hexColor('#1b2748');
const HORIZON = hexColor('#523a72');
const HORIZON_WARM = hexColor('#6b3d68');
const BELOW_HORIZON = hexColor('#2c2545');
const LOWER = hexColor('#12162a');
const NADIR = hexColor('#06080f');
const CLOUD = hexColor('#3d3357');

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

export interface SkyOptions {
  /** Rotates the cloud pattern, in radians. */
  readonly cloudRotation?: number;
  /** Overall cloud coverage, 0 to 1. */
  readonly cloudCoverage?: number;
}

/**
 * The colour of the sky in a given direction.
 *
 * Elevation drives a gradient that is dark at the zenith, glows magenta at the
 * horizon and falls away again below it. On top of that sits a cloud band whose
 * modulation is a sum of sines of the *azimuth* - which wraps, so the pattern is
 * continuous all the way around and the faces stay seamless.
 */
export function skyColorAt(direction: Vec3, options: SkyOptions = {}): RgbaColor {
  const length = Math.hypot(direction.x, direction.y, direction.z) || 1;
  const elevation = Math.asin(Math.max(-1, Math.min(1, direction.y / length)));
  const azimuth = Math.atan2(direction.x, direction.z);

  // Four-stop gradient, keyed on elevation.
  let colour: RgbaColor;
  if (elevation >= 0) {
    if (elevation > 0.6) {
      colour = mixColors(HIGH_HAZE, ZENITH, between(0.6, 1.5708, elevation));
    } else if (elevation > 0.2) {
      colour = mixColors(UPPER, HIGH_HAZE, between(0.2, 0.6, elevation));
    } else {
      colour = mixColors(HORIZON, UPPER, between(0.0, 0.2, elevation));
    }
    // A brighter, warmer glow towards one side of the horizon, as if the city
    // were lit from there.
    const directional = 0.55 + 0.45 * Math.cos(azimuth - 0.9);
    const glow = smoothstep(0.5, 0.0, elevation) * directional;
    colour = mixColors(colour, HORIZON_WARM, glow * 0.55);
  } else {
    if (elevation > -0.12) colour = mixColors(BELOW_HORIZON, LOWER, descend(0, -0.12, elevation));
    else colour = mixColors(LOWER, NADIR, descend(-0.12, -1.5708, elevation));
  }

  // Clouds: three sines of azimuth plus a smooth elevation window.
  const rotation = options.cloudRotation ?? 0.7;
  const coverage = options.cloudCoverage ?? 1;
  const band = smoothstep(0.06, 0.24, elevation) * smoothstep(0.72, 0.4, elevation);
  const ripple =
    (0.5 + 0.5 * Math.sin(2 * (azimuth + rotation))) *
    (0.5 + 0.5 * Math.sin(5 * (azimuth - rotation) - 1.9)) *
    (0.5 + 0.5 * Math.sin(3 * (azimuth + rotation * 2) + 2.4));
  const cloudAmount = band * ripple * coverage;

  return mixColors(colour, CLOUD, cloudAmount * 0.4);
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
