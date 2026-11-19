import { describe, expect, it } from 'vitest'
import { createKitchenSinkWorld, KITCHEN_SINK_LAYOUT } from '@/core/generators/kitchenSinkMap'
import { MeshBuilder } from '../meshing/meshBuilder'
import { HybridMesher } from '../meshing/hybridMesher'
import { unmatchedEdges } from '../meshing/watertight'
import { materialColor } from '../materialPalette'
import { bentPositions, woodBeamBridgeMesher } from './woodBeamBridgeMesher'

describe('woodBeamBridgeMesher', () => {
  const world = createKitchenSinkWorld()
  const [bridge] = world.structures.all
  if (!bridge) throw new Error('no bridge')

  it('draws closed volumes, deterministically', () => {
    const a = new MeshBuilder()
    woodBeamBridgeMesher.mesh(bridge, a)
    const b = new MeshBuilder()
    woodBeamBridgeMesher.mesh(bridge, b)
    const data = a.toMeshData()
    expect(data.indices.length).toBeGreaterThan(300)
    expect(unmatchedEdges([data])).toEqual([])
    expect(b.toMeshData().positions).toEqual(data.positions)
  })

  it('spaces the bents within reach of each other and of the banks', () => {
    for (const length of [3, 5, 8, 12]) {
      const supports = [0.5, ...bentPositions(length), length - 0.5]
      for (let i = 1; i < supports.length; i++) {
        expect((supports[i] ?? 0) - (supports[i - 1] ?? 0)).toBeLessThanOrEqual(3.5 + 1e-9)
      }
    }
  })

  it('replaces the deck voxels in the blocks layer', () => {
    const mesher = new HybridMesher(materialColor, world.structures)
    const L = KITCHEN_SINK_LAYOUT
    let found = false
    for (const chunk of world.map.chunks()) {
      const blocks = mesher.mesh(world.map, chunk).blocks
      for (let v = 0; v < blocks.positions.length / 3; v++) {
        const x = blocks.positions[v * 3] ?? 0
        const y = blocks.positions[v * 3 + 1] ?? 0
        const z = blocks.positions[v * 3 + 2] ?? 0
        // No block cube corner at the deck voxel's bottom over the canal.
        if (x === 34 && z === L.bridge.z.min && y === L.bridge.deckLevel * 0.5) found = true
      }
    }
    expect(found).toBe(false)
  })
})
