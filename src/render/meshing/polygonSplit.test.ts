import { describe, expect, it } from 'vitest'
import type { Vec3 } from './meshBuilder'
import { freudenthalInterpolate, splitByPlane, splitOnGrid, type SplitVertex } from './polygonSplit'

const v = (x: number, y: number, z: number, w = 0): SplitVertex => ({ p: [x, y, z], w: [w] })

/** Area of a planar convex polygon (fan of cross products). */
function area(polygon: readonly SplitVertex[]): number {
  let sum = 0
  const a = polygon[0]
  if (!a) return 0
  for (let i = 1; i < polygon.length - 1; i++) {
    const b = polygon[i]
    const c = polygon[i + 1]
    if (!b || !c) continue
    const u = [b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]] as const
    const w = [c.p[0] - a.p[0], c.p[1] - a.p[1], c.p[2] - a.p[2]] as const
    sum +=
      Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) /
      2
  }
  return sum
}

describe('splitByPlane', () => {
  it('cuts a square in two and interpolates the data', () => {
    const square = [v(0, 0, 0, 0), v(1, 0, 0, 1), v(1, 0, 1, 1), v(0, 0, 1, 0)]
    const [below, above] = splitByPlane(square, [1, 0, 0], 0.25)
    expect(area(below)).toBeCloseTo(0.25)
    expect(area(above)).toBeCloseTo(0.75)
    const cut = below.find((c) => Math.abs(c.p[0] - 0.25) < 1e-9)
    expect(cut?.w[0]).toBeCloseTo(0.25)
  })

  it('returns the whole polygon on one side when the plane misses it', () => {
    const tri = [v(0, 0, 0), v(1, 0, 0), v(0, 0, 1)]
    const [below, above] = splitByPlane(tri, [0, 1, 0], 5)
    expect(below).toHaveLength(3)
    expect(above).toHaveLength(0)
  })
})

describe('splitOnGrid', () => {
  it('keeps the area and leaves each piece inside one tetrahedron', () => {
    const wall = [v(0, 0, 0), v(1, 0, 0), v(1, 1.5, 0), v(0, 1.5, 0)]
    const pieces = splitOnGrid(wall, 0.5)
    expect(pieces.length).toBeGreaterThan(6)
    expect(pieces.reduce((s, p) => s + area(p), 0)).toBeCloseTo(1.5)
    for (const piece of pieces) {
      // Every lattice plane leaves the piece on one side.
      for (const n of [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
        [1, -1, 0],
        [0, 1, -1],
        [1, 0, -1],
      ]) {
        const values = piece.map(
          (c) => (n[0] ?? 0) * c.p[0] + (n[1] ?? 0) * c.p[1] + (n[2] ?? 0) * c.p[2],
        )
        const lo = Math.min(...values) / 0.5
        const hi = Math.max(...values) / 0.5
        expect(Math.floor(lo + 1e-6)).toBeGreaterThanOrEqual(Math.ceil(hi - 1e-6) - 1)
      }
    }
  })

  it('leaves a polygon inside one tetrahedron untouched', () => {
    const tri = [v(0.3, 0.1, 0.05), v(0.4, 0.1, 0.05), v(0.4, 0.15, 0.05)]
    expect(splitOnGrid(tri, 0.5)).toHaveLength(1)
  })
})

describe('freudenthalInterpolate', () => {
  const value = (i: number, j: number, k: number): Vec3 => [
    Math.sin(i * 1.3 + j * 0.7) + k,
    Math.cos(j * 2.1 - k),
    i * j - k,
  ]

  it('matches the lattice values at lattice points', () => {
    expect(freudenthalInterpolate([1, 1.5, 0.5], 0.5, value)).toEqual(value(2, 3, 1))
  })

  it('is linear inside a piece: a point between two others maps between theirs', () => {
    const pieces = splitOnGrid([v(0.1, 0.2, 0.3), v(1.7, 1.1, 0.4), v(0.6, 0.3, 1.9)], 0.5)
    for (const piece of pieces) {
      const [a, b] = piece
      if (!a || !b) continue
      const mid: Vec3 = [(a.p[0] + b.p[0]) / 2, (a.p[1] + b.p[1]) / 2, (a.p[2] + b.p[2]) / 2]
      const da = freudenthalInterpolate(a.p, 0.5, value)
      const db = freudenthalInterpolate(b.p, 0.5, value)
      const dm = freudenthalInterpolate(mid, 0.5, value)
      for (let c = 0; c < 3; c++) expect(dm[c]).toBeCloseTo(((da[c] ?? 0) + (db[c] ?? 0)) / 2, 9)
    }
  })
})
