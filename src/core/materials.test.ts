import { describe, expect, it } from 'vitest'
import { Material, isTerrainMaterial, materialName } from './materials'

describe('materials', () => {
  it('reserves 0 for air', () => {
    expect(Material.AIR).toBe(0)
  })

  it('has unique ids that fit in 8 bits', () => {
    const ids = Object.values(Material)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toBeLessThanOrEqual(255)
  })

  it('names materials for display', () => {
    expect(materialName(Material.STONE)).toBe('stone')
    expect(materialName(250)).toBe('unknown(250)')
  })

  it('separates terrain from built, vegetation and fluid materials', () => {
    expect(isTerrainMaterial(Material.GRASS)).toBe(true)
    expect(isTerrainMaterial(Material.ROCK)).toBe(true)
    expect(isTerrainMaterial(Material.WOOD)).toBe(false)
    expect(isTerrainMaterial(Material.WATER)).toBe(false)
    expect(isTerrainMaterial(Material.LEAVES)).toBe(false)
    expect(isTerrainMaterial(Material.AIR)).toBe(false)
  })
})
