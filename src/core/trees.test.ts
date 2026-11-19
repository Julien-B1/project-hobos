import { describe, expect, it } from 'vitest'
import { Material } from './materials'
import { canopyCenter, canopyTrunk, findTrunks, isTrunkVoxel, treeKind } from './trees'
import { packVoxel } from './voxel'
import { VoxelMap } from './voxelMap'

const WOOD = packVoxel(Material.WOOD)
const LEAVES = packVoxel(Material.LEAVES)

/** A trunk from `base` to `top` at (x, z) with one leaf voxel on top. */
function tree(map: VoxelMap, x: number, z: number, base: number, top: number): void {
  for (let y = base; y <= top; y++) map.set(x, y, z, WOOD)
  map.set(x, top + 1, z, LEAVES)
}

describe('findTrunks', () => {
  it('finds a WOOD column topped by LEAVES and follows it to its base', () => {
    const map = new VoxelMap()
    tree(map, 3, 4, 2, 6)
    const trunks = findTrunks(map, 0, 8, 5, 10, 0, 8)
    expect(trunks).toEqual([{ x: 3, z: 4, baseY: 2, topY: 6, foliage: Material.LEAVES }])
  })

  it('ignores wood without leaves on top (bridges)', () => {
    const map = new VoxelMap()
    for (let x = 0; x < 6; x++) map.set(x, 4, 2, WOOD)
    expect(findTrunks(map, 0, 8, 0, 8, 0, 8)).toEqual([])
  })

  it('only reports trunks whose top is inside the box', () => {
    const map = new VoxelMap()
    tree(map, 1, 1, 0, 3)
    expect(findTrunks(map, 0, 4, 4, 8, 0, 4)).toEqual([])
    expect(findTrunks(map, 0, 4, 0, 3, 0, 4)).toHaveLength(1)
  })
})

describe('canopy helpers', () => {
  const trunks = [
    { x: 0, z: 0, baseY: 0, topY: 5, foliage: Material.LEAVES },
    { x: 6, z: 0, baseY: 0, topY: 5, foliage: Material.LEAVES },
  ]

  it('tells trunk voxels apart', () => {
    expect(isTrunkVoxel(trunks, 0, 3, 0)).toBe(true)
    expect(isTrunkVoxel(trunks, 0, 6, 0)).toBe(false)
    expect(isTrunkVoxel(trunks, 1, 3, 0)).toBe(false)
  })

  it('assigns a leaf to the closest trunk within reach', () => {
    expect(canopyTrunk(trunks, 2, 6, 0)?.x).toBe(0)
    expect(canopyTrunk(trunks, 5, 6, 1)?.x).toBe(6)
    expect(canopyTrunk(trunks, 0, 6, 9)).toBeNull() // too far
    expect(canopyTrunk(trunks, 0, 20, 0)).toBeNull() // far above the trunk
    expect(canopyTrunk(trunks, 0, -4, 0)).toBeNull() // far below the trunk top
  })

  it('centres the canopy above the trunk top', () => {
    expect(canopyCenter({ x: 2, z: 3, baseY: 0, topY: 5, foliage: Material.LEAVES })).toEqual({
      x: 2.5,
      level: 7,
      z: 3.5,
    })
  })

  it('tells the tree kind from the foliage and the trunk height', () => {
    const t = { x: 0, z: 0, baseY: 0, topY: 5 }
    expect(treeKind({ ...t, foliage: Material.LEAVES })).toBe('oak')
    expect(treeKind({ ...t, foliage: Material.NEEDLES })).toBe('pine')
    expect(treeKind({ ...t, foliage: Material.BIRCH_LEAVES })).toBe('birch')
    expect(treeKind({ ...t, topY: 0, foliage: Material.LEAVES })).toBe('bush')
  })

  it('accepts any foliage on top of a trunk', () => {
    const map = new VoxelMap()
    for (let y = 0; y <= 3; y++) map.set(1, y, 1, WOOD)
    map.set(1, 4, 1, packVoxel(Material.NEEDLES))
    expect(findTrunks(map, 0, 2, 0, 8, 0, 2)[0]?.foliage).toBe(Material.NEEDLES)
  })
})
