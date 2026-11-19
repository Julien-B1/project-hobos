import { describe, expect, it } from 'vitest'
import { Material } from '../materials'
import { Shape, voxelTopCorners } from '../shapes'
import { columnSurfaces } from '../surface'
import { isAir, materialOf, shapeOf } from '../voxel'
import type { VoxelMap } from '../voxelMap'
import { createOrganicMap } from './organicMap'

const SIZE = 64
const organic = createOrganicMap({ seed: 7, size: SIZE })

/** Flat copy of every chunk, for equality checks. */
const snapshot = (map: VoxelMap): Map<string, number[]> =>
  new Map([...map.chunks()].map((c) => [c.key, Array.from(c.voxels)]))

/** Visit every voxel of the map footprint up to `maxY`. */
function forEachVoxel(
  map: VoxelMap,
  maxY: number,
  visit: (x: number, y: number, z: number, v: number) => void,
): void {
  for (let z = 0; z < SIZE; z++)
    for (let x = 0; x < SIZE; x++) for (let y = 0; y <= maxY; y++) visit(x, y, z, map.get(x, y, z))
}

describe('organic map', () => {
  it('is deterministic for a seed and changes with the seed', () => {
    const again = createOrganicMap({ seed: 7, size: SIZE })
    const other = createOrganicMap({ seed: 8, size: SIZE })
    expect(snapshot(again.map)).toEqual(snapshot(organic.map))
    expect(snapshot(other.map)).not.toEqual(snapshot(organic.map))
  })

  it('has ground in every column of its footprint', () => {
    for (let z = 0; z < SIZE; z++)
      for (let x = 0; x < SIZE; x++) {
        expect(columnSurfaces(organic.map, x, z, 0, 60).length).toBeGreaterThan(0)
      }
  })

  it('has water, only below the water level', () => {
    let water = 0
    forEachVoxel(organic.map, 60, (_x, y, _z, v) => {
      if (materialOf(v) !== Material.WATER) return
      water++
      expect(y).toBeLessThan(organic.waterLevel)
    })
    expect(water).toBeGreaterThan(0)
  })

  it('raises every wedge corner against solid ground at the same level', () => {
    const neighbours = [
      [
        [-1, 0],
        [0, -1],
        [-1, -1],
      ],
      [
        [1, 0],
        [0, -1],
        [1, -1],
      ],
      [
        [1, 0],
        [0, 1],
        [1, 1],
      ],
      [
        [-1, 0],
        [0, 1],
        [-1, 1],
      ],
    ] as const
    let wedges = 0
    forEachVoxel(organic.map, 60, (x, y, z, v) => {
      const shape = shapeOf(v)
      const material = materialOf(v)
      if (isAir(v) || material === Material.LEAVES || material === Material.WOOD) return
      if (shape !== Shape.SLOPE && shape !== Shape.CORNERS) return
      wedges++
      expect(isAir(organic.map.get(x, y - 1, z))).toBe(false) // supported
      voxelTopCorners(v).forEach((h, corner) => {
        if (h === 0) return
        const cells = neighbours[corner] ?? []
        const touchesSolid = cells.some(([dx, dz]) => !isAir(organic.map.get(x + dx, y, z + dz)))
        expect(touchesSolid).toBe(true)
      })
    })
    expect(wedges).toBeGreaterThan(100)
  })

  it('never steps more than one level between orthogonal neighbours', () => {
    for (let z = 0; z < SIZE; z++)
      for (let x = 0; x < SIZE - 1; x++) {
        expect(Math.abs(organic.heightAt(x + 1, z) - organic.heightAt(x, z))).toBeLessThanOrEqual(1)
        expect(Math.abs(organic.heightAt(z, x + 1) - organic.heightAt(z, x))).toBeLessThanOrEqual(1)
      }
  })

  it('grows trees with trunks and leaves', () => {
    let wood = 0
    let leaves = 0
    forEachVoxel(organic.map, 60, (_x, _y, _z, v) => {
      if (materialOf(v) === Material.WOOD) wood++
      if (materialOf(v) === Material.LEAVES) leaves++
    })
    expect(wood).toBeGreaterThan(0)
    expect(leaves).toBeGreaterThan(wood)
  })

  it('reports column heights consistent with the voxels', () => {
    for (const [x, z] of [
      [3, 3],
      [30, 40],
      [60, 10],
    ] as const) {
      const h = organic.heightAt(x, z)
      expect(isAir(organic.map.get(x, h - 1, z))).toBe(false)
    }
  })
})
