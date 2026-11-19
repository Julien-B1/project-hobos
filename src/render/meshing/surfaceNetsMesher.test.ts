import { describe, expect, it } from 'vitest'
import { chunkKey } from '@/core/coords'
import { Material } from '@/core/materials'
import { packVoxel } from '@/core/voxel'
import { VoxelMap } from '@/core/voxelMap'
import type { MeshData } from './mesher'
import { SurfaceNetsMesher } from './surfaceNetsMesher'

const mesher = new SurfaceNetsMesher({ include: () => true, colorOf: () => [1, 1, 1] })
const GRASS = packVoxel(Material.GRASS)

/** Mesh every existing chunk of the map. */
function meshAll(map: VoxelMap): MeshData[] {
  return [...map.chunks()].map((c) => mesher.mesh(map, c))
}

const at = (arr: Float32Array, v: number, c: number): number => arr[v * 3 + c] ?? NaN

/** Rounded position key, so vertices computed by different chunks compare equal. */
const key = (m: MeshData, v: number): string =>
  [0, 1, 2].map((c) => at(m.positions, v, c).toFixed(4)).join(',')

/**
 * Closedness: every triangle edge (by vertex position) is shared by exactly
 * two triangles of the combined meshes.
 */
function expectClosed(meshes: MeshData[]): void {
  const edges = new Map<string, number>()
  for (const m of meshes) {
    for (let t = 0; t < m.indices.length; t += 3) {
      const tri = [0, 1, 2].map((o) => key(m, m.indices[t + o] ?? 0))
      for (let e = 0; e < 3; e++) {
        const a = tri[e] ?? ''
        const b = tri[(e + 1) % 3] ?? ''
        const k = a < b ? `${a}|${b}` : `${b}|${a}`
        edges.set(k, (edges.get(k) ?? 0) + 1)
      }
    }
  }
  for (const count of edges.values()) expect(count).toBe(2)
}

/** Triangles face along their stored vertex normals (outward). */
function expectOutwardWinding(m: MeshData): void {
  for (let t = 0; t < m.indices.length; t += 3) {
    const [i, j, k] = [0, 1, 2].map((o) => m.indices[t + o] ?? 0) as [number, number, number]
    const e1 = [0, 1, 2].map((c) => at(m.positions, j, c) - at(m.positions, i, c))
    const e2 = [0, 1, 2].map((c) => at(m.positions, k, c) - at(m.positions, i, c))
    const [a0 = 0, a1 = 0, a2 = 0] = e1
    const [b0 = 0, b1 = 0, b2 = 0] = e2
    const n = [a1 * b2 - a2 * b1, a2 * b0 - a0 * b2, a0 * b1 - a1 * b0]
    const avg = [0, 1, 2].map(
      (c) => at(m.normals, i, c) + at(m.normals, j, c) + at(m.normals, k, c),
    )
    expect(n.reduce((s, v, c) => s + v * (avg[c] ?? 0), 0)).toBeGreaterThan(0)
  }
}

describe('SurfaceNetsMesher', () => {
  it('produces nothing for an empty neighbourhood', () => {
    const map = new VoxelMap()
    map.set(3, 3, 3, packVoxel(Material.WOOD))
    const none = new SurfaceNetsMesher({ include: () => false, colorOf: () => [1, 1, 1] })
    const chunk = map.getChunk(chunkKey(0, 0, 0))
    if (!chunk) throw new Error('missing chunk')
    expect(none.mesh(map, chunk).indices.length).toBe(0)
  })

  it('keeps flat ground exactly on the voxel boundary', () => {
    const map = new VoxelMap()
    for (let x = 0; x < 12; x++)
      for (let z = 0; z < 12; z++)
        for (let y = 0; y < 4; y++) {
          map.set(x, y, z, GRASS)
        }
    const [m] = meshAll(map)
    if (!m) throw new Error('no mesh')
    // A vertex well inside the top face sits at level 4 = 2.0 world units.
    let found = false
    for (let v = 0; v < m.positions.length / 3; v++) {
      const x = at(m.positions, v, 0)
      const z = at(m.positions, v, 2)
      if (x > 3 && x < 9 && z > 3 && z < 9) {
        expect(at(m.positions, v, 1)).toBeCloseTo(2.0, 5)
        found = true
      }
    }
    expect(found).toBe(true)
  })

  it('builds a closed, outward-facing surface for a blob', () => {
    const map = new VoxelMap()
    for (let x = 2; x < 7; x++)
      for (let z = 2; z < 6; z++)
        for (let y = 1; y < 5; y++) {
          map.set(x, y, z, GRASS)
        }
    const meshes = meshAll(map)
    expectClosed(meshes)
    meshes.forEach(expectOutwardWinding)
  })

  it('joins chunk meshes without seams across borders and corners', () => {
    const map = new VoxelMap()
    for (let x = 10; x < 22; x++)
      for (let z = 12; z < 20; z++)
        for (let y = 12; y < 20; y++) {
          map.set(x, y, z, GRASS)
        }
    const meshes = meshAll(map)
    expect(meshes.length).toBeGreaterThan(4)
    expectClosed(meshes)
  })

  it('rounds the corners of a box (no vertex at the sharp corner)', () => {
    const map = new VoxelMap()
    for (let x = 0; x < 6; x++)
      for (let z = 0; z < 6; z++)
        for (let y = 0; y < 6; y++) {
          map.set(x, y, z, GRASS)
        }
    const [m] = meshAll(map)
    if (!m) throw new Error('no mesh')
    // The sharp corner would be at (6, 3, 6); smoothing pulls vertices inwards.
    for (let v = 0; v < m.positions.length / 3; v++) {
      const d = Math.hypot(
        at(m.positions, v, 0) - 6,
        at(m.positions, v, 1) - 3,
        at(m.positions, v, 2) - 6,
      )
      expect(d).toBeGreaterThan(0.3)
    }
  })
})
