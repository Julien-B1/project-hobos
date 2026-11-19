import { describe, expect, it } from 'vitest'
import { Material, isTerrainMaterial } from '@/core/materials'
import { materialOf, packVoxel, type Voxel } from '@/core/voxel'
import { VoxelMap } from '@/core/voxelMap'
import { Orientation, Shape } from '@/core/shapes'
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

describe('CapMesher', () => {
  it('leaves the terrain to its own section (no cap)', () => {
    expect(mesher.mesh(block(8), 2).indices).toHaveLength(0)
  })

  it('caps built voxels', () => {
    const map = new VoxelMap()
    map.set(0, 0, 0, packVoxel(Material.STONE_BRICK))
    map.set(0, 1, 0, packVoxel(Material.STONE_BRICK))
    expect(area(mesher.mesh(map, 0.75))).toBeCloseTo(1)
  })

  it('follows the slope of a sloped block', () => {
    const map = new VoxelMap()
    map.set(0, 0, 0, packVoxel(Material.STONE_BRICK, Shape.SLOPE, Orientation.EAST))
    // Halfway up the slope: half the cell is solid.
    expect(area(mesher.mesh(map, 0.25))).toBeCloseTo(0.5)
    expect(area(mesher.mesh(map, 0.125))).toBeCloseTo(0.75)
  })
})

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
