import { describe, expect, it } from 'vitest'
import { createRiverMap } from '../../generators/riverMap'
import { isTerrainMaterial, Material } from '../../materials'
import { materialOf, packVoxel } from '../../voxel'
import { VoxelMap } from '../../voxelMap'
import { isBridgeSpan, spanVoxel } from './bridgeSpan'
import { measureCrossing } from './riverCrossing'

/** Top of the terrain (structures ignored) in column (x, z). */
function terrainTop(map: VoxelMap, x: number, z: number): number {
  let top = 0
  for (let y = 0; y < 64; y++) if (isTerrainMaterial(materialOf(map.get(x, y, z)))) top = y + 1
  return top
}

describe('measureCrossing', () => {
  it('raises the deck to meet a high bank, reaching further up the low one', () => {
    // Profile along X: high bank (level 14) | water (bed 6, surface 10) | low
    // shore rising slowly (11, 11, 12, 13, 14).
    const map = new VoxelMap()
    const profile = [14, 14, 14, 6, 6, 6, 6, 11, 11, 12, 13, 14, 14]
    profile.forEach((h, x) => {
      for (let y = 0; y < h; y++) map.set(x, y, 0, packVoxel(Material.GRASS))
      for (let y = h; y < 10; y++) map.set(x, y, 0, packVoxel(Material.WATER))
    })
    const site = measureCrossing(map, 'x', 0, 1, 4, 10, profile.length)
    if (!site) throw new Error('no site')
    const deck = site.span.deckY + 1
    for (const end of [site.span.from, site.span.to]) {
      const g = profile[end] ?? 0
      expect(g).toBeGreaterThanOrEqual(deck)
      expect(g).toBeLessThanOrEqual(deck + 1)
    }
  })

  it('spans a canyon from plateau to plateau', () => {
    // Steep banks climbing from the water (surface 10) to crests at 18 and 20.
    const map = new VoxelMap()
    const profile = [18, 18, 18, 16, 14, 12, 6, 6, 6, 12, 14, 16, 18, 20, 20, 20]
    profile.forEach((h, x) => {
      for (let y = 0; y < h; y++) map.set(x, y, 0, packVoxel(Material.GRASS))
      for (let y = h; y < 10; y++) map.set(x, y, 0, packVoxel(Material.WATER))
    })
    const site = measureCrossing(map, 'x', 0, 1, 7, 10, profile.length)
    if (!site) throw new Error('no site')
    expect(site.span.deckY + 1).toBe(18)
    expect(site.span.from).toBe(3 - 1)
    expect(profile[site.span.to]).toBeGreaterThanOrEqual(18)
    expect(profile[site.span.to]).toBeLessThanOrEqual(19 + 1)
  })

  it('meets both banks on river maps, neither buried nor floating (seed 314295924 and others)', () => {
    for (const seed of [314295924, 1, 4, 15, 22]) {
      const river = createRiverMap({ seed, size: 32 })
      const [crossing] = river.structures.all
      if (!crossing || !isBridgeSpan(crossing.params)) throw new Error(`seed ${seed}: none`)
      const span = crossing.params
      const deck = span.deckY + 1
      // Each end: the ground there is at most a level above the deck (no
      // buried deck), and reaches the deck's level there or right beyond
      // (no floating end).
      for (const [along, outward] of [
        [0, -1],
        [span.to - span.from, 1],
      ] as const) {
        const v = spanVoxel(span, along, 0, 0)
        const w = spanVoxel(span, along + outward, 0, 0)
        const g = terrainTop(river.map, v.x, v.z)
        const beyond = terrainTop(river.map, w.x, w.z)
        expect(g, `seed ${seed} end ${along}`).toBeLessThanOrEqual(deck + 1)
        expect(Math.max(g, beyond), `seed ${seed} end ${along}`).toBeGreaterThanOrEqual(deck)
      }
    }
  })
})
