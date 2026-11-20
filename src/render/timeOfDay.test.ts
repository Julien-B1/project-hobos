import { describe, expect, it } from 'vitest'
import { LIGHTING, TIMES_OF_DAY, blendPresets, isTimeOfDay, lightDirection } from './timeOfDay'

describe('lightDirection', () => {
  it('follows compass angles: north -Z, east +X, south +Z', () => {
    const north = lightDirection(0, 0)
    expect(north.z).toBeCloseTo(-1)
    const east = lightDirection(90, 0)
    expect(east.x).toBeCloseTo(1)
    const south = lightDirection(180, 0)
    expect(south.z).toBeCloseTo(1)
    expect(lightDirection(123, 90).y).toBeCloseTo(1)
  })

  it('is a unit vector', () => {
    const d = lightDirection(245, 40)
    expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1)
  })
})

describe('lighting presets', () => {
  it('covers every time of day with the light above the horizon', () => {
    for (const time of TIMES_OF_DAY) {
      const preset = LIGHTING[time]
      expect(preset.elevationDeg).toBeGreaterThan(0)
      expect(preset.lightIntensity).toBeGreaterThan(0)
    }
  })

  it('makes nights darker than days', () => {
    expect(LIGHTING.midnight.lightIntensity).toBeLessThan(LIGHTING.noon.lightIntensity / 3)
  })

  it('validates ids from untrusted input', () => {
    expect(isTimeOfDay('dusk')).toBe(true)
    expect(isTimeOfDay('late-night')).toBe(true)
    expect(isTimeOfDay('teatime')).toBe(false)
  })
})

describe('blendPresets', () => {
  it('starts at the first preset and ends at the second', () => {
    expect(blendPresets(LIGHTING.noon, LIGHTING.dusk, 0)).toEqual(LIGHTING.noon)
    const end = blendPresets(LIGHTING.noon, LIGHTING.dusk, 1)
    expect(end.lightColor).toBe(LIGHTING.dusk.lightColor)
    expect(end.background).toBe(LIGHTING.dusk.background)
    expect(end.lightIntensity).toBeCloseTo(LIGHTING.dusk.lightIntensity, 9)
    expect(end.azimuthDeg).toBeCloseTo(LIGHTING.dusk.azimuthDeg, 9)
  })

  it('turns the light the shorter way round', () => {
    const a = { ...LIGHTING.noon, azimuthDeg: 350 }
    const b = { ...LIGHTING.noon, azimuthDeg: 10 }
    expect(blendPresets(a, b, 0.5).azimuthDeg).toBeCloseTo(0, 9)
  })

  it('dims the light half-way through a large turn only', () => {
    const swing = blendPresets(LIGHTING.dusk, LIGHTING.evening, 0.5)
    const straight = (LIGHTING.dusk.lightIntensity + LIGHTING.evening.lightIntensity) / 2
    expect(swing.lightIntensity).toBeLessThan(straight * 0.7)
    const same = blendPresets(LIGHTING.noon, { ...LIGHTING.noon, lightIntensity: 1 }, 0.5)
    expect(same.lightIntensity).toBeCloseTo((LIGHTING.noon.lightIntensity + 1) / 2, 9)
  })
})
