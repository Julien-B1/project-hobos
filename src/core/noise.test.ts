import { describe, expect, it } from 'vitest'
import { fbm2, hash01, hash2, smoothstep, valueNoise2 } from './noise'

describe('hash', () => {
  it('is deterministic and seed-dependent', () => {
    expect(hash2(3, -7, 42)).toBe(hash2(3, -7, 42))
    expect(hash2(3, -7, 42)).not.toBe(hash2(3, -7, 43))
    expect(hash2(3, -7, 42)).not.toBe(hash2(-7, 3, 42))
  })

  it('spreads values over [0, 1)', () => {
    let min = 1
    let max = 0
    let sum = 0
    const n = 10000
    for (let i = 0; i < n; i++) {
      const v = hash01(i % 100, Math.floor(i / 100), 1)
      min = Math.min(min, v)
      max = Math.max(max, v)
      sum += v
    }
    expect(min).toBeGreaterThanOrEqual(0)
    expect(max).toBeLessThan(1)
    expect(sum / n).toBeGreaterThan(0.45)
    expect(sum / n).toBeLessThan(0.55)
  })
})

describe('valueNoise2', () => {
  it('matches the lattice hash at integer points', () => {
    expect(valueNoise2(4, 9, 7)).toBeCloseTo(hash01(4, 9, 7))
  })

  it('is continuous', () => {
    const a = valueNoise2(2.9999, 5.5, 7)
    const b = valueNoise2(3.0001, 5.5, 7)
    expect(Math.abs(a - b)).toBeLessThan(1e-3)
  })

  it('stays in [0, 1]', () => {
    for (let i = 0; i < 500; i++) {
      const v = valueNoise2(i * 0.37, i * 0.73 - 50, 3)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })
})

describe('fbm2', () => {
  it('stays in [0, 1] and is deterministic', () => {
    for (let i = 0; i < 300; i++) {
      const v = fbm2(i * 0.13, -i * 0.29, 11)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
      expect(fbm2(i * 0.13, -i * 0.29, 11)).toBe(v)
    }
  })
})

describe('smoothstep', () => {
  it('clamps and eases', () => {
    expect(smoothstep(0, 1, -1)).toBe(0)
    expect(smoothstep(0, 1, 2)).toBe(1)
    expect(smoothstep(0, 1, 0.5)).toBe(0.5)
  })
})

describe('valueNoise3', () => {
  it('stays in [0, 1], is deterministic and continuous', async () => {
    const { valueNoise3 } = await import('./noise')
    for (let i = 0; i < 50; i++) {
      const v = valueNoise3(i * 0.37, i * 0.61, i * 0.19, 7)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
      expect(valueNoise3(i * 0.37, i * 0.61, i * 0.19, 7)).toBe(v)
      const near = valueNoise3(i * 0.37 + 1e-4, i * 0.61, i * 0.19 + 1e-4, 7)
      expect(Math.abs(near - v)).toBeLessThan(1e-2)
    }
    // Varies along every axis.
    expect(valueNoise3(0.5, 0.5, 0.5, 1)).not.toBe(valueNoise3(0.5, 1.5, 0.5, 1))
  })
})
