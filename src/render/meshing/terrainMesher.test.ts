import { describe, expect, it } from 'vitest'
import { Material, isTerrainMaterial } from '@/core/materials'
import { materialOf, packVoxel, type Voxel } from '@/core/voxel'
import { VoxelMap } from '@/core/voxelMap'
import type { MeshData } from './mesher'
import { createKitchenSinkMap } from '@/core/generators/kitchenSinkMap'
import { createRiverMap } from '@/core/generators/riverMap'
import { TerrainMesher, UP_CHANNEL, uncoveredStrips } from './terrainMesher'
import { openStretches, unmatchedEdges } from './watertight'

const isTerrain = (v: Voxel): boolean => isTerrainMaterial(materialOf(v))
// Base surface, without rock relief: exact and watertight.
const mesher = new TerrainMesher({ isTerrain, colorOf: () => [1, 1, 1], crags: false })
const craggy = new TerrainMesher({ isTerrain, colorOf: () => [1, 1, 1] })
const GRASS = packVoxel(Material.GRASS)

const meshAll = (map: VoxelMap): MeshData[] =>
  [...map.chunks()].map((c) => mesher.mesh(map, c).terrain)
const at = (arr: Float32Array, v: number, c: number): number => arr[v * 3 + c] ?? NaN
const key = (m: MeshData, v: number): string =>
  [0, 1, 2].map((c) => at(m.positions, v, c).toFixed(4)).join(',')

/** Every triangle edge (by position) is shared by exactly two triangles. */
function expectClosed(meshes: MeshData[]): void {
  const edges = new Map<string, number>()
  for (const m of meshes) {
    for (let t = 0; t < m.indices.length; t += 3) {
      const tri = [0, 1, 2].map((o) => key(m, m.indices[t + o] ?? 0))
      for (let e = 0; e < 3; e++) {
        const a = tri[e] ?? ''
        const b = tri[(e + 1) % 3] ?? ''
        const k = a < b ? `${a}|${b}` : `${b}|${a}`
        edges.set(k, (edges.get(k) ?? 0) + 1)
      }
    }
  }
  const open = [...edges.values()].filter((c) => c !== 2)
  expect(open).toHaveLength(0)
}

/** Fill a box of grass, half-open ranges. */
function box(
  map: VoxelMap,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
): void {
  for (let x = x0; x < x1; x++)
    for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++) map.set(x, y, z, GRASS)
}

describe('uncoveredStrips', () => {
  const flat = (y: number) => (): number => y
  const line =
    (a: number, b: number) =>
    (t: number): number =>
      a + (b - a) * t

  it('keeps the part of a run above a lower neighbour', () => {
    const strips = uncoveredStrips([flat(0), flat(10)], [[flat(0), flat(4)]])
    expect(strips).toHaveLength(1)
    expect(strips[0]?.lo(0.5)).toBe(4)
    expect(strips[0]?.hi(0.5)).toBe(10)
  })

  it('returns nothing when the neighbour covers everything', () => {
    expect(uncoveredStrips([flat(0), flat(10)], [[flat(-Infinity), flat(12)]])).toEqual([])
  })

  it('cuts the wall where the two tops cross along the edge', () => {
    // Mine goes 10 -> 6, neighbour 6 -> 10: uncovered only for t < 0.5.
    const strips = uncoveredStrips([flat(0), line(10, 6)], [[flat(0), line(6, 10)]])
    expect(strips).toHaveLength(1)
    expect(strips[0]?.t0).toBe(0)
    expect(strips[0]?.t1).toBeCloseTo(0.5)
    expect(strips[0]?.hi(0.5)).toBeCloseTo(8)
    expect(strips[0]?.lo(0.5)).toBeCloseTo(8)
  })
})

describe('TerrainMesher', () => {
  it('meshes flat ground as flat triangles at the top level', () => {
    const map = new VoxelMap()
    box(map, 0, 8, 0, 4, 0, 8)
    const [m] = meshAll(map)
    if (!m) throw new Error('no mesh')
    let tops = 0
    for (let v = 0; v < m.positions.length / 3; v++) {
      if (at(m.normals, v, 1) < 0.99) continue // walls
      tops++
      expect(at(m.positions, v, 1)).toBeCloseTo(2)
    }
    expect(tops).toBeGreaterThan(0)
  })

  it('builds a closed surface for a floating block', () => {
    const map = new VoxelMap()
    box(map, 2, 6, 3, 7, 2, 5)
    expectClosed(meshAll(map))
  })

  it('builds a closed surface for a floating hill crossing chunk borders', () => {
    const map = new VoxelMap()
    box(map, 10, 22, 4, 8, 10, 22)
    box(map, 13, 19, 8, 12, 13, 19)
    box(map, 15, 17, 12, 15, 15, 17)
    expectClosed(meshAll(map))
  })

  it('keeps a tunnel open: flat floor, vaulted roof and inner walls', () => {
    const map = new VoxelMap()
    box(map, 0, 10, 2, 12, 0, 10)
    // Carve a tunnel along X: air at levels 4..6, cells z 4..5.
    for (let x = 0; x < 10; x++)
      for (let y = 4; y < 7; y++) for (let z = 4; z < 6; z++) map.set(x, y, z, 0)
    const [m] = meshAll(map)
    if (!m) throw new Error('no mesh')
    let floor = 0
    let roof = 0
    let innerWall = 0
    for (let v = 0; v < m.positions.length / 3; v++) {
      const [x, y, z] = [0, 1, 2].map((c) => at(m.positions, v, c)) as [number, number, number]
      const ny = at(m.normals, v, 1)
      const inside = x > 0.5 && x < 9.5
      if (inside && z > 4 && z < 6 && ny > 0.99 && Math.abs(y - 2) < 1e-6) floor++
      // The roof is vaulted: facing down, between mid-height and a bit over level 7.
      if (inside && z >= 4 && z <= 6 && ny < -0.3 && y > 2.6 && y < 3.8) roof++
      const onWall = Math.abs(z - 4) < 1e-6 && Math.abs(ny) < 1e-6
      if (inside && onWall && y >= 2 - 1e-6 && y <= 3.5 + 1e-6) innerWall++
    }
    expect(floor).toBeGreaterThan(0) // floor stays at level 4 (2.0 world units)
    expect(roof).toBeGreaterThan(0) // roof underside around level 7 (3.5)
    expect(innerWall).toBeGreaterThan(0) // side wall between floor and roof
  })

  it('turns a step into a slope (no vertical wall)', () => {
    const map = new VoxelMap()
    box(map, 0, 4, 0, 4, 0, 6)
    box(map, 4, 8, 0, 6, 0, 6)
    const [m] = meshAll(map)
    if (!m) throw new Error('no mesh')
    // No vertical face between x = 4 cells inside the map (z in (0, 6)).
    for (let t = 0; t < m.indices.length; t += 3) {
      const vs = [0, 1, 2].map((o) => m.indices[t + o] ?? 0)
      const xs = vs.map((v) => at(m.positions, v, 0))
      const zs = vs.map((v) => at(m.positions, v, 2))
      const vertical = xs.every((x) => Math.abs(x - 4) < 1e-6)
      const inside = zs.every((z) => z > 0 && z < 6)
      expect(vertical && inside).toBe(false)
    }
  })
  it('ends the map sides on a flat bottom, even under tall columns', () => {
    const map = new VoxelMap()
    box(map, 0, 4, 0, 20, 0, 4) // tops in the second chunk layer (level 20)
    const ys = new Set<number>()
    for (const m of meshAll(map)) {
      for (let v = 0; v < m.positions.length / 3; v++) {
        const onWestSide = Math.abs(at(m.positions, v, 0)) < 1e-6 && at(m.normals, v, 0) < -0.99
        if (onWestSide) ys.add(Number(at(m.positions, v, 1).toFixed(3)))
      }
    }
    // Down to the map floor, not one chunk below the top (level 3, 1.5 units).
    expect(Math.min(...ys)).toBe(0)
  })

  it('smooth-shades tops: vertices at one lattice point share one normal', () => {
    const map = new VoxelMap()
    for (let x = 0; x < 8; x++) box(map, x, x + 1, 0, 4 + x, 0, 6)
    const [m] = meshAll(map)
    if (!m) throw new Error('no mesh')
    const normals = new Map<string, string>()
    let tilted = 0
    for (let v = 0; v < m.positions.length / 3; v++) {
      const ny = at(m.normals, v, 1)
      if (ny < 0.5) continue // walls
      const n = [0, 1, 2].map((c) => at(m.normals, v, c).toFixed(4)).join(',')
      const k = key(m, v)
      expect(normals.get(k) ?? n).toBe(n)
      normals.set(k, n)
      if (ny < 0.999) tilted++
    }
    expect(tilted).toBeGreaterThan(0)
  })

  it('gives water vertices their depth above the bed', () => {
    const map = new VoxelMap()
    box(map, 0, 10, 0, 6, 0, 10)
    // Pond: cells 3..6 dug down to level 3, water up to level 6.
    for (let x = 3; x < 7; x++)
      for (let z = 3; z < 7; z++)
        for (let y = 3; y < 6; y++) map.set(x, y, z, packVoxel(Material.WATER))
    const water = [...map.chunks()].map((c) => mesher.mesh(map, c).water)
    const depths: number[] = []
    for (const w of water) {
      if (!w.weights) continue
      for (let v = 0; v < w.positions.length / 3; v++) {
        expect(at(w.positions, v, 1)).toBeCloseTo(3 - 0.02)
        depths.push(w.weights[v * 8] ?? NaN)
      }
    }
    expect(depths.length).toBeGreaterThan(0)
    expect(Math.max(...depths)).toBeGreaterThan(1) // pond centre: 1.5 below the surface
    expect(Math.min(...depths)).toBeLessThanOrEqual(0) // banks rise above the surface
  })
})

describe('TerrainMesher watertightness', () => {
  const onFloorOrBorder =
    (size: number) =>
    (a: readonly number[], b: readonly number[]): boolean => {
      const both = (f: (p: readonly number[]) => boolean): boolean => f(a) && f(b)
      return (
        both((p) => Math.abs(p[1] ?? 1) < 1e-6) ||
        both((p) => Math.abs(p[0] ?? 1) < 1e-6) ||
        both((p) => Math.abs((p[0] ?? 0) - size) < 1e-6) ||
        both((p) => Math.abs(p[2] ?? 1) < 1e-6) ||
        both((p) => Math.abs((p[2] ?? 0) - size) < 1e-6)
      )
    }

  it('has no gap on a tunnel through a hill (T-junction tolerant)', () => {
    const map = new VoxelMap()
    box(map, 0, 10, 2, 12, 0, 10)
    for (let x = 0; x < 10; x++)
      for (let y = 4; y < 7; y++) for (let z = 4; z < 6; z++) map.set(x, y, z, 0)
    expect(openStretches(meshAll(map))).toEqual([])
  })

  it('stays watertight with crags (cave, river and kitchen-sink maps)', () => {
    const craggyAll = (map: VoxelMap): MeshData[] =>
      [...map.chunks()].map((c) => craggy.mesh(map, c).terrain)
    // Map borders (x or z at 0 or the size) and the floor stay open.
    const border =
      (width: number, depth: number) =>
      (p: readonly number[]): boolean =>
        Math.abs(p[1] ?? 0) < 1e-3 ||
        [0, width].some((b) => Math.abs((p[0] ?? 0) - b) < 1e-2) ||
        [0, depth].some((b) => Math.abs((p[2] ?? 0) - b) < 1e-2)
    const tunnel = new VoxelMap()
    box(tunnel, 0, 10, 2, 12, 0, 10)
    for (let x = 0; x < 10; x++)
      for (let y = 4; y < 7; y++) for (let z = 4; z < 6; z++) tunnel.set(x, y, z, 0)
    expect(unmatchedEdges(craggyAll(tunnel), border(10, 10))).toEqual([])
    const { map } = createRiverMap({ seed: 3, size: 32 })
    expect(unmatchedEdges(craggyAll(map), border(32, 32)).slice(0, 5)).toEqual([])
    expect(unmatchedEdges(craggyAll(createKitchenSinkMap()), border(40, 32)).slice(0, 5)).toEqual(
      [],
    )
  })

  it('has no gap anywhere on an river map except the map floor and borders', () => {
    const size = 48
    const { map } = createRiverMap({ seed: 3, size })
    const open = openStretches(meshAll(map), onFloorOrBorder(size))
    expect(open.slice(0, 5)).toEqual([])
  })
})

describe('TerrainMesher crags', () => {
  /** Flat ground (level 4) with a tall block (level 16) in the middle. */
  function cliffMap(): VoxelMap {
    const map = new VoxelMap()
    box(map, 0, 16, 0, 4, 0, 16)
    box(map, 6, 10, 4, 16, 6, 10)
    return map
  }

  it('subdivides and displaces faces around marked relief only', () => {
    const map = cliffMap()
    const chunk = [...map.chunks()].find((c) => c.cy === 0)
    if (!chunk) throw new Error('no chunk')
    const plain = mesher.mesh(map, chunk).terrain
    const rocky = craggy.mesh(map, chunk).terrain
    expect(rocky.indices.length).toBeGreaterThan(plain.indices.length * 1.5)
    let displaced = 0
    for (let v = 0; v < rocky.positions.length / 3; v++) {
      const x = at(rocky.positions, v, 0)
      const y = at(rocky.positions, v, 1)
      const z = at(rocky.positions, v, 2)
      const onGrid = [x, y, z].every((c) => Math.abs(c * 2 - Math.round(c * 2)) < 1e-6)
      if (!onGrid) displaced++
      // Far from the cliff the ground stays exactly flat.
      if (x < 3 || z < 3) expect(y === 0 || Math.abs(y - 2) < 1e-6).toBe(true)
    }
    expect(displaced).toBeGreaterThan(50)
  })

  it('is deterministic', () => {
    const map = cliffMap()
    const [chunk] = [...map.chunks()]
    if (!chunk) throw new Error('no chunk')
    expect(craggy.mesh(map, chunk).terrain.positions).toEqual(
      craggy.mesh(map, chunk).terrain.positions,
    )
  })
})

describe('TerrainMesher openings', () => {
  it('gives cave mouth facades the earth look and keeps rock inside', () => {
    // A hill (levels 0..12) over the whole map, a tunnel along X at z 4..5,
    // levels 4..6: its mouth opens on the map's west border (x = 0).
    const map = new VoxelMap()
    box(map, 0, 10, 0, 12, 0, 10)
    for (let x = 0; x < 10; x++)
      for (let y = 4; y < 7; y++) for (let z = 4; z < 6; z++) map.set(x, y, z, 0)
    const meshes = meshAll(map)
    const up = (m: MeshData, v: number): number => m.weights?.[v * 8 + UP_CHANNEL] ?? NaN
    let facade = 0
    let inside = 0
    for (const m of meshes) {
      for (let t = 0; t < m.indices.length; t += 3) {
        const vs = [0, 1, 2].map((k) => m.indices[t + k] ?? 0)
        const c = [0, 1, 2].map(
          (axis) => vs.reduce((sum, v) => sum + at(m.positions, v, axis), 0) / 3,
        )
        const [cx = 0, , cz = 0] = c
        const first = vs[0] ?? 0
        // West face of the hill beside the mouth (cells z = 3 and 6).
        if (Math.abs(cx) < 1e-6 && ((cz > 3 && cz < 4) || (cz > 6 && cz < 7))) {
          expect(up(m, first)).toBeLessThan(-0.5)
          facade++
        }
        // Side wall of the passage, deep inside (edge z = 4, facing +z).
        if (cx > 3 && cx < 7 && Math.abs(cz - 4) < 1e-6) {
          expect(up(m, first)).toBeGreaterThan(1.5) // rocky look
          inside++
        }
      }
    }
    expect(facade).toBeGreaterThan(0)
    expect(inside).toBeGreaterThan(0)
  })
})
