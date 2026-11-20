import { describe, expect, it } from 'vitest'
import { TEST_MAP_IDS, createTestMap, isTestMapId } from './catalog'

describe('test map catalog', () => {
  it.each(TEST_MAP_IDS)('builds "%s" with a home inside its footprint', (id) => {
    const t = createTestMap(id)
    expect(t.id).toBe(id)
    expect(t.map.chunkCount).toBeGreaterThan(0)
    expect(t.home.x).toBeGreaterThanOrEqual(0)
    expect(t.home.x).toBeLessThanOrEqual(t.width)
    expect(t.home.z).toBeGreaterThanOrEqual(0)
    expect(t.home.z).toBeLessThanOrEqual(t.depth)
  })

  it('reports the seed of procedural maps only', () => {
    expect(createTestMap('river', { seed: 7 }).seed).toBe(7)
    expect(createTestMap('flat', { seed: 7 }).seed).toBeUndefined()
  })

  it('validates ids from untrusted input', () => {
    expect(isTestMapId('reference')).toBe(false)
    expect(isTestMapId('flat')).toBe(true)
    expect(isTestMapId('river')).toBe(true)
    expect(isTestMapId('nope')).toBe(false)
  })
})
