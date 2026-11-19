import { describe, expect, it } from 'vitest'
import { VOXEL_HEIGHT, levelToWorld, worldToCell, worldToLevel } from './coords'

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
