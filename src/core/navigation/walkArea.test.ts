import { describe, expect, it } from 'vitest'
import { createTestMap } from '../generators/catalog'
import { Material } from '../materials'
import { materialOf, packVoxel } from '../voxel'
import { VoxelMap } from '../voxelMap'
import { CLEARANCE, WalkArea, isStand, standKey } from './walkArea'

const GRASS = packVoxel(Material.GRASS)
const WATER = packVoxel(Material.WATER)

/** Flat grass floor, top at level `top`, over [0, size) x [0, size). */
function floor(size: number, top = 2): VoxelMap {
  const map = new VoxelMap()
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      for (let y = 0; y <= top; y++) map.set(x, y, z, GRASS)
    }
  }
  return map
}

describe('isStand', () => {
  it('accepts open ground and refuses a low ceiling', () => {
    const map = floor(3)
    expect(isStand(map, 1, 2, 1)).toBe(true)
    map.set(1, 2 + CLEARANCE, 1, GRASS)
    expect(isStand(map, 1, 2, 1)).toBe(false)
  })

  it('wades through shallow water but not deep water', () => {
    const map = floor(3)
    map.set(1, 3, 1, WATER)
    map.set(1, 4, 1, WATER)
    expect(isStand(map, 1, 2, 1)).toBe(true)
    map.set(1, 5, 1, WATER)
    expect(isStand(map, 1, 2, 1)).toBe(false)
    expect(isStand(map, 1, 5, 1)).toBe(false) // a water surface is no floor
  })

  it('refuses foliage', () => {
    const map = new VoxelMap()
    map.set(0, 0, 0, packVoxel(Material.LEAVES))
    expect(isStand(map, 0, 0, 0)).toBe(false)
  })
})

describe('WalkArea.findPath', () => {
  it('goes straight on flat ground, diagonals included', () => {
    const area = new WalkArea(floor(6))
    const path = area.findPath({ x: 0, y: 2, z: 0 }, { x: 4, y: 2, z: 4 })
    expect(path?.length).toBe(5)
    expect(path?.at(-1)).toEqual({ x: 4, y: 2, z: 4 })
  })

  it('goes around a wall, never through it or across its corner', () => {
    const map = floor(7)
    for (let z = 0; z < 5; z++) {
      for (let y = 3; y < 8; y++) map.set(3, y, z, GRASS)
    }
    const area = new WalkArea(map)
    const path = area.findPath({ x: 1, y: 2, z: 1 }, { x: 5, y: 2, z: 1 })
    expect(path).not.toBeNull()
    for (const s of path ?? []) expect(s.x === 3 && s.z < 5).toBe(false)
    // Steps between consecutive stands are single moves.
    for (let i = 1; i < (path?.length ?? 0); i++) {
      const a = path?.[i - 1]
      const b = path?.[i]
      expect(Math.abs((a?.x ?? 0) - (b?.x ?? 0))).toBeLessThanOrEqual(1)
      expect(Math.abs((a?.z ?? 0) - (b?.z ?? 0))).toBeLessThanOrEqual(1)
    }
  })

  it('climbs small steps but not a cliff', () => {
    const map = floor(5)
    for (let z = 0; z < 5; z++) for (let y = 3; y < 5; y++) map.set(4, y, z, GRASS)
    const area = new WalkArea(map)
    expect(area.findPath({ x: 0, y: 2, z: 2 }, { x: 4, y: 4, z: 2 })).not.toBeNull()
    for (let z = 0; z < 5; z++) map.set(4, 5, z, GRASS)
    area.invalidate()
    expect(area.findPath({ x: 0, y: 2, z: 2 }, { x: 4, y: 5, z: 2 })).toBeNull()
  })

  it('crosses the river of the bridges map on a bridge', () => {
    const world = createTestMap('bridges')
    const area = new WalkArea(world.map)
    const spawn = area.spawnPoint(world.width / 2, world.depth / 2)
    expect(spawn).not.toBeNull()
    if (!spawn) return
    const region = new Set(area.region(spawn).map(standKey))
    // Both sides of the map are in the region: the crossings join them.
    const sides = [...region].map((k) => Number(k.split(',')[2]))
    expect(Math.min(...sides)).toBeLessThan(5)
    expect(Math.max(...sides)).toBeGreaterThan(world.depth - 6)
  })
})

describe('WalkArea.spawnPoint', () => {
  it('picks grass with walkable ground all around', () => {
    for (const id of ['river', 'reference', 'kitchen-sink'] as const) {
      const world = createTestMap(id)
      const area = new WalkArea(world.map)
      const spawn = area.spawnPoint(world.home.x, world.home.z)
      expect(spawn, id).not.toBeNull()
      if (!spawn) continue
      expect(materialOf(world.map.get(spawn.x, spawn.y, spawn.z)), id).toBe(Material.GRASS)
      expect(area.neighbours(spawn).length, id).toBe(8)
    }
  })

  it('returns null on a map without grass', () => {
    const map = new VoxelMap()
    map.set(0, 0, 0, packVoxel(Material.STONE))
    expect(new WalkArea(map).spawnPoint(0, 0)).toBeNull()
  })
})
