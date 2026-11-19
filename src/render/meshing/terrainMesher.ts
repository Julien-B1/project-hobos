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

/** Closed interval of levels. */
type Interval = readonly [number, number]

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
      // Uncovered parts of this run at both ends of the edge.
      const pieces = edge.mine.map((corner, e) => {
        const covers: Interval[] = neighbourRuns.map((r) => [
          r.bottom,
          Number.isFinite(r.top) ? field.cornerHeights(nx, nz, r)[edge.theirs[e] ?? 0] : Infinity,
        ])
        return subtract([runBottom, h[corner]], covers)
      }) as [Interval[], Interval[]]

      const ends = edge.mine.map((corner) => CORNER_XZ[corner] ?? [0, 0])
      const [e0, e1] = ends as [readonly [number, number], readonly [number, number]]
      const outward: Vec3 = [edge.dx, 0, edge.dz]
      for (const [a, b] of pairIntervals(pieces[0], pieces[1])) {
        const polygon = dedupe([
          [x + e0[0], a[0] * VOXEL_HEIGHT, z + e0[1]],
          [x + e1[0], b[0] * VOXEL_HEIGHT, z + e1[1]],
          [x + e1[0], b[1] * VOXEL_HEIGHT, z + e1[1]],
          [x + e0[0], a[1] * VOXEL_HEIGHT, z + e0[1]],
        ])
        if (polygon.length < 3) continue
        const mid = (a[0] + a[1] + b[0] + b[1]) / 4
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

/** `a` minus the union of `cuts` (all closed intervals), as sorted pieces. */
export function subtract(a: Interval, cuts: readonly Interval[]): Interval[] {
  let pieces: Interval[] = a[1] - a[0] > 1e-6 ? [a] : []
  for (const [lo, hi] of cuts) {
    const next: Interval[] = []
    for (const [p, q] of pieces) {
      if (hi <= p || lo >= q) {
        next.push([p, q])
        continue
      }
      if (lo > p) next.push([p, lo])
      if (hi < q) next.push([hi, q])
    }
    pieces = next.filter(([p, q]) => q - p > 1e-6)
  }
  return pieces
}

/**
 * Pair the uncovered pieces found at the two ends of an edge into wall
 * strips. Same count: pair in order. Otherwise extra pieces close against a
 * zero-height point at the other end (the strip becomes a triangle).
 */
function pairIntervals(a: Interval[], b: Interval[]): [Interval, Interval][] {
  const pairs: [Interval, Interval][] = []
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const pa = a[i]
    const pb = b[i]
    if (pa && pb) pairs.push([pa, pb])
    else if (pa) pairs.push([pa, [(pa[0] + pa[1]) / 2, (pa[0] + pa[1]) / 2]])
    else if (pb) pairs.push([[(pb[0] + pb[1]) / 2, (pb[0] + pb[1]) / 2], pb])
  }
  return pairs
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
