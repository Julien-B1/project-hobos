import { describe, expect, it } from 'vitest'
import { chunkKey } from '@/core/coords'
import { Material } from '@/core/materials'
import { Orientation, Shape } from '@/core/shapes'
import { packVoxel } from '@/core/voxel'
import { VoxelMap } from '@/core/voxelMap'
import { CulledMesher } from './culledMesher'
import type { MeshData } from './mesher'

const mesher = new CulledMesher(() => [1, 1, 1])
const FULL = packVoxel(Material.STONE)
const slope = (o: number): number => packVoxel(Material.STONE, Shape.SLOPE, o)

function meshOf(map: VoxelMap, cx = 0, cy = 0, cz = 0): MeshData {
  const chunk = map.getChunk(chunkKey(cx, cy, cz))
  if (!chunk) throw new Error('missing chunk')
  return mesher.mesh(map, chunk)
}

const vertexCount = (m: MeshData): number => m.positions.length / 3
const triangleCount = (m: MeshData): number => m.indices.length / 3

/** Component `c` of vertex `v` in a flat 3-component array. */
const at = (arr: Float32Array, v: number, c: number): number => arr[v * 3 + c] ?? NaN

/** Every triangle's winding agrees with its vertices' stored normal. */
function expectConsistentWinding(m: MeshData): void {
  for (let t = 0; t < m.indices.length; t += 3) {
    const i = m.indices[t] ?? 0
    const j = m.indices[t + 1] ?? 0
    const k = m.indices[t + 2] ?? 0
    const e1 = [0, 1, 2].map((c) => at(m.positions, j, c) - at(m.positions, i, c))
    const e2 = [0, 1, 2].map((c) => at(m.positions, k, c) - at(m.positions, i, c))
    const [a0 = 0, a1 = 0, a2 = 0] = e1
    const [b0 = 0, b1 = 0, b2 = 0] = e2
    const n = [a1 * b2 - a2 * b1, a2 * b0 - a0 * b2, a0 * b1 - a1 * b0]
    const dot = n.reduce((sum, v, c) => sum + v * at(m.normals, i, c), 0)
    expect(dot).toBeGreaterThan(0)
  }
}

describe('CulledMesher', () => {
  it('meshes a lone full block as 6 quads', () => {
    const map = new VoxelMap()
    map.set(3, 3, 3, FULL)
    const m = meshOf(map)
    expect(vertexCount(m)).toBe(24)
    expect(triangleCount(m)).toBe(12)
    expectConsistentWinding(m)
  })

  it('places a block in world units with half-height voxels', () => {
    const map = new VoxelMap()
    map.set(2, 4, 5, FULL)
    const m = meshOf(map)
    const xs: number[] = []
    const ys: number[] = []
    const zs: number[] = []
    for (let i = 0; i < m.positions.length; i += 3) {
      xs.push(m.positions[i] ?? NaN)
      ys.push(m.positions[i + 1] ?? NaN)
      zs.push(m.positions[i + 2] ?? NaN)
    }
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([2, 3])
    expect([Math.min(...ys), Math.max(...ys)]).toEqual([2, 2.5])
    expect([Math.min(...zs), Math.max(...zs)]).toEqual([5, 6])
  })

  it('hides the shared faces of two touching blocks', () => {
    const map = new VoxelMap()
    map.set(3, 3, 3, FULL)
    map.set(4, 3, 3, FULL)
    expect(triangleCount(meshOf(map))).toBe(10 * 2)
  })

  it('culls against neighbours in another chunk', () => {
    const map = new VoxelMap()
    map.set(15, 0, 0, FULL)
    map.set(16, 0, 0, FULL)
    expect(triangleCount(meshOf(map, 0, 0, 0))).toBe(5 * 2)
    expect(triangleCount(meshOf(map, 1, 0, 0))).toBe(5 * 2)
  })

  it('meshes a lone slope: bottom, high side, 2 triangles, sloped top', () => {
    const map = new VoxelMap()
    map.set(3, 3, 3, slope(Orientation.EAST))
    const m = meshOf(map)
    expect(vertexCount(m)).toBe(4 + 4 + 3 + 3 + 4)
    expect(triangleCount(m)).toBe(2 + 2 + 1 + 1 + 2)
    expectConsistentWinding(m)
  })

  it('has a sloped top rising towards the high side', () => {
    const map = new VoxelMap()
    map.set(0, 0, 0, slope(Orientation.NORTH)) // high side at z = 0
    const m = meshOf(map)
    for (let i = 0; i < m.positions.length; i += 3) {
      const z = m.positions[i + 2] ?? NaN
      const y = m.positions[i + 1] ?? NaN
      if (z === 1) expect(y).toBe(0) // low side stays at the bottom
    }
    expectConsistentWinding(m)
  })

  it('does not cull a full face against a slope side, but culls the slope side', () => {
    const map = new VoxelMap()
    map.set(3, 3, 3, slope(Orientation.NORTH)) // triangular sides on +X / -X
    map.set(4, 3, 3, FULL)
    const m = meshOf(map)
    // Slope: bottom + high side + 1 triangle (other culled) + top = 2+2+1+2 = 7.
    // Block: 6 faces (its -X face touches a PARTIAL side, so it stays) = 12.
    expect(triangleCount(m)).toBe(7 + 12)
    expectConsistentWinding(m)
  })

  it('culls the high side of a slope against a full block', () => {
    const map = new VoxelMap()
    map.set(3, 3, 3, slope(Orientation.EAST))
    map.set(4, 3, 3, FULL)
    // Slope loses its high side (2 triangles); block loses its -X face (2).
    expect(triangleCount(meshOf(map))).toBe(8 - 2 + 12 - 2)
  })

  it('meshes an outer corner wedge: flat and sloped top triangles, 2 triangle sides', () => {
    const map = new VoxelMap()
    map.set(3, 3, 3, packVoxel(Material.GRASS, Shape.CORNERS, 0b0001))
    const m = meshOf(map)
    // Bottom quad (2) + 2 top triangles + 2 side triangles.
    expect(triangleCount(m)).toBe(2 + 2 + 2)
    expectConsistentWinding(m)
  })

  it('meshes an inner corner wedge with consistent winding', () => {
    const map = new VoxelMap()
    map.set(3, 3, 3, packVoxel(Material.GRASS, Shape.CORNERS, 0b1110))
    const m = meshOf(map)
    // Bottom (2) + 2 top triangles + 2 full sides (4) + 2 side triangles.
    expect(triangleCount(m)).toBe(2 + 2 + 4 + 2)
    expectConsistentWinding(m)
  })

  it('returns an empty mesh for an all-hidden interior', () => {
    const map = new VoxelMap()
    for (let x = 0; x < 3; x++)
      for (let y = 0; y < 3; y++) for (let z = 0; z < 3; z++) map.set(x, y, z, FULL)
    // 9 visible squares per side of the 3x3x3 cube.
    expect(triangleCount(meshOf(map))).toBe(6 * 9 * 2)
  })
})
