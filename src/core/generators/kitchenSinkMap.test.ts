import { describe, expect, it } from 'vitest'
import { Material } from '../materials'
import { Shape } from '../shapes'
import { columnSurfaces } from '../surface'
import { MAX_FACET_RISE } from '../terrainSurface'
import { findTrunks, treeKind } from '../trees'
import { materialOf, shapeOf } from '../voxel'
import { KITCHEN_SINK_LAYOUT as L, createKitchenSinkMap } from './kitchenSinkMap'

const map = createKitchenSinkMap()

/** Surface levels (top of the supporting voxel = y + 1) in a column. */
const surfaceLevels = (x: number, z: number): number[] =>
  columnSurfaces(map, x, z, -2, 40).map((y) => y + 1)

/** Every voxel of the footprint, up to level 40. */
function* voxels(): Generator<number> {
  for (let z = 0; z < L.size.depth; z++)
    for (let x = 0; x < L.size.width; x++) for (let y = 0; y < 40; y++) yield map.get(x, y, z)
}

describe('kitchen-sink map', () => {
  it('is deterministic and battle-map sized', () => {
    const snapshot = (m: typeof map): Map<string, number[]> =>
      new Map([...m.chunks()].map((c) => [c.key, Array.from(c.voxels)]))
    expect(snapshot(createKitchenSinkMap())).toEqual(snapshot(map))
    expect(L.size.width * L.size.depth).toBeLessThanOrEqual(40 * 40)
  })

  it('uses every material', () => {
    const used = new Set<number>()
    for (const v of voxels()) used.add(materialOf(v))
    for (const id of Object.values(Material)) {
      if (id !== Material.AIR) expect(used.has(id)).toBe(true)
    }
  })

  it('uses every shape', () => {
    const shapes = new Set<number>()
    for (const v of voxels()) if (v !== 0) shapes.add(shapeOf(v))
    expect(shapes.has(Shape.FULL)).toBe(true)
    expect(shapes.has(Shape.SLOPE)).toBe(true)
    expect(shapes.has(Shape.CORNERS)).toBe(true)
  })

  it('grows every kind of tree', () => {
    const kinds = new Set(findTrunks(map, 0, L.size.width, 0, 40, 0, L.size.depth).map(treeKind))
    expect([...kinds].sort()).toEqual(['birch', 'bush', 'oak', 'pine'])
  })

  it('stacks two surfaces: cave, arch; the bridge deck is flush with the banks', () => {
    const deck = L.bridge.deckLevel + 1
    expect(deck).toBe(L.groundTop)
    expect(surfaceLevels(34, 25)).toEqual([deck])
    expect(surfaceLevels(32, 24)).toEqual([L.groundTop])
    expect(surfaceLevels(6, 26)).toEqual([L.cave.floorTop, L.hill.top])
    expect(surfaceLevels(25, 14)).toEqual([L.groundTop, L.arch.top])
  })

  it('has deep and shallow water', () => {
    expect(materialOf(map.get(L.pond.cx, 2, L.pond.cz))).toBe(Material.WATER)
    expect(materialOf(map.get(33, 4, 22))).toBe(Material.WATER)
    expect(surfaceLevels(L.pond.cx, L.pond.cz)).toEqual([L.waterTop])
  })

  it('builds with block materials: brick ramp up to the platform, wooden bridge', () => {
    const steps = L.ramp.x.max - L.ramp.x.min + 1
    expect(L.groundTop + steps).toBe(L.platform.top)
    const first = map.get(L.ramp.x.min, L.groundTop, L.ramp.z.min)
    expect(shapeOf(first)).toBe(Shape.SLOPE)
    expect(materialOf(first)).toBe(Material.STONE_BRICK)
    expect(materialOf(map.get(33, L.bridge.deckLevel, 24))).toBe(Material.WOOD)
  })

  it('keeps the hill and the arch low enough to be smoothed into slopes', () => {
    expect(L.hill.top - L.groundTop).toBeLessThanOrEqual(MAX_FACET_RISE)
    expect(L.arch.top - L.groundTop).toBeLessThanOrEqual(MAX_FACET_RISE)
  })
})
