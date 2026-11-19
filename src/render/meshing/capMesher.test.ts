import { describe, expect, it } from 'vitest'
import { Material, isTerrainMaterial } from '@/core/materials'
import { materialOf, packVoxel, type Voxel } from '@/core/voxel'
import { VoxelMap } from '@/core/voxelMap'
import { CapMesher, clipPositive } from './capMesher'
import type { MeshData } from './mesher'

const mesher = new CapMesher(
  (v: Voxel) => isTerrainMaterial(materialOf(v)),
  () => [1, 1, 1],
)

/** Area of a mesh seen from above (sum of triangle areas in x, z). */
function area(m: MeshData): number {
  let sum = 0
  for (let t = 0; t < m.indices.length; t += 3) {
    const [a, b, c] = [0, 1, 2].map((o) => (m.indices[t + o] ?? 0) * 3)
    const p = m.positions
    const ax = p[a ?? 0] ?? 0
    const az = p[(a ?? 0) + 2] ?? 0
    const cross =
      ((p[b ?? 0] ?? 0) - ax) * ((p[(c ?? 0) + 2] ?? 0) - az) -
      ((p[c ?? 0] ?? 0) - ax) * ((p[(b ?? 0) + 2] ?? 0) - az)
    sum += Math.abs(cross) / 2
  }
  return sum
}

/** A 4 x 4 block of rock from level 0 to `top`. */
function block(top: number): VoxelMap {
  const map = new VoxelMap()
  for (let x = 0; x < 4; x++)
    for (let z = 0; z < 4; z++)
      for (let y = 0; y < top; y++) map.set(x, y, z, packVoxel(Material.ROCK))
  return map
}

describe('clipPositive', () => {
  it('keeps the part of a polygon where the function is positive', () => {
    const square = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ] as const
    expect(clipPositive(square, () => -1)).toEqual([])
    expect(clipPositive(square, () => 1)).toHaveLength(4)
    const half = clipPositive(square, (x) => x - 0.25)
    expect(half).toHaveLength(4)
    expect(Math.min(...half.map((p) => p[0]))).toBeCloseTo(0.25)
  })
})

describe('CapMesher', () => {
  it('fills the section of solid ground at the cut height', () => {
    const cap = mesher.mesh(block(8), 2) // cut at level 4 of 8
    expect(area(cap)).toBeCloseTo(16)
    for (let v = 0; v < cap.positions.length / 3; v++) {
      expect(cap.positions[v * 3 + 1]).toBeCloseTo(2)
      expect(cap.normals[v * 3 + 1]).toBeCloseTo(1)
    }
  })

  it('draws nothing when the cut is above everything', () => {
    expect(mesher.mesh(block(8), 10).indices).toHaveLength(0)
  })

  it('leaves cave interiors open and caps the rock around them', () => {
    const map = block(12)
    // A cave: air at levels 2..5 in the 2 x 4 middle strip.
    for (let x = 1; x < 3; x++)
      for (let z = 0; z < 4; z++) for (let y = 2; y < 6; y++) map.set(x, y, z, 0)
    // Cut low in the cave (under the vault): only the two side strips are solid.
    expect(area(mesher.mesh(map, 1.2))).toBeCloseTo(8)
    // Cut through the vault: the roof fills in from the walls, partly.
    const through = area(mesher.mesh(map, 2.4))
    expect(through).toBeGreaterThan(8)
    expect(through).toBeLessThan(16)
    // Cut above the cave: everything is solid again.
    expect(area(mesher.mesh(map, 4.5))).toBeCloseTo(16)
  })

  it('caps built voxels', () => {
    const map = new VoxelMap()
    map.set(0, 0, 0, packVoxel(Material.STONE_BRICK))
    map.set(0, 1, 0, packVoxel(Material.STONE_BRICK))
    expect(area(mesher.mesh(map, 0.75))).toBeCloseTo(1)
  })
})
