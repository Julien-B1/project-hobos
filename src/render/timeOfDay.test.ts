import { describe, expect, it } from 'vitest'
import { LIGHTING, TIMES_OF_DAY, isTimeOfDay, lightDirection } from './timeOfDay'

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
