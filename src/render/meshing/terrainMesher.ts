/**
 * Faceted terrain mesher (low-poly look).
 *
 * Layer: render (no Three.js import, unit-tested).
 *
 * Terrain voxels are drawn as a faceted height surface instead of blocks:
 * - **tops**: each terrain run (see `core/terrainSurface.ts`) gets a top made
 *   of two flat-shaded triangles whose corners are the smoothed corner
 *   heights; neighbouring tops share corner heights, so steps of any size
 *   become slopes and corners seen from above are cut diagonally;
 * - **walls**: vertical faces along cell edges, only where the neighbour
 *   column does not cover the run (cliff bases that do not join, tunnel
 *   walls, map borders);
 * - **bottoms**: flat faces under overhangs (tunnel roofs), never under the
 *   map floor (level 0);
 * - **shores**: banks meet the water exactly at its surface (see
 *   `core/terrainSurface.ts`); the water itself is drawn as blocks.
 * Steep triangles take the colour of the layer under the top voxel (dirt
 * under grass, rock under rock), so slopes and cliffs read as bare ground.
 */
import type { Chunk } from '@/core/chunk'
import { CHUNK_SIZE, VOXEL_HEIGHT } from '@/core/coords'
import { Material } from '@/core/materials'
import {
  TerrainField,
  facetDiagonal,
  type FacetCorners,
  type TerrainRun,
} from '@/core/terrainSurface'
import { isAir, materialOf, type Voxel } from '@/core/voxel'
import type { VoxelMap } from '@/core/voxelMap'
import { MeshBuilder, cellJitter, cross, sub, type Vec3 } from './meshBuilder'
import type { ChunkMesher, ColorLookup, MeshData } from './mesher'

/** Options for {@link TerrainMesher}. */
export interface TerrainMesherOptions {
  /** Voxels that form the terrain. */
  readonly isTerrain: (voxel: Voxel) => boolean
  /** Linear RGB colour of a material id. */
  readonly colorOf: ColorLookup
}

/**
 * Level of the map floor: undersides at or below it are never visible (the
 * camera stays above the map), so they are not meshed.
 */
const FLOOR_LEVEL = 0

/** Triangles whose normal's y is below this count as steep (bare ground colour). */
const STEEP_NORMAL_Y = 0.72

/** Corner offsets (dx, dz) in `FacetCorners` order. */
const CORNER_XZ: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
]

/**
 * The 4 cell edges: neighbour offset, this cell's corners on the edge, and
 * the neighbour's corners at the same lattice points (same order).
 */
const EDGES: readonly {
  readonly dx: number
  readonly dz: number
  readonly mine: readonly [0 | 1 | 2 | 3, 0 | 1 | 2 | 3]
  readonly theirs: readonly [0 | 1 | 2 | 3, 0 | 1 | 2 | 3]
}[] = [
  { dx: 1, dz: 0, mine: [1, 2], theirs: [0, 3] },
  { dx: -1, dz: 0, mine: [0, 3], theirs: [1, 2] },
  { dx: 0, dz: 1, mine: [3, 2], theirs: [0, 1] },
  { dx: 0, dz: -1, mine: [0, 1], theirs: [3, 2] },
]

/** Mesher for terrain voxels; see the module comment. */
export class TerrainMesher implements ChunkMesher {
  constructor(private readonly options: TerrainMesherOptions) {}

  /** Mesh the terrain part of one chunk. */
  mesh(map: VoxelMap, chunk: Chunk): MeshData {
    const ox = chunk.cx * CHUNK_SIZE
    const oy = chunk.cy * CHUNK_SIZE
    const oz = chunk.cz * CHUNK_SIZE
    // Window: a chunk below and above, so runs touching this chunk are whole
    // and corner groups agree with the neighbouring chunks' meshes.
    const field = new TerrainField(
      map,
      this.options.isTerrain,
      oy - CHUNK_SIZE,
      oy + 2 * CHUNK_SIZE - 1,
      (v) => materialOf(v) === Material.WATER,
    )
    const out = new MeshBuilder()

    for (let z = oz; z < oz + CHUNK_SIZE; z++) {
      for (let x = ox; x < ox + CHUNK_SIZE; x++) {
        for (const run of field.runsAt(x, z)) {
          const ownsTop = Number.isFinite(run.top) && run.topY >= oy && run.topY < oy + CHUNK_SIZE
          if (ownsTop) {
            const corners = field.cornerHeights(x, z, run)
            this.top(out, map, x, z, run, corners)
            this.walls(out, map, field, x, z, run, corners)
          }
          const b = run.bottom
          const ownsBottom = Number.isFinite(b) && b > FLOOR_LEVEL && b >= oy && b < oy + CHUNK_SIZE
          if (ownsBottom) this.bottom(out, map, x, z, run)
        }
      }
    }
    return out.toMeshData()
  }

  /** Two flat triangles over the cell, split along the facet diagonal. */
  private top(
    out: MeshBuilder,
    map: VoxelMap,
    x: number,
    z: number,
    run: TerrainRun,
    h: FacetCorners,
  ): void {
    const p = CORNER_XZ.map(([dx, dz], i): Vec3 => [
      x + dx,
      h[i as 0 | 1 | 2 | 3] * VOXEL_HEIGHT,
      z + dz,
    ])
    const [p0, p1, p2, p3] = p as [Vec3, Vec3, Vec3, Vec3]
    const triangles: Vec3[][] =
      facetDiagonal(h) === 0
        ? [
            [p0, p1, p2],
            [p0, p2, p3],
          ]
        : [
            [p1, p2, p3],
            [p1, p3, p0],
          ]
    const topMaterial = materialOf(map.get(x, run.topY, z))
    const below = map.get(x, run.topY - 1, z)
    const bareMaterial = this.options.isTerrain(below) ? materialOf(below) : topMaterial
    const jitter = cellJitter(x, run.topY, z)
    for (const tri of triangles) {
      const [a, b, c] = tri as [Vec3, Vec3, Vec3]
      const n = cross(sub(b, a), sub(c, a))
      const ny = Math.abs(n[1]) / (Math.hypot(n[0], n[1], n[2]) || 1)
      const material = ny < STEEP_NORMAL_Y ? bareMaterial : topMaterial
      out.polygon(tri, [0, 1, 0], this.shade(material, jitter))
    }
  }

  /** Vertical faces on each cell edge where the neighbour does not cover this run. */
  private walls(
    out: MeshBuilder,
    map: VoxelMap,
    field: TerrainField,
    x: number,
    z: number,
    run: TerrainRun,
    h: FacetCorners,
  ): void {
    const runBottom = Number.isFinite(run.bottom) ? run.bottom : run.topY - CHUNK_SIZE
    for (const edge of EDGES) {
      const nx = x + edge.dx
      const nz = z + edge.dz
      const neighbourRuns = field.runsAt(nx, nz)
      // Boundaries along the edge (t = 0 at the first end, 1 at the second):
      // tops are straight lines (facet edges), bottoms are constant.
      const mine: Band = [flat(runBottom), line(h[edge.mine[0]], h[edge.mine[1]])]
      const covers: Band[] = neighbourRuns.map((r) => {
        if (!Number.isFinite(r.top)) return [flat(r.bottom), flat(Infinity)]
        const c = field.cornerHeights(nx, nz, r)
        return [flat(r.bottom), line(c[edge.theirs[0]], c[edge.theirs[1]])]
      })

      const ends = edge.mine.map((corner) => CORNER_XZ[corner] ?? [0, 0])
      const [e0, e1] = ends as [readonly [number, number], readonly [number, number]]
      const outward: Vec3 = [edge.dx, 0, edge.dz]
      const at = (t: number, y: number): Vec3 => [
        x + e0[0] + (e1[0] - e0[0]) * t,
        y * VOXEL_HEIGHT,
        z + e0[1] + (e1[1] - e0[1]) * t,
      ]
      for (const { t0, t1, lo, hi } of uncoveredStrips(mine, covers)) {
        const polygon = dedupe([at(t0, lo(t0)), at(t1, lo(t1)), at(t1, hi(t1)), at(t0, hi(t0))])
        if (polygon.length < 3) continue
        const tm = (t0 + t1) / 2
        const mid = (lo(tm) + hi(tm)) / 2
        const voxel = map.get(x, Math.floor(mid), z)
        const material = this.options.isTerrain(voxel)
          ? materialOf(voxel)
          : materialOf(map.get(x, run.topY, z))
        out.polygon(polygon, outward, this.shade(material, cellJitter(x, Math.floor(mid), z)))
      }
    }
  }

  /** Flat face under an overhanging run (tunnel roof, ledge). */
  private bottom(out: MeshBuilder, map: VoxelMap, x: number, z: number, run: TerrainRun): void {
    const under = map.get(x, run.bottom - 1, z)
    if (!isAir(under) && materialOf(under) !== Material.WATER) return
    const y = run.bottom * VOXEL_HEIGHT
    const material = materialOf(map.get(x, run.bottom, z))
    out.polygon(
      [
        [x, y, z],
        [x + 1, y, z],
        [x + 1, y, z + 1],
        [x, y, z + 1],
      ],
      [0, -1, 0],
      this.shade(material, cellJitter(x, run.bottom, z)),
    )
  }

  /** Material colour times a brightness factor. */
  private shade(material: number, factor: number): Vec3 {
    const c = this.options.colorOf(material)
    return [c[0] * factor, c[1] * factor, c[2] * factor]
  }
}

/** A boundary along an edge: height (levels) as a linear function of t in [0, 1]. */
type Boundary = (t: number) => number

/** Lower and upper boundary of a solid band along an edge. */
type Band = readonly [Boundary, Boundary]

/** Constant boundary. */
function flat(y: number): Boundary {
  return () => y
}

/** Straight boundary from `a` at t = 0 to `b` at t = 1. */
function line(a: number, b: number): Boundary {
  return (t) => a + (b - a) * t
}

/** A wall strip between t0 and t1, bounded below by `lo` and above by `hi`. */
interface Strip {
  readonly t0: number
  readonly t1: number
  readonly lo: Boundary
  readonly hi: Boundary
}

/**
 * Parts of band `a` not covered by any band of `covers`, along an edge.
 *
 * Boundaries are linear in t, so the edge is cut at every t where two
 * boundaries cross; inside each piece the vertical order of all boundaries
 * is fixed, so the uncovered parts found at the piece's middle keep the
 * same bounding boundaries over the whole piece. This yields exact wall
 * polygons even when this run and a neighbour cross along the edge (one
 * higher at one end, lower at the other).
 */
export function uncoveredStrips(a: Band, covers: readonly Band[]): Strip[] {
  const boundaries: Boundary[] = [a[0], a[1], ...covers.flatMap((c) => [c[0], c[1]])]
  const cuts = new Set<number>([0, 1])
  for (let i = 0; i < boundaries.length; i++) {
    for (let j = i + 1; j < boundaries.length; j++) {
      const f = boundaries[i]
      const g = boundaries[j]
      if (!f || !g) continue
      const d0 = f(0) - g(0)
      const d1 = f(1) - g(1)
      if (!Number.isFinite(d0) || !Number.isFinite(d1)) continue
      if ((d0 < 0 && d1 > 0) || (d0 > 0 && d1 < 0)) cuts.add(d0 / (d0 - d1))
    }
  }
  const ts = [...cuts].sort((p, q) => p - q)
  const strips: Strip[] = []
  for (let k = 0; k < ts.length - 1; k++) {
    const t0 = ts[k] ?? 0
    const t1 = ts[k + 1] ?? 1
    if (t1 - t0 < 1e-9) continue
    const tm = (t0 + t1) / 2
    // Uncovered pieces at the middle, tracked as boundary pairs.
    let pieces: Band[] = a[1](tm) - a[0](tm) > 1e-9 ? [a] : []
    for (const [cLo, cHi] of covers) {
      const lo = cLo(tm)
      const hi = cHi(tm)
      const next: Band[] = []
      for (const [pLo, pHi] of pieces) {
        if (hi <= pLo(tm) || lo >= pHi(tm)) {
          next.push([pLo, pHi])
          continue
        }
        if (lo > pLo(tm)) next.push([pLo, cLo])
        if (hi < pHi(tm)) next.push([cHi, pHi])
      }
      pieces = next.filter(([pLo, pHi]) => pHi(tm) - pLo(tm) > 1e-9)
    }
    for (const [lo, hi] of pieces) strips.push({ t0, t1, lo, hi })
  }
  return strips
}

/** Remove consecutive duplicate vertices (collapsed wall ends). */
function dedupe(vertices: Vec3[]): Vec3[] {
  const out: Vec3[] = []
  for (const v of vertices) {
    const last = out[out.length - 1]
    if (
      last &&
      Math.abs(last[0] - v[0]) + Math.abs(last[1] - v[1]) + Math.abs(last[2] - v[2]) < 1e-9
    ) {
      continue
    }
    out.push(v)
  }
  const first = out[0]
  const last = out[out.length - 1]
  if (
    out.length > 1 &&
    first &&
    last &&
    first.every((c, i) => Math.abs(c - (last[i] ?? 0)) < 1e-9)
  ) {
    out.pop()
  }
  return out
}
