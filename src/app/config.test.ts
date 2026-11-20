import { describe, expect, it } from 'vitest'
import { clampMapSize, readUrlFlags, withMapParams } from './config'

describe('withMapParams', () => {
  it('writes map, seed and size and keeps other parameters', () => {
    const search = withMapParams('?time=dusk&map=flat&grid=off', {
      map: 'river',
      seed: 42,
      size: 24,
      character: 'wizard',
    })
    const params = new URLSearchParams(search)
    expect(params.get('map')).toBe('river')
    expect(params.get('seed')).toBe('42')
    expect(params.get('size')).toBe('24')
    expect(params.get('time')).toBe('dusk')
    expect(params.get('grid')).toBe('off')
    expect(params.get('character')).toBe('wizard')
  })

  it('drops seed and size when undefined', () => {
    const search = withMapParams('?map=river&seed=7&size=40', {
      map: 'flat',
      seed: undefined,
      size: undefined,
      character: 'wizard',
    })
    expect(search).toBe('?map=flat&character=wizard')
  })

  it('round-trips through readUrlFlags', () => {
    const flags = readUrlFlags(
      withMapParams('', { map: 'river', seed: -5, size: 64, character: 'fighter' }),
    )
    expect(flags.map).toBe('river')
    expect(flags.seed).toBe(-5)
    expect(flags.size).toBe(64)
    expect(flags.character).toBe('fighter')
  })

  it('falls back to the default character on unknown ids', () => {
    expect(readUrlFlags('?character=dragon').character).toBe('wizard')
  })
})

describe('readUrlFlags defaults', () => {
  it('launches the river map with a random seed', () => {
    const flags = readUrlFlags('', () => 0.5)
    expect(flags.map).toBe('river')
    expect(flags.seed).toBe(2 ** 30)
    expect(flags.size).toBeUndefined()
  })

  it('falls back to the river map on an unknown id, keeps an explicit seed', () => {
    const flags = readUrlFlags('?map=nope&seed=12', () => 0.5)
    expect(flags.map).toBe('river')
    expect(flags.seed).toBe(12)
  })
})

describe('clampMapSize', () => {
  it('clamps into the allowed range and rounds', () => {
    expect(clampMapSize(2)).toBe(8)
    expect(clampMapSize(500)).toBe(128)
    expect(clampMapSize(23.6)).toBe(24)
  })
})

describe('parseCameraView', () => {
  it('reads a target, then optional distance and yaw', async () => {
    const { parseCameraView } = await import('./config')
    expect(parseCameraView('10,4')).toEqual({ x: 10, z: 4 })
    expect(parseCameraView('10,4,30,45')).toEqual({ x: 10, z: 4, distance: 30, yawDeg: 45 })
    expect(parseCameraView('x,4')).toBeUndefined()
    expect(parseCameraView(null)).toBeUndefined()
  })
})
