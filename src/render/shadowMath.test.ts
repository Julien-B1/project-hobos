import { describe, expect, it } from 'vitest'
import { shadowHalfExtent, snapToShadowTexels, sunBasis } from './shadowMath'

const SUN = { x: -30, y: 32, z: -14 }

describe('shadowHalfExtent', () => {
  it('covers the view and grows in discrete steps', () => {
    expect(shadowHalfExtent(60)).toBeGreaterThanOrEqual(60 * 0.95)
    // Small zoom changes inside one step keep the same size (same texels).
    expect(shadowHalfExtent(60)).toBe(shadowHalfExtent(60.5))
    // A doubled distance doubles the size.
    expect(shadowHalfExtent(120)).toBeCloseTo(shadowHalfExtent(60) * 2)
  })
})

describe('sunBasis', () => {
  it('is orthonormal', () => {
    const { right, up, toSun } = sunBasis(SUN)
    const dot = (a: typeof up, b: typeof up): number => a.x * b.x + a.y * b.y + a.z * b.z
    for (const v of [right, up, toSun]) expect(dot(v, v)).toBeCloseTo(1)
    expect(dot(right, up)).toBeCloseTo(0)
    expect(dot(right, toSun)).toBeCloseTo(0)
    expect(dot(up, toSun)).toBeCloseTo(0)
    expect(right.y).toBe(0) // horizontal, like a camera with world up +Y
  })

  it('falls back to +X for a sun at the zenith', () => {
    expect(sunBasis({ x: 0, y: 5, z: 0 }).right).toEqual({ x: 1, y: 0, z: 0 })
  })
})

describe('snapToShadowTexels', () => {
  it('moves a point by less than one texel per axis and is idempotent', () => {
    const texel = 0.07
    const p = { x: 12.345, y: 1.5, z: -7.89 }
    const s = snapToShadowTexels(p, SUN, texel)
    expect(Math.hypot(s.x - p.x, s.y - p.y, s.z - p.z)).toBeLessThan(texel)
    const again = snapToShadowTexels(s, SUN, texel)
    expect(again.x).toBeCloseTo(s.x, 9)
    expect(again.y).toBeCloseTo(s.y, 9)
    expect(again.z).toBeCloseTo(s.z, 9)
  })

  it('keeps the same frame for small moves inside a texel', () => {
    const texel = 0.5
    const a = snapToShadowTexels({ x: 3.01, y: 0, z: 2.01 }, SUN, texel)
    const b = snapToShadowTexels({ x: 3.02, y: 0, z: 2.0 }, SUN, texel)
    expect(b.x).toBe(a.x)
    expect(b.y).toBe(a.y)
    expect(b.z).toBe(a.z)
  })
})
