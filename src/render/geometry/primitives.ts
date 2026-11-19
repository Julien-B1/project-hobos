/**
 * Geometric primitives for structures (bridges now, buildings later).
 *
 * Layer: render (no Three.js import, unit-tested). Each primitive appends
 * triangles to a `MeshBuilder` and produces a **closed, outward-facing
 * volume**: the cut section (`sectionCap.ts`) counts front and back faces,
 * so every solid must be closed. Pieces may overlap (unions are fine).
 *
 * Every vertex carries a `BlockLook` in weight channel 0 (the blocks
 * shader picks its pattern from it).
 */
import { MeshBuilder, cross, dot, normalize, sub, type Vec3 } from '../meshing/meshBuilder'

/** Surface of a primitive: linear RGB colour and blocks-shader look. */
export interface Surface {
  readonly color: Vec3
  readonly look: number
}

/** a + b. */
export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

/** v * k. */
export function scale(v: Vec3, k: number): Vec3 {
  return [v[0] * k, v[1] * k, v[2] * k]
}

/** Point at t between a and b. */
export function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

/** Mean of points. */
export function centroid(points: readonly Vec3[]): Vec3 {
  const sum = points.reduce<Vec3>((acc, p) => add(acc, p), [0, 0, 0])
  return scale(sum, 1 / Math.max(1, points.length))
}

/** Length of v. */
export function length3(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2])
}

/**
 * Oriented box: centre, three orthonormal axes and the half size along
 * each. Six faces, flat-shaded.
 */
export function box(
  out: MeshBuilder,
  centre: Vec3,
  axes: readonly [Vec3, Vec3, Vec3],
  half: Vec3,
  surface: Surface,
): void {
  const [ex, ey, ez] = axes
  const corner = (sx: number, sy: number, sz: number): Vec3 =>
    add(centre, add(add(scale(ex, sx * half[0]), scale(ey, sy * half[1])), scale(ez, sz * half[2])))
  const w = [surface.look]
  const faces: [Vec3, Vec3[]][] = [
    [ex, [corner(1, -1, -1), corner(1, 1, -1), corner(1, 1, 1), corner(1, -1, 1)]],
    [scale(ex, -1), [corner(-1, -1, -1), corner(-1, -1, 1), corner(-1, 1, 1), corner(-1, 1, -1)]],
    [ey, [corner(-1, 1, -1), corner(-1, 1, 1), corner(1, 1, 1), corner(1, 1, -1)]],
    [scale(ey, -1), [corner(-1, -1, -1), corner(1, -1, -1), corner(1, -1, 1), corner(-1, -1, 1)]],
    [ez, [corner(-1, -1, 1), corner(1, -1, 1), corner(1, 1, 1), corner(-1, 1, 1)]],
    [scale(ez, -1), [corner(-1, -1, -1), corner(-1, 1, -1), corner(1, 1, -1), corner(1, -1, -1)]],
  ]
  for (const [normal, quad] of faces) out.polygon(quad, normal, surface.color, [w, w, w, w])
}

/** Axis-aligned box from its min and max corners. */
export function aabb(out: MeshBuilder, min: Vec3, max: Vec3, surface: Surface): void {
  box(
    out,
    scale(add(min, max), 0.5),
    [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    scale(sub(max, min), 0.5),
    surface,
  )
}

/**
 * Orthonormal frame along `direction`, with its second axis as close to
 * `up` as possible (beams keep their height vertical).
 */
export function frameAlong(direction: Vec3, up: Vec3 = [0, 1, 0]): [Vec3, Vec3, Vec3] {
  const ex = normalize(direction)
  let ey = sub(up, scale(ex, dot(up, ex)))
  if (length3(ey) < 1e-6) ey = Math.abs(ex[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1]
  ey = normalize(sub(ey, scale(ex, dot(ey, ex))))
  const ez = cross(ex, ey)
  return [ex, ey, ez]
}

/**
 * Square-section beam from `a` to `b` (centres of its end faces): `width`
 * across, `height` along the frame's up axis (see {@link frameAlong}).
 */
export function beam(
  out: MeshBuilder,
  a: Vec3,
  b: Vec3,
  width: number,
  height: number,
  surface: Surface,
  up: Vec3 = [0, 1, 0],
): void {
  const axes = frameAlong(sub(b, a), up)
  box(out, lerp3(a, b, 0.5), axes, [length3(sub(b, a)) / 2, height / 2, width / 2], surface)
}

/**
 * Round tube through `points` (a polyline), capped at both ends: ropes,
 * logs, posts. Radius per point (one value for all, or one per point).
 * Smooth-shaded sides; joints share their rings, so the tube is closed.
 */
export function tube(
  out: MeshBuilder,
  points: readonly Vec3[],
  radius: number | readonly number[],
  sides: number,
  surface: Surface,
): void {
  if (points.length < 2) return
  const r = (i: number): number => (typeof radius === 'number' ? radius : (radius[i] ?? 0))
  // Ring frames: direction at each point averages the adjacent segments.
  const directions = points.map((p, i) => {
    const prev = points[Math.max(0, i - 1)] ?? p
    const next = points[Math.min(points.length - 1, i + 1)] ?? p
    return normalize(sub(next, prev))
  })
  // A reference vector carried along (parallel transport, no twist).
  const first = directions[0] ?? [1, 0, 0]
  let u = normalize(cross(first, Math.abs(first[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]))
  const rings: Vec3[][] = []
  const normals: Vec3[][] = []
  points.forEach((p, i) => {
    const d = directions[i] ?? first
    u = normalize(sub(u, scale(d, dot(u, d))))
    const w = cross(d, u)
    const ring: Vec3[] = []
    const ringNormals: Vec3[] = []
    for (let k = 0; k < sides; k++) {
      const angle = (k / sides) * Math.PI * 2
      const n = add(scale(u, Math.cos(angle)), scale(w, Math.sin(angle)))
      ring.push(add(p, scale(n, r(i))))
      ringNormals.push(n)
    }
    rings.push(ring)
    normals.push(ringNormals)
  })
  const look = [surface.look]
  const c = surface.color
  for (let i = 0; i + 1 < rings.length; i++) {
    const a = rings[i] ?? []
    const b = rings[i + 1] ?? []
    const na = normals[i] ?? []
    const nb = normals[i + 1] ?? []
    for (let k = 0; k < sides; k++) {
      const k1 = (k + 1) % sides
      const quad = [a[k], a[k1], b[k1], b[k]] as Vec3[]
      const quadNormals = [na[k], na[k1], nb[k1], nb[k]] as Vec3[]
      // Outward: the quad's normal must agree with the radial normal.
      const outward = quadNormals[0] ?? [0, 1, 0]
      out.smoothPolygon(quad, quadNormals, outward, c, [look, look, look, look])
    }
  }
  // Caps (flat, facing away from the tube).
  const cap = (ring: Vec3[] | undefined, outward: Vec3): void => {
    if (!ring) return
    for (let k = 1; k + 1 < ring.length; k++) {
      const p0 = ring[0]
      const p1 = ring[k]
      const p2 = ring[k + 1]
      if (p0 && p1 && p2) out.polygon([p0, p1, p2], outward, c, [look, look, look])
    }
  }
  cap(rings[0], scale(first, -1))
  cap(rings[rings.length - 1], directions[directions.length - 1] ?? first)
}

/**
 * Closed hexahedron from 8 corners: a bottom loop `c[0..3]` and the top
 * loop `c[4..7]` above it in the same order (any convex-ish shape: wedges
 * of an arch, slices of a fill following a slope). Flat-shaded; each face
 * is oriented away from the solid's centre.
 */
export function hexahedron(out: MeshBuilder, c: readonly Vec3[], surface: Surface): void {
  if (c.length < 8) return
  const centre = centroid(c)
  const at = (i: number): Vec3 => c[i] ?? centre
  const faces: Vec3[][] = [
    [at(0), at(1), at(2), at(3)],
    [at(4), at(5), at(6), at(7)],
  ]
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4
    faces.push([at(i), at(j), at(j + 4), at(i + 4)])
  }
  const w = [surface.look]
  for (const face of faces) {
    const mid = centroid(face)
    // Two triangles, each oriented on its own (non-planar quads stay closed).
    for (const tri of [
      [face[0], face[1], face[2]],
      [face[0], face[2], face[3]],
    ] as Vec3[][]) {
      out.polygon(tri, sub(mid, centre), surface.color, [w, w, w])
    }
  }
}

/**
 * A rough stone slab: an irregular polygon in plan (radius jittered per
 * corner by `seed`), a flat top with a bevelled rim, sides going down to
 * `bottom` slightly wider. Closed. Stepping stones, ford boulders.
 */
export function slabStone(
  out: MeshBuilder,
  centre: Vec3,
  radius: number,
  bottom: number,
  seed: number,
  surface: Surface,
  corners = 9,
): void {
  const top = centre[1]
  const turn = hash3(seed, 1, 2) * Math.PI * 2
  const stretch = 0.8 + 0.35 * hash3(seed, 3, 4)
  const ring = (r: number, y: number): Vec3[] =>
    Array.from({ length: corners }, (_, i) => {
      const a = turn + (i / corners) * Math.PI * 2
      const k = r * (0.82 + 0.3 * hash3(seed, i, 7))
      return [centre[0] + Math.cos(a) * k * stretch, y, centre[2] + Math.sin(a) * k]
    })
  const bevel = 0.06
  const crown = ring(radius * 0.84, top)
  const rim = ring(radius, top - bevel)
  const foot = ring(radius * 1.06, bottom)
  const c = surface.color
  const w = [surface.look]
  const fan = (loop: Vec3[], apex: Vec3, outward: Vec3): void => {
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i]
      const b = loop[(i + 1) % loop.length]
      if (a && b) out.polygon([apex, a, b], outward, c, [w, w, w])
    }
  }
  const band = (upper: Vec3[], lower: Vec3[]): void => {
    for (let i = 0; i < upper.length; i++) {
      const j = (i + 1) % upper.length
      const a = upper[i]
      const b = upper[j]
      const d = lower[j]
      const e = lower[i]
      if (!a || !b || !d || !e) continue
      const outward = sub(centroid([a, b, d, e]), [centre[0], (top + bottom) / 2, centre[2]])
      out.polygon([a, b, d], outward, c, [w, w, w])
      out.polygon([a, d, e], outward, c, [w, w, w])
    }
  }
  fan(crown, [centre[0], top + 0.01, centre[2]], [0, 1, 0])
  band(crown, rim)
  band(rim, foot)
  fan(foot, [centre[0], bottom, centre[2]], [0, -1, 0])
}

/** Golden ratio (icosahedron construction). */
const PHI = (1 + Math.sqrt(5)) / 2
/** Icosahedron vertices on the unit sphere (rocks, boulders). */
export const ICO_VERTICES: readonly Vec3[] = (
  [
    [-1, PHI, 0],
    [1, PHI, 0],
    [-1, -PHI, 0],
    [1, -PHI, 0],
    [0, -1, PHI],
    [0, 1, PHI],
    [0, -1, -PHI],
    [0, 1, -PHI],
    [PHI, 0, -1],
    [PHI, 0, 1],
    [-PHI, 0, -1],
    [-PHI, 0, 1],
  ] as const
).map((v) => normalize(v))
/** Icosahedron faces: indices into {@link ICO_VERTICES}, outward winding. */
export const ICO_FACES: readonly (readonly [number, number, number])[] = [
  [0, 11, 5],
  [0, 5, 1],
  [0, 1, 7],
  [0, 7, 10],
  [0, 10, 11],
  [1, 5, 9],
  [5, 11, 4],
  [11, 10, 2],
  [10, 7, 6],
  [7, 1, 8],
  [3, 9, 4],
  [3, 4, 2],
  [3, 2, 6],
  [3, 6, 8],
  [3, 8, 9],
  [4, 9, 5],
  [2, 4, 11],
  [6, 2, 10],
  [8, 6, 7],
  [9, 8, 1],
]

/**
 * A rounded boulder: an icosahedron with corners jittered by `seed`,
 * squashed by `flatten` (height / width), turned at random. Smooth-shaded,
 * closed. Ford stones, rubble.
 */
export function boulder(
  out: MeshBuilder,
  centre: Vec3,
  radius: number,
  flatten: number,
  seed: number,
  surface: Surface,
): void {
  const turn = hash3(seed, 5, 1) * Math.PI * 2
  const cs = Math.cos(turn)
  const sn = Math.sin(turn)
  const points = ICO_VERTICES.map((v, i): Vec3 => {
    const r = radius * (0.82 + 0.36 * hash3(seed, i, 3))
    const x = v[0] * r * 1.15
    const z = v[2] * r
    return [
      centre[0] + x * cs - z * sn,
      centre[1] + v[1] * r * flatten,
      centre[2] + x * sn + z * cs,
    ]
  })
  const w = [surface.look]
  for (const [a, b, c] of ICO_FACES) {
    const p0 = points[a]
    const p1 = points[b]
    const p2 = points[c]
    if (!p0 || !p1 || !p2) continue
    const outward = sub(centroid([p0, p1, p2]), centre)
    const n = [p0, p1, p2].map((p) => normalize(sub(p, centre)))
    out.smoothPolygon([p0, p1, p2], n, outward, surface.color, [w, w, w])
  }
}

/**
 * Points of a hanging rope from `a` to `b` sagging by `sag` at mid span
 * (parabola, close to a catenary for small sags), `segments` + 1 points.
 */
export function catenary(a: Vec3, b: Vec3, sag: number, segments: number): Vec3[] {
  const points: Vec3[] = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const p = lerp3(a, b, t)
    points.push([p[0], p[1] - sag * 4 * t * (1 - t), p[2]])
  }
  return points
}

/** Deterministic hash of three numbers to [0, 1). */
export function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(Math.round(x * 1000), 73856093)
  h ^= Math.imul(Math.round(y * 1000), 19349663)
  h ^= Math.imul(Math.round(z * 1000), 83492791)
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995)
  h ^= h >>> 15
  return (h >>> 0) / 4294967296
}

export type { Vec3 }
