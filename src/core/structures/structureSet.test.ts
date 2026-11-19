import { describe, expect, it } from 'vitest'
import { chunkKey } from '../coords'
import { Material } from '../materials'
import { materialOf } from '../voxel'
import { VoxelMap } from '../voxelMap'
import { WOOD_BEAM_BRIDGE } from './bridges/woodBeamBridge'
import type { BridgeSpan } from './bridges/bridgeSpan'
import { defaultStructureKinds } from './kinds'
import { StructureRegistry } from './registry'
import { StructureSet } from './structureSet'
import { defineKind, type Structure } from './structure'

const span: BridgeSpan = {
  axis: 'x',
  from: 2,
  to: 8,
  side: 4,
  width: 2,
  deckY: 6,
  bedLevel: 2,
  waterLevel: 5,
}

describe('StructureSet', () => {
  it('stamps a structure, indexes its owned voxels and its home chunk', () => {
    const map = new VoxelMap()
    const set = new StructureSet()
    const bridge: Structure = { id: 'b1', kind: WOOD_BEAM_BRIDGE, params: span }
    set.place(bridge, map, defaultStructureKinds())
    expect(set.size).toBe(1)
    for (let x = 2; x <= 8; x++)
      for (let z = 4; z <= 5; z++) {
        expect(materialOf(map.get(x, 6, z))).toBe(Material.WOOD)
        expect(set.owns(x, 6, z)).toBe(true)
      }
    expect(set.owns(1, 6, 4)).toBe(false)
    expect(set.ownerOf(3, 6, 5)?.id).toBe('b1')
    expect(set.inChunk(chunkKey(0, 0, 0))).toEqual([bridge])
  })

  it('rejects duplicate ids, unknown kinds and invalid parameters', () => {
    const map = new VoxelMap()
    const set = new StructureSet()
    const kinds = defaultStructureKinds()
    set.place({ id: 'a', kind: WOOD_BEAM_BRIDGE, params: span }, map, kinds)
    expect(() => {
      set.place({ id: 'a', kind: WOOD_BEAM_BRIDGE, params: span }, map, kinds)
    }).toThrow()
    expect(() => {
      set.place({ id: 'b', kind: 'nope', params: span }, map, kinds)
    }).toThrow()
    expect(() => {
      set.place({ id: 'c', kind: WOOD_BEAM_BRIDGE, params: { axis: 'y' } }, map, kinds)
    }).toThrow()
  })
})

describe('StructureRegistry', () => {
  it('registers kinds by id', () => {
    const kind = defineKind<{ n: number }>({
      id: 'test',
      isParams: (v): v is { n: number } => typeof v === 'object' && v !== null && 'n' in v,
      bounds: () => ({ min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } }),
      stamp: () => [],
    })
    const registry = new StructureRegistry([kind])
    expect(registry.has('test')).toBe(true)
    expect(registry.get('test')).toBe(kind)
    expect(() => registry.register(kind)).toThrow()
    expect(() => registry.get('missing')).toThrow()
  })
})

describe('structure walking surfaces', () => {
  it('gives the sagging height of a rope bridge deck, lowest at mid span', async () => {
    const { ROPE_BRIDGE, ropeDeckHeight } = await import('./bridges/ropeBridge')
    const kinds = defaultStructureKinds()
    const rope: Structure = {
      id: 'r',
      kind: ROPE_BRIDGE,
      params: { ...span, deckY: 12, from: 0, to: 11 },
    }
    const kind = kinds.get(ROPE_BRIDGE)
    const mid = kind.surfaceAt?.(rope, 6, 4.5)
    const end = kind.surfaceAt?.(rope, 0, 4.5)
    expect(mid).toBeDefined()
    expect(mid).toBeCloseTo(ropeDeckHeight(rope.params as BridgeSpan, 6))
    expect(mid ?? 0).toBeLessThan(end ?? 0)
  })
})
