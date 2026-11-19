import { describe, expect, it } from 'vitest'
import { Material } from '@/core/materials'
import { packVoxel } from '@/core/voxel'
import { VoxelMap } from '@/core/voxelMap'
import { HybridMesher } from './hybridMesher'
import { EMPTY_MESH, mergeMeshData, type MeshData } from './mesher'
import { TreeMesher } from './treeMesher'

const WOOD = packVoxel(Material.WOOD)
const LEAVES = packVoxel(Material.LEAVES)
const GRASS = packVoxel(Material.GRASS)
const white = (): readonly [number, number, number] => [1, 1, 1]

/** Ground, a 4-voxel trunk at (5, 5) and a 3 x 3 x 2 canopy on top. */
function treeMap(): VoxelMap {
  const map = new VoxelMap()
  for (let x = 0; x < 12; x++) for (let z = 0; z < 12; z++) map.set(x, 0, z, GRASS)
  for (let y = 1; y <= 4; y++) map.set(5, y, 5, WOOD)
  for (let y = 5; y <= 6; y++)
    for (let x = 4; x <= 6; x++) for (let z = 4; z <= 6; z++) map.set(x, y, z, LEAVES)
  return map
}

const vertexCount = (m: MeshData): number => m.positions.length / 3

describe('TreeMesher', () => {
  it('draws the trunk as a round tube and every leaf voxel as one card', () => {
    const map = treeMap()
    const [chunk] = [...map.chunks()]
    if (!chunk) throw new Error('no chunk')
    const trees = new TreeMesher(white).mesh(map, chunk)
    expect(trees.trunks).toEqual([{ x: 5, z: 5, baseY: 1, topY: 4, foliage: Material.LEAVES }])
    // 4 trunk segments of 7 quads, plus 3 branches of 5 quads.
    expect(vertexCount(trees.bark)).toBe((4 * 7 + 3 * 5) * 4)
    // 17 of the 18 leaves are exposed: the one right above the trunk is
    // enclosed by leaves and the trunk.
    expect(vertexCount(trees.foliage)).toBe(17 * 4)
    const w = trees.foliage.weights
    if (!w) throw new Error('no texture coordinates')
    for (let v = 0; v < vertexCount(trees.foliage); v++) {
      expect(w[v * 8]).toBeGreaterThanOrEqual(0)
      expect(w[v * 8 + 1]).toBeLessThanOrEqual(1)
    }
  })

  it('stores camera-facing cards: 4 vertices at the centre, unit-square corners', () => {
    const map = treeMap()
    const [chunk] = [...map.chunks()]
    if (!chunk) throw new Error('no chunk')
    const { foliage } = new TreeMesher(white).mesh(map, chunk)
    const w = foliage.weights
    if (!w) throw new Error('no card data')
    for (let card = 0; card < vertexCount(foliage) / 4; card++) {
      const v0 = card * 4
      for (let i = 1; i < 4; i++) {
        for (let c = 0; c < 3; c++) {
          expect(foliage.positions[(v0 + i) * 3 + c]).toBe(foliage.positions[v0 * 3 + c])
        }
        // Corner offsets: rotated (+-1, +-1), so at distance sqrt(2).
        const ox = w[(v0 + i) * 8 + 2] ?? 0
        const oy = w[(v0 + i) * 8 + 3] ?? 0
        expect(Math.hypot(ox, oy)).toBeCloseTo(Math.SQRT2)
      }
      expect(w[v0 * 8 + 4]).toBeGreaterThan(0) // half size
      // Canopy centre: trunk column centre, 2 levels above the top voxel
      // (voxel 4 -> level 6, 3 world units).
      expect(w[v0 * 8 + 5]).toBeCloseTo(5.5)
      expect(w[v0 * 8 + 6]).toBeCloseTo(3)
    }
  })

  it('styles trees by kind: pines without branches, needle cards', () => {
    const map = new VoxelMap()
    for (let y = 1; y <= 4; y++) map.set(5, y, 5, WOOD)
    map.set(5, 5, 5, packVoxel(Material.NEEDLES))
    const [chunk] = [...map.chunks()]
    if (!chunk) throw new Error('no chunk')
    const trees = new TreeMesher(white).mesh(map, chunk)
    expect(vertexCount(trees.bark)).toBe(4 * 7 * 4) // trunk only
    const w = trees.foliage.weights
    if (!w) throw new Error('no card data')
    // Needle row of the atlas: v from 0.25 to 0.5.
    expect(w[1]).toBeCloseTo(0.25)
  })

  it('skips chunks without wood or leaves', () => {
    const map = new VoxelMap()
    map.set(0, 0, 0, GRASS)
    const [chunk] = [...map.chunks()]
    if (!chunk) throw new Error('no chunk')
    const trees = new TreeMesher(white).mesh(map, chunk)
    expect(trees.bark).toBe(EMPTY_MESH)
    expect(trees.foliage).toBe(EMPTY_MESH)
  })
})

describe('HybridMesher with trees', () => {
  it('draws no leaf or trunk blocks, but keeps other wood as blocks', () => {
    const map = treeMap()
    // A plank bridge: wood without leaves on top.
    map.set(9, 3, 9, WOOD)
    const [chunk] = [...map.chunks()]
    if (!chunk) throw new Error('no chunk')
    const layers = new HybridMesher(white).mesh(map, chunk)
    const blockOnly = new TreeMesher(white).mesh(map, chunk)
    // Blocks = trunk tube + the 6 faces of the plank.
    expect(vertexCount(layers.blocks)).toBe(vertexCount(blockOnly.bark) + 6 * 4)
    expect(vertexCount(layers.foliage)).toBe(17 * 4)
  })
})

describe('mergeMeshData', () => {
  it('concatenates buffers and offsets the second mesh indices', () => {
    const tri = (z: number): MeshData => ({
      positions: new Float32Array([0, 0, z, 1, 0, z, 0, 1, z]),
      normals: new Float32Array(9),
      colors: new Float32Array(9),
      indices: new Uint32Array([0, 1, 2]),
    })
    const a = { ...tri(0), weights: new Float32Array(24).fill(1) }
    const m = mergeMeshData(a, tri(1))
    expect([...m.indices]).toEqual([0, 1, 2, 3, 4, 5])
    expect(m.positions).toHaveLength(18)
    expect(m.weights).toHaveLength(48)
    expect(m.weights?.[24]).toBe(0) // padded weights of the second mesh
    expect(mergeMeshData(EMPTY_MESH, a)).toBe(a)
  })
})
