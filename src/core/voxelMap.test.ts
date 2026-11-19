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

describe('VoxelMap dirty tracking', () => {
  it('marks only the owning chunk for an interior voxel', () => {
    const map = new VoxelMap()
    map.set(5, 5, 5, STONE)
    expect(map.drainDirty()).toEqual([chunkKey(0, 0, 0)])
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

  it('marks the face neighbour for a border voxel', () => {
    const map = new VoxelMap()
    map.set(15, 5, 5, STONE)
    expect(map.drainDirty().sort()).toEqual([chunkKey(0, 0, 0), chunkKey(1, 0, 0)].sort())
    map.set(0, 5, 5, STONE)
    expect(map.drainDirty().sort()).toEqual([chunkKey(-1, 0, 0), chunkKey(0, 0, 0)].sort())
  })

  it('marks the three face neighbours for a corner voxel', () => {
    const map = new VoxelMap()
    map.set(-16, -1, 31, STONE) // local (0, 15, 15) in chunk (-1, -1, 1)
    expect(map.drainDirty().sort()).toEqual(
      [chunkKey(-1, -1, 1), chunkKey(-2, -1, 1), chunkKey(-1, 0, 1), chunkKey(-1, -1, 2)].sort(),
    )
  })

  it('keeps a removed chunk dirty so its mesh can be dropped', () => {
    const map = new VoxelMap()
    map.set(5, 5, 5, STONE)
    map.drainDirty()
    map.set(5, 5, 5, AIR)
    expect(map.chunkCount).toBe(0)
    expect(map.drainDirty()).toEqual([chunkKey(0, 0, 0)])
  })
})
