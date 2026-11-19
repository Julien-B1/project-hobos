import { describe, expect, it } from 'vitest'
import { clampMapSize, readUrlFlags, withMapParams } from './config'

describe('withMapParams', () => {
  it('writes map, seed and size and keeps other parameters', () => {
    const search = withMapParams('?time=dusk&map=flat&grid=off', {
      map: 'organic',
      seed: 42,
      size: 24,
    })
    const params = new URLSearchParams(search)
    expect(params.get('map')).toBe('organic')
    expect(params.get('seed')).toBe('42')
    expect(params.get('size')).toBe('24')
    expect(params.get('time')).toBe('dusk')
    expect(params.get('grid')).toBe('off')
  })

  it('drops seed and size when undefined', () => {
    const search = withMapParams('?map=organic&seed=7&size=40', {
      map: 'reference',
      seed: undefined,
      size: undefined,
    })
    expect(search).toBe('?map=reference')
  })

  it('round-trips through readUrlFlags', () => {
    const flags = readUrlFlags(withMapParams('', { map: 'organic', seed: -5, size: 64 }))
    expect(flags.map).toBe('organic')
    expect(flags.seed).toBe(-5)
    expect(flags.size).toBe(64)
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
