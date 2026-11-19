import { describe, expect, it } from 'vitest'
import { MeshBuilder } from '../meshing/meshBuilder'
import { unmatchedEdges } from '../meshing/watertight'
import { aabb, beam, box, catenary, frameAlong, tube } from './primitives'

const surface = { color: [1, 1, 1] as const, look: 0 }

describe('primitives', () => {
  it('build closed volumes', () => {
    const out = new MeshBuilder()
    aabb(out, [0, 0, 0], [1, 2, 3], surface)
    beam(out, [5, 0, 0], [7, 1, 0.5], 0.2, 0.3, surface)
    box(out, [10, 1, 1], frameAlong([1, 0, 1]), [0.5, 0.25, 0.1], surface)
    tube(out, catenary([0, 5, 0], [6, 5, 0], 1, 8), 0.05, 6, surface)
    tube(
      out,
      [
        [0, 0, 5],
        [0, 2, 5],
      ],
      [0.3, 0.2],
      7,
      surface,
    )
    expect(unmatchedEdges([out.toMeshData()])).toEqual([])
  })

  it('stores the look in weight channel 0', () => {
    const out = new MeshBuilder()
    aabb(out, [0, 0, 0], [1, 1, 1], { color: [1, 1, 1], look: 3 })
    const data = out.toMeshData()
    expect(data.weights?.[0]).toBe(3)
    expect(data.weights?.[8]).toBe(3)
  })

  it('keeps beams level: frame up axis stays vertical for horizontal beams', () => {
    const [ex, ey] = frameAlong([2, 0, 1])
    expect(ey[1]).toBeCloseTo(1)
    expect(ex[1]).toBeCloseTo(0)
  })

  it('sags a rope by the given amount at mid span', () => {
    const points = catenary([0, 4, 0], [4, 4, 0], 0.5, 4)
    expect(points[2]?.[1]).toBeCloseTo(3.5)
    expect(points[0]?.[1]).toBeCloseTo(4)
  })
})
