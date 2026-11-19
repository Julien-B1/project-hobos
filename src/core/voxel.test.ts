import { describe, expect, it } from 'vitest'
import { AIR, isAir, materialOf, orientationOf, packVoxel, shapeOf } from './voxel'

describe('voxel encoding', () => {
  it('round-trips every field', () => {
    const v = packVoxel(200, 9, 3)
    expect(materialOf(v)).toBe(200)
    expect(shapeOf(v)).toBe(9)
    expect(orientationOf(v)).toBe(3)
  })

  it('fits in 16 bits at the maximum values', () => {
    expect(packVoxel(255, 15, 15)).toBe(0xffff)
  })

  it('uses material bits 15..8, shape 7..4, orientation 3..0', () => {
    expect(packVoxel(1, 0, 0)).toBe(0x0100)
    expect(packVoxel(0, 1, 0)).toBe(0x0010)
    expect(packVoxel(0, 0, 1)).toBe(0x0001)
  })

  it('treats material 0 as air whatever the other bits', () => {
    expect(isAir(AIR)).toBe(true)
    expect(isAir(packVoxel(0, 1, 2))).toBe(true)
    expect(isAir(packVoxel(1))).toBe(false)
  })

  it('rejects out-of-range fields', () => {
    expect(() => packVoxel(256)).toThrow(RangeError)
    expect(() => packVoxel(1, 16)).toThrow(RangeError)
    expect(() => packVoxel(1, 0, -1)).toThrow(RangeError)
    expect(() => packVoxel(1.5)).toThrow(RangeError)
  })
})
