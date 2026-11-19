import { describe, expect, it } from 'vitest'
import { createFlatGrid } from './flatGrid'

describe('createFlatGrid', () => {
  it('defaults to 32 x 32', () => {
    const grid = createFlatGrid()
    expect(grid.width).toBe(32)
    expect(grid.depth).toBe(32)
  })

  it('contains only cells in [0, width) x [0, depth)', () => {
    const grid = createFlatGrid(4, 3)
    expect(grid.contains({ x: 0, z: 0 })).toBe(true)
    expect(grid.contains({ x: 3, z: 2 })).toBe(true)
    expect(grid.contains({ x: 4, z: 0 })).toBe(false)
    expect(grid.contains({ x: 0, z: 3 })).toBe(false)
    expect(grid.contains({ x: -1, z: 0 })).toBe(false)
  })

  it('alternates shades between neighbours', () => {
    const grid = createFlatGrid()
    expect(grid.shade({ x: 0, z: 0 })).toBe(0)
    expect(grid.shade({ x: 1, z: 0 })).toBe(1)
    expect(grid.shade({ x: 0, z: 1 })).toBe(1)
    expect(grid.shade({ x: 1, z: 1 })).toBe(0)
  })

  it('rejects invalid sizes', () => {
    expect(() => createFlatGrid(0, 4)).toThrow(RangeError)
    expect(() => createFlatGrid(2.5, 4)).toThrow(RangeError)
  })
})
