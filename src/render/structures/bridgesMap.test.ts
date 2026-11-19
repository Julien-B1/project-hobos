import { describe, expect, it } from 'vitest'
import { chunkKey } from '@/core/coords'
import { createTestMap } from '@/core/generators/catalog'
import { HybridMesher } from '../meshing/hybridMesher'
import { materialColor } from '../materialPalette'
import { MeshBuilder } from '../meshing/meshBuilder'
import { defaultStructureMeshers } from '.'

describe('bridges map through the chunk mesher', () => {
  const world = createTestMap('bridges')
  const mesher = new HybridMesher(materialColor, world.structures)
  const meshers = defaultStructureMeshers()

  it('puts the geometry of all seven crossings into the drawn blocks layers', () => {
    expect(world.structures.size).toBe(7)
    const drawn = new Set<string>()
    for (const chunk of world.map.chunks()) {
      const key = chunkKey(chunk.cx, chunk.cy, chunk.cz)
      const home = world.structures.inChunk(key)
      if (home.length === 0) continue
      const blocks = mesher.mesh(world.map, chunk).blocks
      // The chunk's blocks layer holds at least the geometry of its structures.
      let expected = 0
      for (const s of home) {
        const out = new MeshBuilder()
        meshers.get(s.kind).mesh(s, out)
        expected += out.toMeshData().indices.length
        drawn.add(s.kind)
      }
      expect(blocks.indices.length).toBeGreaterThanOrEqual(expected)
    }
    expect([...drawn].sort()).toEqual(world.structures.all.map((s) => s.kind).sort())
  })

  it('keeps every crossing inside the map footprint', () => {
    for (const s of world.structures.all) {
      const out = new MeshBuilder()
      meshers.get(s.kind).mesh(s, out)
      const p = out.toMeshData().positions
      for (let i = 0; i < p.length; i += 3) {
        expect(p[i]).toBeGreaterThan(-1)
        expect(p[i]).toBeLessThan(world.width + 1)
        expect(p[i + 2]).toBeGreaterThan(-1)
        expect(p[i + 2]).toBeLessThan(world.depth + 1)
      }
    }
  })
})
