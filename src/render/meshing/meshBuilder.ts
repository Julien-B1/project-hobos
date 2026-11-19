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

  /**
   * Add a convex polygon (3 or 4 vertices) as a triangle fan with one flat
   * normal. Vertices are reordered if needed so the front face points along
   * `outward`; the stored normal is the polygon's true normal.
   */
  polygon(vertices: Vec3[], outward: Vec3, color: Vec3): void {
    if (vertices.length < 3) return
    const [a, b, c] = vertices as [Vec3, Vec3, Vec3]
    let n = cross(sub(b, a), sub(c, a))
    if (dot(n, outward) < 0) {
      vertices.reverse()
      n = [-n[0], -n[1], -n[2]]
    }
    const len = Math.hypot(n[0], n[1], n[2])
    if (len === 0) return // degenerate polygon
    const normal: Vec3 = [n[0] / len, n[1] / len, n[2] / len]
    this.emit(
      vertices,
      vertices.map(() => normal),
      vertices.map(() => color),
    )
  }

  /**
   * Add a quad with per-vertex normals and colours (smooth shading), as two
   * triangles. The vertex order is reversed when the quad faces away from
   * `outward`.
   */
  smoothQuad(vertices: Vec3[], normals: Vec3[], colors: Vec3[], outward: Vec3): void {
    const [a, b, c] = vertices as [Vec3, Vec3, Vec3]
    if (dot(cross(sub(b, a), sub(c, a)), outward) < 0) {
      vertices.reverse()
      normals.reverse()
      colors.reverse()
    }
    this.emit(vertices, normals, colors)
  }

  /** Append vertices and a triangle fan over them. */
  private emit(vertices: readonly Vec3[], normals: readonly Vec3[], colors: readonly Vec3[]): void {
    const base = this.positions.length / 3
    vertices.forEach((v, i) => {
      const n = normals[i] ?? [0, 1, 0]
      const c = colors[i] ?? [1, 0, 1]
      this.positions.push(v[0], v[1], v[2])
      this.normals.push(n[0], n[1], n[2])
      this.colors.push(c[0], c[1], c[2])
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
    }
  }
}

/** Concatenate several meshes into one (indices are rebased). */
export function mergeMeshData(parts: readonly MeshData[]): MeshData {
  const total = (pick: (m: MeshData) => ArrayLike<number>): number =>
    parts.reduce((n, m) => n + pick(m).length, 0)
  const positions = new Float32Array(total((m) => m.positions))
  const normals = new Float32Array(total((m) => m.normals))
  const colors = new Float32Array(total((m) => m.colors))
  const indices = new Uint32Array(total((m) => m.indices))
  let v = 0
  let i = 0
  for (const m of parts) {
    positions.set(m.positions, v)
    normals.set(m.normals, v)
    colors.set(m.colors, v)
    const base = v / 3
    for (let k = 0; k < m.indices.length; k++) indices[i + k] = (m.indices[k] ?? 0) + base
    v += m.positions.length
    i += m.indices.length
  }
  return { positions, normals, colors, indices }
}

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
