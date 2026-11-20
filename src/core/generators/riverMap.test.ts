import { describe, expect, it } from 'vitest'
import { Material, isFoliageMaterial } from '../materials'
import { Shape, voxelTopCorners } from '../shapes'
import { columnSurfaces } from '../surface'
import { isAir, materialOf, shapeOf } from '../voxel'
import type { VoxelMap } from '../voxelMap'
import { DEFAULT_RIVER_SIZE, createRiverMap } from './riverMap'

const SIZE = 64
const river = createRiverMap({ seed: 7, size: SIZE })

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

describe('river map', () => {
  it('is deterministic for a seed and changes with the seed', () => {
    const again = createRiverMap({ seed: 7, size: SIZE })
    const other = createRiverMap({ seed: 8, size: SIZE })
    expect(snapshot(again.map)).toEqual(snapshot(river.map))
    expect(snapshot(other.map)).not.toEqual(snapshot(river.map))
  })

  it('has ground in every column of its footprint', () => {
    for (let z = 0; z < SIZE; z++)
      for (let x = 0; x < SIZE; x++) {
        expect(columnSurfaces(river.map, x, z, 0, 60).length).toBeGreaterThan(0)
      }
  })

  it('has water, only below the water level', () => {
    let water = 0
    forEachVoxel(river.map, 60, (_x, y, _z, v) => {
      if (materialOf(v) !== Material.WATER) return
      water++
      expect(y).toBeLessThan(river.waterLevel)
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
    forEachVoxel(river.map, 60, (x, y, z, v) => {
      const shape = shapeOf(v)
      const material = materialOf(v)
      if (isAir(v) || isFoliageMaterial(material) || material === Material.WOOD) return
      if (shape !== Shape.SLOPE && shape !== Shape.CORNERS) return
      // A structure's deck (a humpbacked bridge) spans the air on purpose.
      if (river.structures.owns(x, y, z)) return
      wedges++
      expect(isAir(river.map.get(x, y - 1, z))).toBe(false) // supported
      voxelTopCorners(v).forEach((h, corner) => {
        if (h === 0) return
        const cells = neighbours[corner] ?? []
        const touchesSolid = cells.some(([dx, dz]) => !isAir(river.map.get(x + dx, y, z + dz)))
        expect(touchesSolid).toBe(true)
      })
    })
    expect(wedges).toBeGreaterThan(100)
  })

  it('limits height steps between orthogonal neighbours (8 levels in cliffs)', () => {
    for (let z = 0; z < SIZE; z++)
      for (let x = 0; x < SIZE - 1; x++) {
        expect(Math.abs(river.heightAt(x + 1, z) - river.heightAt(x, z))).toBeLessThanOrEqual(8)
        expect(Math.abs(river.heightAt(z, x + 1) - river.heightAt(z, x))).toBeLessThanOrEqual(8)
      }
  })

  it('has steep cliffs somewhere on the default map', () => {
    const big = createRiverMap()
    let steepest = 0
    for (let z = 0; z < big.size; z++)
      for (let x = 0; x < big.size - 1; x++) {
        steepest = Math.max(steepest, Math.abs(big.heightAt(x + 1, z) - big.heightAt(x, z)))
      }
    expect(steepest).toBeGreaterThanOrEqual(4)
  })

  it('never floods a terrace into a one-cell water channel', () => {
    for (const seed of [1337, 42, 7]) {
      const big = createRiverMap({ seed })
      // A water column with dry land above the water on both sides of an
      // axis is a one-cell channel, typical of a terrace sunk below the water.
      let channels = 0
      for (let z = 1; z < big.size - 1; z++)
        for (let x = 1; x < big.size - 1; x++) {
          if (big.heightAt(x, z) >= big.waterLevel) continue
          const dryX =
            big.heightAt(x - 1, z) > big.waterLevel + 1 &&
            big.heightAt(x + 1, z) > big.waterLevel + 1
          const dryZ =
            big.heightAt(x, z - 1) > big.waterLevel + 1 &&
            big.heightAt(x, z + 1) > big.waterLevel + 1
          if (dryX || dryZ) channels++
        }
      expect(channels).toBe(0)
    }
  })

  it('grows several kinds of trees with trunks and foliage', () => {
    let wood = 0
    let foliage = 0
    const kinds = new Set<number>()
    forEachVoxel(river.map, 60, (_x, _y, _z, v) => {
      const m = materialOf(v)
      if (m === Material.WOOD) wood++
      if (isFoliageMaterial(m)) {
        foliage++
        kinds.add(m)
      }
    })
    expect(wood).toBeGreaterThan(0)
    expect(foliage).toBeGreaterThan(wood)
    expect(kinds.size).toBeGreaterThanOrEqual(2)
  })

  it('defaults to a battle-map sized encounter with water and trees', () => {
    const encounter = createRiverMap()
    expect(encounter.size).toBe(DEFAULT_RIVER_SIZE)
    expect(DEFAULT_RIVER_SIZE).toBeLessThanOrEqual(40)
    let water = 0
    let leaves = 0
    for (let z = 0; z < encounter.size; z++)
      for (let x = 0; x < encounter.size; x++)
        for (let y = 0; y < 40; y++) {
          const m = materialOf(encounter.map.get(x, y, z))
          if (m === Material.WATER) water++
          if (isFoliageMaterial(m)) leaves++
        }
    expect(water).toBeGreaterThan(0)
    expect(leaves).toBeGreaterThan(0)
  })

  it('reports column heights consistent with the voxels', () => {
    for (const [x, z] of [
      [3, 3],
      [30, 40],
      [60, 10],
    ] as const) {
      const h = river.heightAt(x, z)
      expect(isAir(river.map.get(x, h - 1, z))).toBe(false)
    }
  })
})

describe('createRiverMap crossing', () => {
  it('always crosses the river once, with a walkable crossing', async () => {
    const { columnSurfaces } = await import('../surface')
    const { isBridgeSpan, spanLength, spanVoxel } = await import('../structures/bridges/bridgeSpan')
    const kinds = new Map<string, number>()
    for (let seed = 1; seed <= 24; seed++) {
      const river = createRiverMap({ seed })
      // A river has dry land on both sides of its water on some row; a map
      // flooded wall to wall (a lake) has nothing to cross.
      const { groundLevel } = await import('../structures/bridges/riverCrossing')
      const hasBanks = Array.from({ length: river.size }, (_, z) => z).some((z) => {
        const row = Array.from({ length: river.size }, (_, x) => ({
          wet: materialOf(river.map.get(x, river.waterLevel - 1, z)) === Material.WATER,
          dry: groundLevel(river.map, x, z) >= river.waterLevel,
        }))
        const firstWet = row.findIndex((c) => c.wet)
        const lastWet = row.length - 1 - [...row].reverse().findIndex((c) => c.wet)
        return (
          firstWet > 0 &&
          row.slice(0, firstWet).some((c) => c.dry) &&
          row.slice(lastWet + 1).some((c) => c.dry)
        )
      })
      if (!hasBanks) continue
      expect(river.structures.size, `seed ${seed}`).toBe(1)
      const [crossing] = river.structures.all
      if (!crossing || !isBridgeSpan(crossing.params)) throw new Error('no crossing')
      kinds.set(crossing.kind, (kinds.get(crossing.kind) ?? 0) + 1)
      const span = crossing.params
      for (let along = 0; along < spanLength(span); along++) {
        const v = spanVoxel(span, along, 0, 0)
        const top = Math.max(...columnSurfaces(river.map, v.x, v.z, 0, 60)) + 1
        expect(top, `seed ${seed} ${crossing.kind} at ${along}`).toBeGreaterThanOrEqual(
          river.waterLevel - 1,
        )
      }
    }
    // The seed varies the kind.
    expect(kinds.size).toBeGreaterThan(2)
  })
})
