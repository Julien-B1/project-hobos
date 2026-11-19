import { describe, expect, it } from 'vitest'
import { detailPixels, periodicCells } from './detailTexture'

describe('periodicCells', () => {
  it('wraps around the unit square', () => {
    const a = periodicCells(0.013, 0.42, 9, 5)
    const b = periodicCells(1.013, 1.42, 9, 5)
    expect(b.f1).toBeCloseTo(a.f1, 9)
    expect(b.f2).toBeCloseTo(a.f2, 9)
    expect(b.id).toBe(a.id)
  })

  it('orders the two distances', () => {
    const c = periodicCells(0.3, 0.7, 22, 1)
    expect(c.f1).toBeLessThanOrEqual(c.f2)
    expect(c.f1).toBeGreaterThanOrEqual(0)
  })
})

describe('detailPixels', () => {
  it('fills every channel with a varied pattern', () => {
    const size = 32
    const data = detailPixels(size)
    expect(data).toHaveLength(size * size * 4)
    for (let channel = 0; channel < 4; channel++) {
      const values = new Set<number>()
      for (let i = channel; i < data.length; i += 4) values.add(data[i] ?? 0)
      expect(values.size).toBeGreaterThan(8)
    }
  })
})
