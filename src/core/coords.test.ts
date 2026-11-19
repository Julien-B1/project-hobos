import { describe, expect, it } from 'vitest'
import {
  CHUNK_SIZE,
  CHUNK_VOLUME,
  VOXEL_HEIGHT,
  chunkKey,
  levelToWorld,
  localIndex,
  parseChunkKey,
  voxelToChunk,
  voxelToLocal,
  worldToCell,
  worldToLevel,
} from './coords'

describe('worldToCell', () => {
  it('floors positive positions', () => {
    expect(worldToCell(0, 0)).toEqual({ x: 0, z: 0 })
    expect(worldToCell(3.99, 7.01)).toEqual({ x: 3, z: 7 })
  })

  it('floors negative positions (not truncation)', () => {
    expect(worldToCell(-0.25, -1)).toEqual({ x: -1, z: -1 })
    expect(worldToCell(-1.5, -16.0001)).toEqual({ x: -2, z: -17 })
  })
})

describe('voxel levels', () => {
  it('uses half-unit voxels', () => {
    expect(VOXEL_HEIGHT).toBe(0.5)
    expect(worldToLevel(0)).toBe(0)
    expect(worldToLevel(0.49)).toBe(0)
    expect(worldToLevel(0.5)).toBe(1)
    expect(worldToLevel(1.0)).toBe(2)
  })

  it('handles negative heights', () => {
    expect(worldToLevel(-0.1)).toBe(-1)
    expect(worldToLevel(-0.5)).toBe(-1)
    expect(worldToLevel(-0.51)).toBe(-2)
  })

  it('round-trips level to world height', () => {
    for (const y of [-3, -1, 0, 1, 7]) {
      expect(worldToLevel(levelToWorld(y))).toBe(y)
    }
  })
})

describe('chunk coordinates', () => {
  it('floors to chunk coordinates, negatives included', () => {
    expect([0, 15, 16, 31, 32].map(voxelToChunk)).toEqual([0, 0, 1, 1, 2])
    expect([-1, -16, -17, -32, -33].map(voxelToChunk)).toEqual([-1, -1, -2, -2, -3])
  })

  it('gives local coordinates in [0, 15], negatives included', () => {
    expect([0, 15, 16, 17].map(voxelToLocal)).toEqual([0, 15, 0, 1])
    expect([-1, -16, -17].map(voxelToLocal)).toEqual([15, 0, 15])
  })

  it('reconstructs the voxel coordinate from chunk and local parts', () => {
    for (let v = -40; v <= 40; v++) {
      expect(voxelToChunk(v) * CHUNK_SIZE + voxelToLocal(v)).toBe(v)
    }
  })

  it('maps every local voxel to a distinct index in [0, CHUNK_VOLUME)', () => {
    const seen = new Set<number>()
    for (let y = 0; y < CHUNK_SIZE; y++)
      for (let z = 0; z < CHUNK_SIZE; z++)
        for (let x = 0; x < CHUNK_SIZE; x++) seen.add(localIndex(x, y, z))
    expect(seen.size).toBe(CHUNK_VOLUME)
    expect(Math.min(...seen)).toBe(0)
    expect(Math.max(...seen)).toBe(CHUNK_VOLUME - 1)
  })

  it('round-trips chunk keys', () => {
    expect(parseChunkKey(chunkKey(-1, 0, 7))).toEqual({ cx: -1, cy: 0, cz: 7 })
    expect(() => parseChunkKey('1,2')).toThrow()
    expect(() => parseChunkKey('a,b,c')).toThrow()
  })
})
