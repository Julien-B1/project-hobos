import { describe, expect, it } from 'vitest'
import { chunkKey } from './coords'
import { Material } from './materials'
import { AIR, packVoxel } from './voxel'
import { VoxelMap } from './voxelMap'

const STONE = packVoxel(Material.STONE)
const DIRT = packVoxel(Material.DIRT)

describe('VoxelMap read/write', () => {
  it('returns air where nothing was written', () => {
    const map = new VoxelMap()
    expect(map.get(0, 0, 0)).toBe(AIR)
    expect(map.get(-100, 50, 7)).toBe(AIR)
    expect(map.chunkCount).toBe(0)
  })

  it('reads back written voxels across chunk borders on every axis', () => {
    const map = new VoxelMap()
    const coords = [
      [15, 0, 0],
      [16, 0, 0],
      [0, 15, 0],
      [0, 16, 0],
      [0, 0, 15],
      [0, 0, 16],
    ] as const
    coords.forEach(([x, y, z], i) => map.set(x, y, z, packVoxel(i + 1)))
    coords.forEach(([x, y, z], i) => {
      expect(map.get(x, y, z)).toBe(packVoxel(i + 1))
    })
    // 15 and 16 on each axis fall into different chunks.
    expect(map.chunkCount).toBe(4)
  })

  it('handles negative coordinates and the -1/0 and -16/-17 borders', () => {
    const map = new VoxelMap()
    map.set(-1, -1, -1, STONE)
    map.set(0, 0, 0, DIRT)
    map.set(-16, 0, 0, STONE)
    map.set(-17, 0, 0, DIRT)
    expect(map.get(-1, -1, -1)).toBe(STONE)
    expect(map.get(0, 0, 0)).toBe(DIRT)
    expect(map.get(-16, 0, 0)).toBe(STONE)
    expect(map.get(-17, 0, 0)).toBe(DIRT)
    expect(map.getChunk(chunkKey(-1, -1, -1))).toBeDefined()
    expect(map.getChunk(chunkKey(-1, 0, 0))?.solidCount).toBe(1)
    expect(map.getChunk(chunkKey(-2, 0, 0))?.solidCount).toBe(1)
  })

  it('creates chunks lazily and removes them when emptied', () => {
    const map = new VoxelMap()
    expect(map.set(3, 3, 3, AIR)).toBe(false)
    expect(map.chunkCount).toBe(0)

    map.set(3, 3, 3, STONE)
    map.set(4, 3, 3, STONE)
    expect(map.chunkCount).toBe(1)
    map.set(3, 3, 3, AIR)
    expect(map.chunkCount).toBe(1)
    map.set(4, 3, 3, AIR)
    expect(map.chunkCount).toBe(0)
  })

  it('iterates only over non-empty chunks', () => {
    const map = new VoxelMap()
    map.set(0, 0, 0, STONE)
    map.set(40, 0, 0, STONE)
    map.set(-40, 0, 0, STONE)
    map.set(-40, 0, 0, AIR)
    const keys = [...map.chunks()].map((c) => c.key).sort()
    expect(keys).toEqual([chunkKey(0, 0, 0), chunkKey(2, 0, 0)].sort())
  })

  it('reports whether a write changed anything', () => {
    const map = new VoxelMap()
    expect(map.set(1, 1, 1, STONE)).toBe(true)
    expect(map.set(1, 1, 1, STONE)).toBe(false)
    expect(map.set(1, 1, 1, DIRT)).toBe(true)
  })
})

/** Keys of chunk (cx, cy, cz) offset by every combination of dxs x {-1, 0, 1} x dzs. */
function column3(cx: number, cy: number, cz: number, dxs: number[], dzs: number[]): string[] {
  const keys: string[] = []
  for (const dx of dxs)
    for (const dy of [-1, 0, 1])
      for (const dz of dzs) keys.push(chunkKey(cx + dx, cy + dy, cz + dz))
  return keys.sort()
}

describe('VoxelMap dirty tracking', () => {
  it('marks the owning chunk and the chunks above and below for an interior voxel', () => {
    const map = new VoxelMap()
    map.set(5, 5, 5, STONE)
    expect(map.drainDirty().sort()).toEqual(column3(0, 0, 0, [0], [0]))
    expect(map.drainDirty()).toEqual([])
  })

  it('does not mark anything for a no-op write', () => {
    const map = new VoxelMap()
    map.set(5, 5, 5, STONE)
    map.drainDirty()
    map.set(5, 5, 5, STONE)
    map.set(9, 9, 9, AIR)
    expect(map.drainDirty()).toEqual([])
  })

  it('marks the side neighbour for a voxel within the margin of a border', () => {
    const map = new VoxelMap()
    map.set(15, 5, 5, STONE)
    expect(map.drainDirty().sort()).toEqual(column3(0, 0, 0, [0, 1], [0]))
    map.set(1, 5, 5, STONE) // local 1 < DIRTY_MARGIN
    expect(map.drainDirty().sort()).toEqual(column3(0, 0, 0, [-1, 0], [0]))
    map.set(2, 5, 5, STONE) // local 2: interior again
    expect(map.drainDirty().sort()).toEqual(column3(0, 0, 0, [0], [0]))
  })

  it('marks edge and corner neighbours for a voxel near a column corner', () => {
    const map = new VoxelMap()
    map.set(-16, -1, 30, STONE) // local x 0, z 14 in chunk (-1, -1, 1)
    const keys = map.drainDirty().sort()
    expect(keys).toEqual(column3(-1, -1, 1, [-1, 0], [0, 1]))
    expect(keys).toHaveLength(12)
  })

  it('keeps a removed chunk dirty so its mesh can be dropped', () => {
    const map = new VoxelMap()
    map.set(5, 5, 5, STONE)
    map.drainDirty()
    map.set(5, 5, 5, AIR)
    expect(map.chunkCount).toBe(0)
    expect(map.drainDirty()).toContain(chunkKey(0, 0, 0))
  })
})
