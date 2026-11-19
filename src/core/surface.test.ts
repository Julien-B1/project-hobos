import { describe, expect, it } from 'vitest'
import { columnSurfaces } from './surface'
import { packVoxel } from './voxel'
import { VoxelMap } from './voxelMap'

describe('columnSurfaces', () => {
  it('finds one surface on a simple stack', () => {
    const map = new VoxelMap()
    for (let y = 0; y < 4; y++) map.set(0, y, 0, packVoxel(1))
    expect(columnSurfaces(map, 0, 0, -5, 20)).toEqual([3])
  })

  it('finds every surface separated by air, bottom to top', () => {
    const map = new VoxelMap()
    map.set(2, 0, -3, packVoxel(1))
    map.set(2, 5, -3, packVoxel(1))
    map.set(2, 6, -3, packVoxel(1))
    expect(columnSurfaces(map, 2, -3, 0, 10)).toEqual([0, 6])
  })

  it('returns nothing for an empty column', () => {
    expect(columnSurfaces(new VoxelMap(), 0, 0, 0, 10)).toEqual([])
  })
})
