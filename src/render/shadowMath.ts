/**
 * Sun shadow framing maths: where to place the shadow camera so the shadow
 * map covers the view without shimmering.
 *
 * Layer: render (no Three.js import, unit-tested). World units throughout.
 *
 * The shadow map is a square seen from the sun (orthographic). Two rules
 * keep it stable while the camera moves:
 * - its size follows the camera distance in discrete steps (factor
 *   2^(1/4)), so the texel size does not change continuously while zooming;
 * - its centre is snapped to the texel grid of the sun's view plane, so
 *   panning moves the map by whole texels and shadow edges do not crawl.
 */
import type { Vec3Like } from './cameraMath'

/** Shadow map coverage (half size) relative to the camera distance. */
export const SHADOW_COVERAGE = 0.95

/** Number of size steps per doubling of the shadow map coverage. */
const STEPS_PER_OCTAVE = 4

/**
 * Half size (world units) of the square covered by the shadow map for a
 * camera at `cameraDistance` from its target: large enough to cover the
 * visible ground at the camera's pitch and field of view, rounded up to the
 * next step.
 */
export function shadowHalfExtent(cameraDistance: number): number {
  const raw = Math.max(1, cameraDistance * SHADOW_COVERAGE)
  return 2 ** (Math.ceil(Math.log2(raw) * STEPS_PER_OCTAVE - 1e-9) / STEPS_PER_OCTAVE)
}

/**
 * Orthonormal basis of the sun's view: `right` and `up` span the shadow map
 * plane, `toSun` is the unit direction from the ground towards the sun. Same
 * axes as a Three.js camera looking along `-toSun` with world up +Y.
 */
export function sunBasis(toSun: Vec3Like): { right: Vec3Like; up: Vec3Like; toSun: Vec3Like } {
  const d = normalized(toSun)
  // right = normalize(worldUp x d); fall back to +X for a sun at the zenith.
  let right = { x: d.z, y: 0, z: -d.x }
  const len = Math.hypot(right.x, right.z)
  right = len > 1e-9 ? { x: right.x / len, y: 0, z: right.z / len } : { x: 1, y: 0, z: 0 }
  const up = {
    x: d.y * right.z - d.z * right.y,
    y: d.z * right.x - d.x * right.z,
    z: d.x * right.y - d.y * right.x,
  }
  return { right, up, toSun: d }
}

/**
 * Snap `point` to the shadow map's texel grid: its coordinates along the
 * three axes of {@link sunBasis} are rounded to multiples of `texel` (the
 * depth axis too, so a still camera always yields the exact same frame).
 */
export function snapToShadowTexels(point: Vec3Like, toSun: Vec3Like, texel: number): Vec3Like {
  const { right, up, toSun: d } = sunBasis(toSun)
  const snap = (axis: Vec3Like): number => Math.round(dot(point, axis) / texel) * texel
  const u = snap(right)
  const v = snap(up)
  const w = snap(d)
  return {
    x: right.x * u + up.x * v + d.x * w,
    y: right.y * u + up.y * v + d.y * w,
    z: right.z * u + up.z * v + d.z * w,
  }
}

/** Dot product. */
function dot(a: Vec3Like, b: Vec3Like): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

/** `v` scaled to unit length (+Y for a zero vector). */
function normalized(v: Vec3Like): Vec3Like {
  const len = Math.hypot(v.x, v.y, v.z)
  return len > 0 ? { x: v.x / len, y: v.y / len, z: v.z / len } : { x: 0, y: 1, z: 0 }
}
