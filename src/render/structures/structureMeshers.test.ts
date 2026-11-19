import { describe, expect, it } from 'vitest'
import { createBridgesWorld } from '@/core/generators/bridgesShowcaseMap'
import { defaultStructureKinds } from '@/core/structures/kinds'
import { MeshBuilder } from '../meshing/meshBuilder'
import { unmatchedEdges } from '../meshing/watertight'
import { defaultStructureMeshers } from '.'

describe('structure meshers', () => {
  const meshers = defaultStructureMeshers()
  const { structures } = createBridgesWorld()

  it('has a mesher for every core kind', () => {
    expect(meshers.ids.sort()).toEqual(defaultStructureKinds().ids.sort())
  })

  for (const structure of structures.all) {
    it(`draws ${structure.kind} as closed volumes, deterministically`, () => {
      const a = new MeshBuilder()
      meshers.get(structure.kind).mesh(structure, a)
      const data = a.toMeshData()
      expect(data.indices.length).toBeGreaterThan(30)
      expect(unmatchedEdges([data]).slice(0, 3)).toEqual([])
      const b = new MeshBuilder()
      meshers.get(structure.kind).mesh(structure, b)
      expect(b.toMeshData().positions).toEqual(data.positions)
    })
  }
})
