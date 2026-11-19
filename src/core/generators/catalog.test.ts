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

  it('validates ids from untrusted input', () => {
    expect(isTestMapId('reference')).toBe(true)
    expect(isTestMapId('flat')).toBe(true)
    expect(isTestMapId('nope')).toBe(false)
  })
})
