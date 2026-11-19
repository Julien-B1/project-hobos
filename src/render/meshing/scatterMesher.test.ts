import { describe, expect, it } from 'vitest'
import { Material, isTerrainMaterial } from '@/core/materials'
import { materialOf, packVoxel, type Voxel } from '@/core/voxel'
import { VoxelMap } from '@/core/voxelMap'
import type { MeshData } from './mesher'
import { ScatterMesher } from './scatterMesher'

const mesher = new ScatterMesher((v: Voxel) => isTerrainMaterial(materialOf(v)))

/** A flat 16 x 16 field whose top voxel (level 4) is `material`. */
function field(material: number): VoxelMap {
  const map = new VoxelMap()
  for (let x = 0; x < 16; x++)
    for (let z = 0; z < 16; z++) {
      for (let y = 0; y < 3; y++) map.set(x, y, z, packVoxel(Material.DIRT))
      map.set(x, 3, z, packVoxel(material))
    }
  return map
}

const meshOf = (map: VoxelMap): { cards: MeshData; props: MeshData } => {
  const [chunk] = [...map.chunks()]
  if (!chunk) throw new Error('no chunk')
  return mesher.mesh(map, chunk)
}

const cardCount = (m: MeshData): number => m.positions.length / 12

describe('ScatterMesher', () => {
  it('sows upright grass cards on grass, rooted on the ground', () => {
    const { cards, props } = meshOf(field(Material.GRASS))
    expect(cardCount(cards)).toBeGreaterThan(15)
    // Light scatter: far fewer items than cells (256).
    expect(cardCount(cards)).toBeLessThan(80)
    expect(props.positions).toHaveLength(0)
    const w = cards.weights
    if (!w) throw new Error('no card data')
    for (let v = 0; v < cards.positions.length / 3; v++) {
      expect(cards.positions[v * 3 + 1]).toBeCloseTo(2) // level 4 = 2 world units
      expect(w[v * 8 + 7]).toBe(0) // upright mode
    }
  })

  it('puts stones on rocky ground only', () => {
    expect(meshOf(field(Material.ROCK)).props.positions.length).toBeGreaterThan(0)
    for (const ground of [Material.GRASS, Material.DIRT, Material.SAND, Material.PATH]) {
      expect(meshOf(field(ground)).props.positions).toHaveLength(0)
    }
  })

  it('drops fallen leaves only under a tree', () => {
    const flat = (m: MeshData): number => {
      let n = 0
      for (let v = 0; v < m.positions.length / 3; v += 4) if (m.weights?.[v * 8 + 7] === 1) n++
      return n
    }
    expect(flat(meshOf(field(Material.GRASS)).cards)).toBe(0)
    const map = field(Material.GRASS)
    for (let y = 4; y <= 8; y++) map.set(8, y, 8, packVoxel(Material.WOOD))
    map.set(8, 9, 8, packVoxel(Material.LEAVES))
    expect(flat(meshOf(map).cards)).toBeGreaterThan(0)
  })

  it('grows algae under deep water', () => {
    const map = field(Material.SAND)
    for (let x = 0; x < 16; x++)
      for (let z = 0; z < 16; z++)
        for (let y = 4; y < 8; y++) map.set(x, y, z, packVoxel(Material.WATER))
    const { cards } = meshOf(map)
    expect(cardCount(cards)).toBeGreaterThan(5)
  })

  it('is deterministic', () => {
    const a = meshOf(field(Material.GRASS))
    const b = meshOf(field(Material.GRASS))
    expect(b.cards.positions).toEqual(a.cards.positions)
  })

  it('leaves covered cells bare', () => {
    const map = field(Material.GRASS)
    for (let x = 0; x < 16; x++)
      for (let z = 0; z < 16; z++) map.set(x, 4, z, packVoxel(Material.WOOD))
    expect(cardCount(meshOf(map).cards)).toBe(0)
  })

  it('rests boulders against rock faces only', () => {
    const cliff = (material: number): VoxelMap => {
      const map = field(Material.GRASS)
      for (let x = 8; x < 16; x++)
        for (let z = 0; z < 16; z++)
          for (let y = 4; y < 14; y++) map.set(x, y, z, packVoxel(material))
      return map
    }
    const chunkOf = (map: VoxelMap): { cards: MeshData; props: MeshData } => {
      const chunk = [...map.chunks()].find((c) => c.cy === 0)
      if (!chunk) throw new Error('no chunk')
      return mesher.mesh(map, chunk)
    }
    expect(chunkOf(cliff(Material.ROCK)).props.positions.length).toBeGreaterThan(0)
    expect(chunkOf(cliff(Material.DIRT)).props.positions).toHaveLength(0)
  })
})
