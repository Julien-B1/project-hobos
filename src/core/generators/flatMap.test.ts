import { describe, expect, it } from 'vitest'
import { Material } from '../materials'
import { columnSurfaces } from '../surface'
import { AIR, materialOf } from '../voxel'
import { createFlatMap } from './flatMap'

describe('createFlatMap', () => {
  it('fills a one-voxel floor over [0, width) x [0, depth)', () => {
    const map = createFlatMap(32, 32)
    expect(columnSurfaces(map, 0, 0, -5, 5)).toEqual([0])
    expect(columnSurfaces(map, 31, 31, -5, 5)).toEqual([0])
    expect(map.get(32, 0, 0)).toBe(AIR)
    expect(map.get(-1, 0, 0)).toBe(AIR)
    expect(map.chunkCount).toBe(4)
  })

  it('alternates materials like a checkerboard', () => {
    const map = createFlatMap(4, 4)
    expect(materialOf(map.get(0, 0, 0))).toBe(Material.GRASS)
    expect(materialOf(map.get(1, 0, 0))).toBe(Material.DIRT)
    expect(materialOf(map.get(1, 0, 1))).toBe(Material.GRASS)
  })

  it('rejects invalid sizes', () => {
    expect(() => createFlatMap(0, 4)).toThrow(RangeError)
    expect(() => createFlatMap(2.5, 4)).toThrow(RangeError)
  })
})
