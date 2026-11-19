/**
 * Growable triangle buffers shared by the meshers, plus small vector helpers.
 *
 * Layer: render (no Three.js import). Produces `MeshData` typed arrays.
 */
import type { MeshData } from './mesher'

/** Three numbers: a position, a normal or an RGB colour. */
export type Vec3 = readonly [number, number, number]

/** Accumulates polygons and converts them to `MeshData`. */
export class MeshBuilder {
  private readonly positions: number[] = []
  private readonly normals: number[] = []
  private readonly colors: number[] = []
  private readonly indices: number[] = []
  private readonly weights: number[] = []
  private weighted = false

  /**
   * Add a convex polygon (3 or 4 vertices) as a triangle fan with one flat
   * normal. Vertices are reordered if needed so the front face points along
   * `outward`; the stored normal is the polygon's true normal.
   */
  polygon(vertices: Vec3[], outward: Vec3, color: Vec3, weights?: (readonly number[])[]): void {
    if (vertices.length < 3) return
    const [a, b, c] = vertices as [Vec3, Vec3, Vec3]
    let n = cross(sub(b, a), sub(c, a))
    if (dot(n, outward) < 0) {
      vertices.reverse()
      weights?.reverse()
      n = [-n[0], -n[1], -n[2]]
    }
    const len = Math.hypot(n[0], n[1], n[2])
    if (len === 0) return // degenerate polygon
    const normal: Vec3 = [n[0] / len, n[1] / len, n[2] / len]
    this.emit(
      vertices,
      vertices.map(() => normal),
      vertices.map(() => color),
      weights,
    )
  }

  /**
   * Add a convex polygon (3 or 4 vertices) as a triangle fan with per-vertex
   * normals (smooth shading). The vertex order is reversed when the polygon
   * faces away from `outward`; the given normals are kept as they are.
   */
  smoothPolygon(
    vertices: Vec3[],
    normals: Vec3[],
    outward: Vec3,
    color: Vec3,
    weights?: (readonly number[])[],
  ): void {
    if (vertices.length < 3) return
    const [a, b, c] = vertices as [Vec3, Vec3, Vec3]
    const n = cross(sub(b, a), sub(c, a))
    if (Math.hypot(n[0], n[1], n[2]) === 0) return // degenerate polygon
    if (dot(n, outward) < 0) {
      vertices.reverse()
      normals.reverse()
      weights?.reverse()
    }
    this.emit(
      vertices,
      normals,
      vertices.map(() => color),
      weights,
    )
  }

  /**
   * Add a convex polygon exactly as given (per-vertex normals and colours,
   * optional weights), without any winding check: for double-sided geometry
   * such as foliage cards, or when the caller already orders the vertices
   * counter-clockwise seen from the front.
   */
  rawPolygon(
    vertices: readonly Vec3[],
    normals: readonly Vec3[],
    colors: readonly Vec3[],
    weights?: (readonly number[])[],
  ): void {
    if (vertices.length < 3) return
    this.emit(vertices, normals, colors, weights)
  }

  /** Append vertices and a triangle fan over them. */
  private emit(
    vertices: readonly Vec3[],
    normals: readonly Vec3[],
    colors: readonly Vec3[],
    weights?: (readonly number[])[],
  ): void {
    const base = this.positions.length / 3
    if (weights) this.weighted = true
    vertices.forEach((v, i) => {
      const n = normals[i] ?? [0, 1, 0]
      const c = colors[i] ?? [1, 0, 1]
      this.positions.push(v[0], v[1], v[2])
      this.normals.push(n[0], n[1], n[2])
      this.colors.push(c[0], c[1], c[2])
      const w = weights?.[i] ?? []
      for (let k = 0; k < WEIGHT_SIZE; k++) this.weights.push(w[k] ?? 0)
    })
    for (let i = 1; i < vertices.length - 1; i++) this.indices.push(base, base + i, base + i + 1)
  }

  /** Freeze the buffers into typed arrays. */
  toMeshData(): MeshData {
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      colors: new Float32Array(this.colors),
      indices: new Uint32Array(this.indices),
      ...(this.weighted ? { weights: new Float32Array(this.weights) } : {}),
    }
  }
}

/** Material weights stored per vertex (two vec4). */
export const WEIGHT_SIZE = 8

/** Integer hash to a brightness factor in about [0.96, 1.04]. */
export function cellJitter(x: number, y: number, z: number): number {
  // Integer hash (xorshift-multiply); only the low bits matter here.
  let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995)
  h ^= h >>> 15
  return 0.96 + ((h >>> 0) % 1000) / 12500
}

/** a - b. */
export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

/** Cross product a x b. */
export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

/** Dot product. */
export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

/** Unit-length copy of `v` (zero vector unchanged). */
export function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2])
  return len > 0 ? [v[0] / len, v[1] / len, v[2] / len] : v
}

/** Linear RGB of an sRGB hex colour (exact sRGB transfer, as Three.js `Color.setHex`). */
export function srgbHexToLinear(hex: number): Vec3 {
  const channel = (v: number): number => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return [channel((hex >> 16) & 255), channel((hex >> 8) & 255), channel(hex & 255)]
}
