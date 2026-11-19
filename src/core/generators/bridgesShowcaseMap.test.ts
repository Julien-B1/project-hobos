import { describe, expect, it } from 'vitest'
import { Material } from '../materials'
import { isBridgeSpan, spanLength, spanVoxel } from '../structures/bridges/bridgeSpan'
import { defaultStructureKinds } from '../structures/kinds'
import { columnSurfaces } from '../surface'
import { materialOf } from '../voxel'
import { BRIDGES_LAYOUT, createBridgesWorld } from './bridgesShowcaseMap'

describe('bridges showcase map', () => {
  const L = BRIDGES_LAYOUT
  const { map, structures } = createBridgesWorld()

  it('is a long map with a river along X', () => {
    for (const x of [0, 50, 99]) {
      const water = Array.from({ length: L.size.depth }, (_, z) => z).filter(
        (z) => materialOf(map.get(x, L.waterTop - 1, z)) === Material.WATER,
      )
      expect(water.length).toBeGreaterThanOrEqual(3)
    }
    expect(materialOf(map.get(50, L.groundTop - 1, 0))).not.toBe(Material.WATER)
  })

  it('places every kind of crossing, one per slot', () => {
    expect(structures.all.map((s) => s.kind).sort()).toEqual(
      [...defaultStructureKinds().ids].sort(),
    )
  })

  it('makes every crossing walkable from bank to bank, out of deep water', () => {
    for (const s of structures.all) {
      const span = s.params
      if (!isBridgeSpan(span)) throw new Error('not a span')
      for (let along = 0; along < spanLength(span); along++) {
        const v = spanVoxel(span, along, 0, 0)
        // Some surface no lower than one level under the water surface
        // (the ford's gravel); the bed alone is deeper.
        const levels = columnSurfaces(map, v.x, v.z, 0, 30).map((y) => y + 1)
        expect(Math.max(...levels), `${s.kind} at ${along}`).toBeGreaterThanOrEqual(L.waterTop - 1)
      }
    }
  })
})
