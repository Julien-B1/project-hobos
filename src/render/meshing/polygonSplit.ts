/**
 * Splitting of convex polygons along a regular lattice of planes, with
 * per-vertex data.
 *
 * Layer: render (no Three.js import, unit-tested). Used by the terrain
 * mesher before displacing the vertices of craggy faces. Every face is cut
 * by the same world-space planes:
 * - the grid planes x, y, z = k * step;
 * - the diagonal planes x - y, y - z, x - z = k * step.
 * Together they cut space into the tetrahedra of the Freudenthal (Kuhn)
 * triangulation of the grid cubes: each piece lies in a single tetrahedron,
 * where a displacement interpolated linearly from the lattice points is
 * exactly linear. A vertex lying on another face's edge then moves onto
 * that edge's displaced line, so faces stay joined even where their edges
 * are split differently (T-junctions): the displaced surface is watertight.
 */
import type { Vec3 } from './meshBuilder'

/** A polygon corner: position and data interpolated along with it. */
export interface SplitVertex {
  readonly p: Vec3
  readonly w: readonly number[]
}

/** A family of parallel planes: dot(normal, p) = k * step. */
type PlaneFamily = Vec3

/** Grid planes, then the diagonal planes of the Freudenthal tetrahedra. */
const FAMILIES: readonly PlaneFamily[] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, -1, 0],
  [0, 1, -1],
  [1, 0, -1],
]

/** Tolerance of the side tests. */
const EPS = 1e-9

/** Linear interpolation, computed the same way whatever the order of a and b. */
function lerpVertex(a: SplitVertex, b: SplitVertex, t: number): SplitVertex {
  // Canonical order: two faces cutting their shared edge get bit-identical
  // points, so no hairline crack opens between them.
  const swap =
    a.p[0] > b.p[0] ||
    (a.p[0] === b.p[0] && (a.p[1] > b.p[1] || (a.p[1] === b.p[1] && a.p[2] > b.p[2])))
  const [u, v, s] = swap ? [b, a, 1 - t] : [a, b, t]
  return {
    p: [
      u.p[0] + (v.p[0] - u.p[0]) * s,
      u.p[1] + (v.p[1] - u.p[1]) * s,
      u.p[2] + (v.p[2] - u.p[2]) * s,
    ],
    w: u.w.map((x, i) => x + ((v.w[i] ?? 0) - x) * s),
  }
}

/** dot(n, p). */
function along(n: PlaneFamily, p: Vec3): number {
  return n[0] * p[0] + n[1] * p[1] + n[2] * p[2]
}

/**
 * Cut a convex polygon by the plane dot(normal, p) = value: the parts
 * below and above it (either may be empty).
 */
export function splitByPlane(
  polygon: readonly SplitVertex[],
  normal: PlaneFamily,
  value: number,
): [SplitVertex[], SplitVertex[]] {
  const below: SplitVertex[] = []
  const above: SplitVertex[] = []
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]
    const b = polygon[(i + 1) % polygon.length]
    if (!a || !b) continue
    const da = along(normal, a.p) - value
    const db = along(normal, b.p) - value
    if (da <= EPS) below.push(a)
    if (da >= -EPS) above.push(a)
    if ((da < -EPS && db > EPS) || (da > EPS && db < -EPS)) {
      const cut = lerpVertex(a, b, da / (da - db))
      below.push(cut)
      above.push(cut)
    }
  }
  return [below.length >= 3 ? below : [], above.length >= 3 ? above : []]
}

/**
 * Cut a convex polygon by every lattice plane crossing it (see the module
 * comment). Returns convex pieces, each inside one tetrahedron of the
 * Freudenthal triangulation of the cubes of side `step`.
 */
export function splitOnGrid(polygon: readonly SplitVertex[], step: number): SplitVertex[][] {
  let pieces: SplitVertex[][] = [[...polygon]]
  for (const normal of FAMILIES) {
    const next: SplitVertex[][] = []
    for (const piece of pieces) {
      let rest = piece
      const values = piece.map((v) => along(normal, v.p))
      const first = Math.floor(Math.min(...values) / step + 1e-6) + 1
      const last = Math.ceil(Math.max(...values) / step - 1e-6) - 1
      for (let k = first; k <= last && rest.length >= 3; k++) {
        const [below, above] = splitByPlane(rest, normal, k * step)
        if (below.length >= 3) next.push(below)
        rest = above
      }
      if (rest.length >= 3) next.push(rest)
    }
    pieces = next
  }
  return pieces
}

/**
 * Linear interpolation of a lattice function inside the Freudenthal
 * tetrahedron containing `p` (lattice points at multiples of `step`):
 * continuous everywhere, linear inside each tetrahedron.
 */
export function freudenthalInterpolate(
  p: Vec3,
  step: number,
  valueAt: (i: number, j: number, k: number) => Vec3,
): Vec3 {
  const g = [p[0] / step, p[1] / step, p[2] / step]
  const base = g.map((c) => Math.floor(c + 1e-9))
  const local = g.map((c, i) => Math.min(1, Math.max(0, c - (base[i] ?? 0))))
  // Walk from the base corner along the axes, largest local coordinate first.
  const order = [0, 1, 2].sort((a, b) => (local[b] ?? 0) - (local[a] ?? 0))
  const corner = [base[0] ?? 0, base[1] ?? 0, base[2] ?? 0]
  let previous = 1
  const out: [number, number, number] = [0, 0, 0]
  const add = (weight: number): void => {
    const v = valueAt(corner[0] ?? 0, corner[1] ?? 0, corner[2] ?? 0)
    out[0] += v[0] * weight
    out[1] += v[1] * weight
    out[2] += v[2] * weight
  }
  for (const axis of order) {
    const a = local[axis] ?? 0
    add(previous - a)
    corner[axis] = (corner[axis] ?? 0) + 1
    previous = a
  }
  add(previous)
  return out
}
