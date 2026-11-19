import { describe, expect, it } from 'vitest'
import { Chunk } from './chunk'
import { AIR, packVoxel } from './voxel'

describe('Chunk', () => {
  it('starts empty and keyed by its coordinates', () => {
    const chunk = new Chunk(-1, 0, 2)
    expect(chunk.key).toBe('-1,0,2')
    expect(chunk.isEmpty).toBe(true)
    expect(chunk.get(0, 0, 0)).toBe(AIR)
  })

  it('tracks the number of solid voxels', () => {
    const chunk = new Chunk(0, 0, 0)
    const stone = packVoxel(3)
    expect(chunk.set(1, 2, 3, stone)).toBe(AIR)
    expect(chunk.solidCount).toBe(1)
    expect(chunk.set(1, 2, 3, packVoxel(4))).toBe(stone) // solid -> solid
    expect(chunk.solidCount).toBe(1)
    chunk.set(15, 15, 15, stone)
    expect(chunk.solidCount).toBe(2)
    chunk.set(1, 2, 3, AIR)
    chunk.set(15, 15, 15, AIR)
    expect(chunk.isEmpty).toBe(true)
  })
})
