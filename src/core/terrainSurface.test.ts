import { describe, expect, it } from 'vitest'
import { Material, isTerrainMaterial } from './materials'
import { Shape } from './shapes'
import {
  TERRAIN_CHANNELS,
  TerrainField,
  oneHotWeights,
  terrainChannel,
  connects,
  facetCornerNormal,
  facetDiagonal,
  facetHeightAt,
  type TerrainRun,
} from './terrainSurface'
import { materialOf, packVoxel, type Voxel } from './voxel'
import { VoxelMap } from './voxelMap'

const GRASS = packVoxel(Material.GRASS)
const isTerrain = (v: Voxel): boolean => isTerrainMaterial(materialOf(v))

/** Fill column (x, z) with grass from level `from` up to (not including) `to`. */
function column(map: VoxelMap, x: number, z: number, from: number, to: number): void {
  for (let y = from; y < to; y++) map.set(x, y, z, GRASS)
}

const field = (map: VoxelMap): TerrainField => new TerrainField(map, isTerrain, -4, 40)

describe('TerrainField runs', () => {
  it('splits a column into runs and counts wedge tops partially', () => {
    const map = new VoxelMap()
    column(map, 0, 0, 0, 6)
    column(map, 0, 0, 10, 14)
    map.set(0, 14, 0, packVoxel(Material.GRASS, Shape.SLOPE, 0))
    const runs = field(map).runsAt(0, 0)
    expect(runs).toHaveLength(2)
    expect(runs[0]?.top).toBe(6)
    expect(runs[1]?.bottom).toBe(10)
    expect(runs[1]?.top).toBe(14.5)
  })
})

describe('corner heights', () => {
  it('keeps flat ground flat', () => {
    const map = new VoxelMap()
    for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) column(map, x, z, 0, 6)
    const f = field(map)
    const run = f.runsAt(1, 1)[0]
    if (!run) throw new Error('no run')
    expect(f.cornerHeights(1, 1, run)).toEqual([6, 6, 6, 6])
  })

  it('averages a step so both sides meet on the shared corners', () => {
    const map = new VoxelMap()
    for (let z = 0; z < 3; z++) {
      column(map, 0, z, 0, 6) // low cell
      column(map, 1, z, 0, 8) // high cell
    }
    const f = field(map)
    const low = f.runsAt(0, 1)[0]
    const high = f.runsAt(1, 1)[0]
    if (!low || !high) throw new Error('no run')
    const lc = f.cornerHeights(0, 1, low)
    const hc = f.cornerHeights(1, 1, high)
    // Shared edge x = 1: low's c10/c11 equal high's c00/c01.
    expect(lc[1]).toBeCloseTo(7)
    expect(lc[2]).toBeCloseTo(7)
    expect(hc[0]).toBeCloseTo(7)
    expect(hc[3]).toBeCloseTo(7)
  })

  it('never joins a tunnel floor with the roof above it', () => {
    const map = new VoxelMap()
    for (let z = 0; z < 3; z++) {
      column(map, 0, z, 0, 14) // solid hill
      column(map, 1, z, 0, 6) // tunnel: floor ...
      column(map, 1, z, 10, 14) // ... and roof
    }
    const f = field(map)
    const [floor] = f.runsAt(1, 1)
    if (!floor) throw new Error('no run')
    const c = f.cornerHeights(1, 1, floor)
    expect(c[0]).toBeCloseTo(6)
    expect(c[3]).toBeCloseTo(6)
  })

  it('keeps a cave mouth open: the ground in front stays level with the floor', () => {
    const map = new VoxelMap()
    // Open ground (x 0..1) in front of a hill (x 2..4) with a tunnel at z = 1.
    for (let z = 0; z < 3; z++) {
      for (let x = 0; x < 2; x++) column(map, x, z, 0, 6)
      for (let x = 2; x < 5; x++) {
        column(map, x, z, 0, 6)
        if (z === 1) column(map, x, z, 10, 13)
        else column(map, x, z, 6, 13)
      }
    }
    const f = field(map)
    const [floor] = f.runsAt(2, 1)
    const ground = f.runsAt(1, 1)[0]
    if (!floor || !ground) throw new Error('no run')
    // Mouth edge x = 2: floor and ground corners all at level 6.
    expect(f.cornerHeights(2, 1, floor)).toEqual([6, 6, 6, 6])
    expect(f.cornerHeights(1, 1, ground)[1]).toBe(6)
    expect(f.cornerHeights(1, 1, ground)[2]).toBe(6)
    // Away from the mouth the ground still climbs towards the hill.
    const side = f.runsAt(1, 0)[0]
    if (!side) throw new Error('no run')
    expect(f.cornerHeights(1, 0, side)[1]).toBeGreaterThan(6)
  })

  it('joins ground with an open cliff top (steep facet)', () => {
    const map = new VoxelMap()
    for (let z = 0; z < 3; z++) {
      column(map, 0, z, 0, 6)
      column(map, 1, z, 0, 14)
    }
    const f = field(map)
    const ground = f.runsAt(0, 1)[0]
    if (!ground) throw new Error('no run')
    expect(f.cornerHeights(0, 1, ground)[1]).toBeCloseTo(10)
  })
})

describe('corner material weights', () => {
  it('blends the top materials of connected runs around each corner', () => {
    const map = new VoxelMap()
    const sand = packVoxel(Material.SAND)
    for (let z = 0; z < 3; z++) {
      column(map, 0, z, 0, 6)
      for (let y = 0; y < 6; y++) map.set(1, y, z, sand)
    }
    const f = field(map)
    const grassRun = f.runsAt(0, 1)[0]
    const sandRun = f.runsAt(1, 1)[0]
    if (!grassRun || !sandRun) throw new Error('no run')
    const g = TERRAIN_CHANNELS.indexOf(Material.GRASS)
    const s = TERRAIN_CHANNELS.indexOf(Material.SAND)
    const wGrass = f.cornerWeights(0, 1, grassRun)
    const wSand = f.cornerWeights(1, 1, sandRun)
    // Far corners stay pure, shared corners are half and half for both cells.
    expect(wGrass[0]?.[g]).toBeCloseTo(1)
    expect(wGrass[1]?.[g]).toBeCloseTo(0.5)
    expect(wGrass[1]?.[s]).toBeCloseTo(0.5)
    expect(wSand[0]).toEqual(wGrass[1])
    expect(wSand[1]?.[s]).toBeCloseTo(1)
  })

  it('maps unknown materials to the dirt channel', () => {
    expect(terrainChannel(Material.WOOD)).toBe(TERRAIN_CHANNELS.indexOf(Material.DIRT))
    expect(oneHotWeights(Material.ROCK).reduce((a, b) => a + b, 0)).toBe(1)
  })
})

describe('connects', () => {
  const run = (bottom: number, top: number): TerrainRun => ({
    bottom,
    top,
    topY: Math.ceil(top) - 1,
    material: Material.GRASS,
  })

  it('connects equal tops and open steps', () => {
    const a = run(-Infinity, 6)
    const b = run(-Infinity, 8)
    expect(connects(a, [a], b, [b])).toBe(true)
  })

  it('rejects a higher run that floats above the lower top', () => {
    const a = run(-Infinity, 6)
    const b = run(9, 12)
    expect(connects(a, [a], b, [b])).toBe(false)
  })
})

describe('facet triangulation', () => {
  it('splits along the diagonal with the smallest height difference', () => {
    expect(facetDiagonal([6, 6, 6, 6])).toBe(0)
    expect(facetDiagonal([8, 6, 6, 6])).toBe(1) // c00 odd: split c10-c01
    expect(facetDiagonal([6, 8, 6, 6])).toBe(0)
  })

  it('interpolates within the triangles', () => {
    const h = [8, 6, 6, 6] as const
    expect(facetHeightAt(h, 0, 0)).toBeCloseTo(8)
    expect(facetHeightAt(h, 1, 1)).toBeCloseTo(6)
    expect(facetHeightAt(h, 0.25, 0.25)).toBeCloseTo(7)
  })
})

describe('smooth corner normals', () => {
  it('points straight up on flat facets', () => {
    for (const corner of [0, 1, 2, 3] as const) {
      expect(facetCornerNormal([6, 6, 6, 6], corner)).toEqual([0, 1, 0])
    }
  })

  it('follows the height gradient of a tilted facet, with a unit vertical component', () => {
    // Rises 2 levels (1 world unit) from x = 0 to x = 1.
    const n = facetCornerNormal([0, 2, 2, 0], 1)
    expect(n[0]).toBeCloseTo(-1)
    expect(n[1]).toBeCloseTo(1)
    expect(n[2]).toBeCloseTo(0)
  })

  it('averages the facets around a corner, so neighbouring cells share the normal', () => {
    const map = new VoxelMap()
    // A ramp along x: column x rises one level per cell.
    for (let x = 0; x < 6; x++) for (let z = 0; z < 4; z++) column(map, x, z, 0, 4 + x)
    const f = field(map)
    const a = f.runsAt(2, 1)[0]
    const b = f.runsAt(3, 1)[0]
    if (!a || !b) throw new Error('no run')
    const na = f.cornerNormals(2, 1, a)
    const nb = f.cornerNormals(3, 1, b)
    // Lattice point (3, 2) is a's c11 and b's c01.
    expect(na[2]).toEqual(nb[3])
    const [x, y, z] = na[2] ?? [0, 0, 0]
    expect(Math.hypot(x, y, z)).toBeCloseTo(1)
    expect(x).toBeLessThan(0) // tilted away from the rising side
    expect(y).toBeGreaterThan(0.8)
    expect(z).toBeCloseTo(0)
  })

  it('keeps a tunnel floor flat under its roof', () => {
    const map = new VoxelMap()
    for (let x = 0; x < 3; x++)
      for (let z = 0; z < 3; z++) {
        column(map, x, z, 0, 6)
        if (x !== 1) column(map, x, z, 6, 14)
      }
    for (let z = 0; z < 3; z++) column(map, 1, z, 10, 14) // roof over the floor
    const f = field(map)
    const [floor] = f.runsAt(1, 1)
    if (!floor) throw new Error('no run')
    for (const n of f.cornerNormals(1, 1, floor)) expect(n).toEqual([0, 1, 0])
  })
})

describe('vaulted undersides', () => {
  it('keeps the bottom of ground resting on nothing flat (map floor)', () => {
    const map = new VoxelMap()
    for (let x = 0; x < 2; x++) for (let z = 0; z < 2; z++) column(map, x, z, 0, 6)
    const f = field(map)
    const run = f.runsAt(0, 0)[0]
    if (!run) throw new Error('no run')
    expect(f.cornerBottoms(0, 0, run)).toEqual([0, 0, 0, 0])
  })

  it('drops a roof towards the side walls of the opening', () => {
    const map = new VoxelMap()
    // Tunnel along z at x = 1..2, walls at x = 0 and x = 3; floor 6, roof from 10.
    for (let z = 0; z < 4; z++)
      for (let x = 0; x < 4; x++) {
        column(map, x, z, 0, 6)
        column(map, x, z, x === 0 || x === 3 ? 6 : 10, 14)
      }
    const f = field(map)
    const roof = f.runsAt(1, 1)[1]
    if (!roof) throw new Error('no roof')
    const b = f.cornerBottoms(1, 1, roof)
    // Corners c00 and c01 touch the wall (x = 1): lower than the middle ones.
    expect(b[0]).toBeLessThan(b[1])
    expect(b[3]).toBeLessThan(b[2])
    expect(Math.min(...b)).toBeGreaterThan(6)
  })
})
