import { describe, expect, it } from 'vitest'
import { chunkKey } from '@/core/coords'
import { Material } from '@/core/materials'
import { resolveHit, type SurfaceHit } from '@/core/surface'
import { AIR, isAir, materialOf, packVoxel } from '@/core/voxel'
import { VoxelMap } from '@/core/voxelMap'
import { createDebugEdits } from './debugEdits'

const UP = { x: 0, y: 1, z: 0 }

function setup(): { map: VoxelMap; hit: SurfaceHit } {
  const map = new VoxelMap()
  for (let y = 0; y < 3; y++) map.set(5, y, 5, packVoxel(Material.DIRT))
  const hit = resolveHit(map, { x: 5.5, y: 1.5, z: 5.5 }, UP)
  if (!hit) throw new Error('no hit')
  map.drainDirty()
  return { map, hit }
}

describe('debug edits', () => {
  it('removes the touched voxel and dirties only its chunk column', () => {
    const { map, hit } = setup()
    createDebugEdits(map, () => hit).remove()
    expect(map.get(5, 2, 5)).toBe(AIR)
    expect(map.drainDirty().sort()).toEqual(
      [chunkKey(0, -1, 0), chunkKey(0, 0, 0), chunkKey(0, 1, 0)].sort(),
    )
  })

  it('places a stone voxel on top of the surface', () => {
    const { map, hit } = setup()
    createDebugEdits(map, () => hit).place()
    expect(materialOf(map.get(5, 3, 5))).toBe(Material.STONE)
  })

  it('does nothing without a hit', () => {
    const { map } = setup()
    const edits = createDebugEdits(map, () => null)
    edits.remove()
    edits.place()
    expect(map.drainDirty()).toEqual([])
    expect(isAir(map.get(5, 3, 5))).toBe(true)
  })
})
