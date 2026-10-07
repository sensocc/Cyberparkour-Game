/**
 * Minimal, allocation-conscious 3D vector helpers.
 *
 * The simulation core uses its own `Vec3` shape rather than `THREE.Vector3` so
 * that gameplay code stays engine-agnostic (and testable without WebGL). The
 * render layer converts these into three.js objects at the boundary.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface ReadonlyVec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function cloneVec3(v: ReadonlyVec3): Vec3 {
  return { x: v.x, y: v.y, z: v.z };
}

export function copyVec3(out: Vec3, v: ReadonlyVec3): Vec3 {
  out.x = v.x;
  out.y = v.y;
  out.z = v.z;
  return out;
}

export function setVec3(out: Vec3, x: number, y: number, z: number): Vec3 {
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

export function addVec3(out: Vec3, a: ReadonlyVec3, b: ReadonlyVec3): Vec3 {
  out.x = a.x + b.x;
  out.y = a.y + b.y;
  out.z = a.z + b.z;
  return out;
}

export function subVec3(out: Vec3, a: ReadonlyVec3, b: ReadonlyVec3): Vec3 {
  out.x = a.x - b.x;
  out.y = a.y - b.y;
  out.z = a.z - b.z;
  return out;
}

export function scaleVec3(out: Vec3, v: ReadonlyVec3, scalar: number): Vec3 {
  out.x = v.x * scalar;
  out.y = v.y * scalar;
  out.z = v.z * scalar;
  return out;
}

/** `out = a + b * scalar` */
export function addScaledVec3(out: Vec3, a: ReadonlyVec3, b: ReadonlyVec3, scalar: number): Vec3 {
  out.x = a.x + b.x * scalar;
  out.y = a.y + b.y * scalar;
  out.z = a.z + b.z * scalar;
  return out;
}

export function dotVec3(a: ReadonlyVec3, b: ReadonlyVec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function lengthVec3(v: ReadonlyVec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

export function lengthSqVec3(v: ReadonlyVec3): number {
  return v.x * v.x + v.y * v.y + v.z * v.z;
}

/** Horizontal (XZ) length, ignoring Y - the metric movement code cares about. */
export function lengthXZ(v: ReadonlyVec3): number {
  return Math.hypot(v.x, v.z);
}

/** Returns `out`; writes a zero vector when the input has no length. */
export function normalizeVec3(out: Vec3, v: ReadonlyVec3): Vec3 {
  const len = lengthVec3(v);
  if (len === 0) {
    out.x = 0;
    out.y = 0;
    out.z = 0;
    return out;
  }
  const inv = 1 / len;
  out.x = v.x * inv;
  out.y = v.y * inv;
  out.z = v.z * inv;
  return out;
}

export function lerpVec3(out: Vec3, a: ReadonlyVec3, b: ReadonlyVec3, t: number): Vec3 {
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  out.z = a.z + (b.z - a.z) * t;
  return out;
}

export function equalsVec3(a: ReadonlyVec3, b: ReadonlyVec3, epsilon = 1e-6): boolean {
  return (
    Math.abs(a.x - b.x) <= epsilon &&
    Math.abs(a.y - b.y) <= epsilon &&
    Math.abs(a.z - b.z) <= epsilon
  );
}

/**
 * Builds the unit forward/right basis for a yaw-only (FPS) orientation.
 *
 * Matches three.js conventions: at yaw 0 the camera looks down `-Z`, and `+X`
 * is to its right.
 */
export function yawBasis(yaw: number): { forward: Vec3; right: Vec3 } {
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  return {
    forward: { x: -sin, y: 0, z: -cos },
    right: { x: cos, y: 0, z: -sin },
  };
}
