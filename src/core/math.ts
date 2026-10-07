/**
 * Scalar math helpers.
 *
 * Deliberately free of any engine dependency so the simulation core can be
 * unit-tested in plain Node.
 */

export const EPSILON = 1e-9;

export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Inverse lerp. Returns 0 when the range is degenerate. */
export function invLerp(a: number, b: number, value: number): number {
  if (a === b) return 0;
  return (value - a) / (b - a);
}

/** Move `current` toward `target` by at most `maxDelta`. */
export function approach(current: number, target: number, maxDelta: number): number {
  const diff = target - current;
  if (Math.abs(diff) <= maxDelta) return target;
  return current + Math.sign(diff) * maxDelta;
}

/**
 * Frame-rate independent exponential smoothing.
 *
 * `rate` is the fraction of the remaining gap closed per second, so the result
 * is identical whether a second is simulated in 1 step or 240.
 */
export function damp(current: number, target: number, rate: number, dt: number): number {
  const t = 1 - Math.pow(1 - clamp01(rate), dt);
  return current + (target - current) * t;
}

export function approxEquals(a: number, b: number, epsilon = 1e-6): boolean {
  return Math.abs(a - b) <= epsilon;
}

export function degToRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function radToDeg(radians: number): number {
  return (radians * 180) / Math.PI;
}

/** Wrap an angle into `(-PI, PI]`. */
export function wrapAngle(radians: number): number {
  const twoPi = Math.PI * 2;
  let wrapped = radians % twoPi;
  if (wrapped <= -Math.PI) wrapped += twoPi;
  else if (wrapped > Math.PI) wrapped -= twoPi;
  return wrapped;
}

export const TAU = Math.PI * 2;
