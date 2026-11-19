import { describe, expect, it } from 'vitest'
import { Material } from '../materials'
import { Orientation, Shape } from '../shapes'
import { columnSurfaces } from '../surface'
import { isAir, materialOf, orientationOf, shapeOf } from '../voxel'
import { REFERENCE_LAYOUT as L, createReferenceMap } from './referenceMap'

const map = createReferenceMap()

/** Surface levels (top of the supporting voxel = y + 1) in a column. */
const surfaceLevels = (x: number, z: number): number[] =>
  columnSurfaces(map, x, z, -2, 40).map((y) => y + 1)

describe('reference map', () => {
  it('is deterministic', () => {
    const other = createReferenceMap()
    const snapshot = (m: typeof map): Map<string, number[]> =>
      new Map([...m.chunks()].map((c) => [c.key, Array.from(c.voxels)]))
    expect(snapshot(other)).toEqual(snapshot(map))
    expect(other.chunkCount).toBe(map.chunkCount)
  })

  it('is battle-map sized: 32 x 32 cells', () => {
    expect(L.size).toEqual({ width: 32, depth: 32 })
  })

  it('has a flat base ground at level 6', () => {
    expect(surfaceLevels(5, 5)).toEqual([L.groundTop])
    expect(surfaceLevels(28, 5)).toEqual([L.groundTop])
  })

  it('has a river trench with water and a low bank path', () => {
    expect(surfaceLevels(16, 5)).toEqual([L.river.waterTop])
    expect(materialOf(map.get(16, L.river.waterTop - 1, 5))).toBe(Material.WATER)
    expect(surfaceLevels(13, 5)).toEqual([L.path.top])
    expect(materialOf(map.get(13, L.path.top - 1, 5))).toBe(Material.PATH)
  })

  it('has exactly two walkable surfaces where the bridge crosses the path', () => {
    for (let x = L.path.x.min; x <= L.path.x.max; x++) {
      for (let z = L.bridge.z.min; z <= L.bridge.z.max; z++) {
        expect(surfaceLevels(x, z)).toEqual([L.path.top, L.bridge.deckLevel + 1])
      }
    }
  })

  it('also stacks the bridge over the river', () => {
    expect(surfaceLevels(16, L.bridge.z.min)).toEqual([L.river.waterTop, L.bridge.deckLevel + 1])
  })

  it('reaches the bridge deck with slope ramps facing the bridge', () => {
    const west = L.bridgeRampWest.x
    for (let x = west.min; x <= west.max; x++) {
      const y = L.groundTop + (x - west.min)
      const voxel = map.get(x, y, L.bridge.z.min)
      expect(shapeOf(voxel)).toBe(Shape.SLOPE)
      expect(orientationOf(voxel)).toBe(Orientation.EAST)
    }
    const east = L.bridgeRampEast.x
    for (let x = east.min; x <= east.max; x++) {
      const y = L.groundTop + (east.max - x)
      const voxel = map.get(x, y, L.bridge.z.min)
      expect(shapeOf(voxel)).toBe(Shape.SLOPE)
      expect(orientationOf(voxel)).toBe(Orientation.WEST)
    }
    // The top of the last step is level with the deck.
    expect(L.groundTop + (west.max - west.min) + 1).toBe(L.bridge.deckLevel + 1)
  })

  it('has a slope ramp climbing to the cliff top', () => {
    const { x, z } = L.cliffRamp
    for (let zz = z.min; zz <= z.max; zz++) {
      const y = L.groundTop + (zz - z.min)
      for (let xx = x.min; xx <= x.max; xx++) {
        const voxel = map.get(xx, y, zz)
        expect(shapeOf(voxel)).toBe(Shape.SLOPE)
        expect(orientationOf(voxel)).toBe(Orientation.SOUTH)
        // Solid support below the slope.
        expect(isAir(map.get(xx, y - 1, zz))).toBe(false)
      }
    }
    const lastStepTop = L.groundTop + (z.max - z.min) + 1
    expect(lastStepTop).toBe(L.cliff.top)
    expect(surfaceLevels(x.min, L.cliff.z.min)).toEqual([L.cliff.top])
  })

  it('has a tunnel through the hill: floor, air, solid ceiling', () => {
    const x = Math.floor((L.hill.x.min + L.hill.x.max) / 2)
    const z = L.tunnel.z.min + 1
    expect(surfaceLevels(x, z)).toEqual([L.tunnel.floorTop, L.hill.top])
    for (let y = L.tunnel.floorTop; y < L.tunnel.ceilingLevel; y++) {
      expect(isAir(map.get(x, y, z))).toBe(true)
    }
    for (let y = L.tunnel.ceilingLevel; y < L.hill.top; y++) {
      expect(isAir(map.get(x, y, z))).toBe(false)
    }
    // Both ends are open to the outside.
    expect(isAir(map.get(L.hill.x.min, L.tunnel.floorTop, z))).toBe(true)
    expect(isAir(map.get(L.hill.x.max, L.tunnel.floorTop, z))).toBe(true)
  })

  it('stays within one layer of chunks vertically', () => {
    for (const chunk of map.chunks()) expect(chunk.cy).toBe(0)
  })
})
