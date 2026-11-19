import { describe, expect, it } from 'vitest'
import { ATLAS_CELLS, AtlasRow, leafPixels } from './leafTexture'

describe('leafPixels', () => {
  const size = 256
  const cellSize = size / ATLAS_CELLS
  const data = leafPixels(size)
  const alpha = (x: number, y: number): number => data[(x + y * size) * 4 + 3] ?? 0

  /** Share of opaque texels in one atlas cell. */
  const coverage = (cell: number, row: number): number => {
    let opaque = 0
    for (let y = 0; y < cellSize; y++)
      for (let x = 0; x < cellSize; x++) {
        if (alpha(cell * cellSize + x, row * cellSize + y) > 200) opaque++
      }
    return opaque / (cellSize * cellSize)
  }

  it('fills every cell with a partly transparent cluster', () => {
    for (let row = 0; row < ATLAS_CELLS; row++)
      for (let cell = 0; cell < ATLAS_CELLS; cell++) {
        const c = coverage(cell, row)
        expect(c).toBeGreaterThan(0.04)
        expect(c).toBeLessThan(0.8)
      }
    // Leaf clusters are dense.
    expect(coverage(0, AtlasRow.BROADLEAF)).toBeGreaterThan(0.2)
  })

  it('keeps the cell borders transparent (no mipmap bleeding)', () => {
    for (let i = 0; i < size; i++) {
      for (let k = 0; k < ATLAS_CELLS; k++) {
        expect(alpha(i, k * cellSize)).toBe(0)
        expect(alpha(k * cellSize, i)).toBe(0)
      }
    }
  })
})
