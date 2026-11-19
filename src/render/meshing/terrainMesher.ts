/**
 * Faceted terrain mesher (low-poly look).
 *
 * Layer: render (no Three.js import, unit-tested).
 *
 * Terrain voxels are drawn as a faceted height surface instead of blocks:
 * - **tops**: each terrain run (see `core/terrainSurface.ts`) gets a top made
 *   of two triangles whose corners are the smoothed corner heights;
 *   neighbouring tops share corner heights, so steps of any size become
 *   slopes and corners seen from above are cut diagonally. Tops are smooth
 *   shaded (per-corner normals averaged over the connected facets), so the
 *   low-poly geometry does not show as a patchwork of flat facets;
 * - **walls**: vertical faces along cell edges, only where the neighbour
 *   column does not cover the run (cliff bases that do not join, tunnel
 *   walls, map borders);
 * - **bottoms**: flat faces under overhangs (tunnel roofs), never under the
 *   map floor (level 0);
 * - **water**: a flat quad at the water surface over every cell whose top
 *   dips below it (water cells and the banks next to them). Beds blend with
 *   banks, so the shoreline is the exact line where facets cross the plane,
 *   not the cell grid. The plane sits a hair below the surface level so land
 *   facets lying exactly at that level win the depth test. Each vertex
 *   carries the water depth above the bed (weight channel 0, world units,
 *   negative where the bank rises above the surface); the quad is split
 *   along the bed's facet diagonal so the interpolated depth matches the
 *   bed. The water shader fades the shore and darkens deep water with it.
 * Steep triangles take the colour of the layer under the top voxel (dirt
 * under grass, rock under rock), so slopes and cliffs read as bare ground.
 */
import type { Chunk } from '@/core/chunk'
import { CHUNK_SIZE, VOXEL_HEIGHT } from '@/core/coords'
import { Material } from '@/core/materials'
import {
  TerrainField,
  oneHotWeights,
  facetDiagonal,
  type FacetCorners,
  type TerrainRun,
} from '@/core/terrainSurface'
import { isAir, materialOf, type Voxel } from '@/core/voxel'
import type { VoxelMap } from '@/core/voxelMap'
import { MeshBuilder, cellJitter, cross, sub, type Vec3 } from './meshBuilder'
import type { ColorLookup, MeshData } from './mesher'

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

/** How far below the water surface level the plane is drawn, in world units. */
const WATER_DROP = 0.02

/** Deepest water column scanned, in voxels. */
const MAX_WATER_DEPTH = 32

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
export class TerrainMesher {
  constructor(private readonly options: TerrainMesherOptions) {}

  /** Mesh the terrain and the water surface of one chunk (two separate meshes). */
  mesh(map: VoxelMap, chunk: Chunk): { terrain: MeshData; water: MeshData } {
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
    )
    const out = new MeshBuilder()
    const waterOut = new MeshBuilder()

    for (let z = oz; z < oz + CHUNK_SIZE; z++) {
      for (let x = ox; x < ox + CHUNK_SIZE; x++) {
        for (const run of field.runsAt(x, z)) {
          const ownsTop = Number.isFinite(run.top) && run.topY >= oy && run.topY < oy + CHUNK_SIZE
          if (ownsTop) {
            const corners = field.cornerHeights(x, z, run)
            const weights = field.cornerWeights(x, z, run)
            const normals = field.cornerNormals(x, z, run)
            this.top(out, map, x, z, run, corners, weights, normals)
            this.walls(out, map, field, x, z, run, corners, weights)
            this.water(waterOut, map, x, z, run, corners)
          }
          const b = run.bottom
          const ownsBottom = Number.isFinite(b) && b > FLOOR_LEVEL && b >= oy && b < oy + CHUNK_SIZE
          if (ownsBottom) this.bottom(out, map, x, z, run, field.cornerBottoms(x, z, run))
        }
      }
    }
    return { terrain: out.toMeshData(), water: waterOut.toMeshData() }
  }

  /** Two smooth-shaded triangles over the cell, split along the facet diagonal. */
  private top(
    out: MeshBuilder,
    map: VoxelMap,
    x: number,
    z: number,
    run: TerrainRun,
    h: FacetCorners,
    weights: (readonly number[])[],
    normals: readonly Vec3[],
  ): void {
    const p = CORNER_XZ.map(([dx, dz], i): Vec3 => [
      x + dx,
      h[i as 0 | 1 | 2 | 3] * VOXEL_HEIGHT,
      z + dz,
    ])
    const triangles: number[][] =
      facetDiagonal(h) === 0
        ? [
            [0, 1, 2],
            [0, 2, 3],
          ]
        : [
            [1, 2, 3],
            [1, 3, 0],
          ]
    const topMaterial = materialOf(map.get(x, run.topY, z))
    const below = map.get(x, run.topY - 1, z)
    const bareMaterial = this.options.isTerrain(below) ? materialOf(below) : topMaterial
    const jitter = cellJitter(x, run.topY, z)
    for (const corners of triangles) {
      const tri = corners.map((i): Vec3 => p[i] ?? [0, 0, 0])
      const [a, b, c] = tri as [Vec3, Vec3, Vec3]
      const face = cross(sub(b, a), sub(c, a))
      const ny = Math.abs(face[1]) / (Math.hypot(face[0], face[1], face[2]) || 1)
      const material = ny < STEEP_NORMAL_Y ? bareMaterial : topMaterial
      const w = corners.map((i) => weights[i] ?? oneHotWeights(run.material))
      const n = corners.map((i): Vec3 => normals[i] ?? [0, 1, 0])
      this.emit(out, tri, w, [0, 1, 0], this.shade(material, jitter), n)
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
    weights: (readonly number[])[],
  ): void {
    // A run continuing below the scanned window reaches at least the map
    // floor: walls go down to it, so the map's sides end on a flat bottom
    // instead of following the terrain one chunk below its top.
    const runBottom = Number.isFinite(run.bottom)
      ? run.bottom
      : Math.min(FLOOR_LEVEL, run.topY - CHUNK_SIZE)
    for (const edge of EDGES) {
      const nx = x + edge.dx
      const nz = z + edge.dz
      const neighbourRuns = field.runsAt(nx, nz)
      // Boundaries along the edge (t = 0 at the first end, 1 at the second):
      // tops are straight lines (facet edges), bottoms are constant.
      // Undersides of overhanging runs are vaulted (`cornerBottoms`): lines too.
      const under = (
        cx: number,
        cz: number,
        r: TerrainRun,
        corners: readonly [0 | 1 | 2 | 3, 0 | 1 | 2 | 3],
        fallback: number,
      ): Boundary => {
        if (!Number.isFinite(r.bottom)) return flat(fallback)
        const b = field.cornerBottoms(cx, cz, r)
        return line(b[corners[0]], b[corners[1]])
      }
      const mine: Band = [
        under(x, z, run, edge.mine, runBottom),
        line(h[edge.mine[0]], h[edge.mine[1]]),
      ]
      const covers: Band[] = neighbourRuns.map((r) => {
        const lower = under(nx, nz, r, edge.theirs, r.bottom)
        if (!Number.isFinite(r.top)) return [lower, flat(Infinity)]
        const c = field.cornerHeights(nx, nz, r)
        return [lower, line(c[edge.theirs[0]], c[edge.theirs[1]])]
      })

      const ends = edge.mine.map((corner) => CORNER_XZ[corner] ?? [0, 0])
      const [e0, e1] = ends as [readonly [number, number], readonly [number, number]]
      const outward: Vec3 = [edge.dx, 0, edge.dz]
      const at = (t: number, y: number): Vec3 => [
        x + e0[0] + (e1[0] - e0[0]) * t,
        y * VOXEL_HEIGHT,
        z + e0[1] + (e1[1] - e0[1]) * t,
      ]
      // Vertex weights: on the run's top edge, the top's blended corner
      // weights (so the wall's rim matches the facet above); lower down, the
      // material of the voxel layer at that height (dirt, stone, rock).
      const w0 = weights[edge.mine[0]] ?? oneHotWeights(run.material)
      const w1 = weights[edge.mine[1]] ?? oneHotWeights(run.material)
      const weightAt = (t: number, level: number): readonly number[] => {
        if (level >= mine[1](t) - 1e-3) return w0.map((v, k) => v + ((w1[k] ?? 0) - v) * t)
        // Vaulted undersides dip below the run's voxels: use its lowest one.
        const voxelY = Math.max(Math.floor(level - 1e-3), Math.ceil(runBottom))
        return oneHotWeights(materialOf(map.get(x, voxelY, z)))
      }
      for (const { t0, t1, lo, hi } of uncoveredStrips(mine, covers)) {
        const corners = dedupe([
          { p: at(t0, lo(t0)), w: weightAt(t0, lo(t0)) },
          { p: at(t1, lo(t1)), w: weightAt(t1, lo(t1)) },
          { p: at(t1, hi(t1)), w: weightAt(t1, hi(t1)) },
          { p: at(t0, hi(t0)), w: weightAt(t0, hi(t0)) },
        ])
        if (corners.length < 3) continue
        const polygon = corners.map((c) => c.p)
        const tm = (t0 + t1) / 2
        const mid = (lo(tm) + hi(tm)) / 2
        const voxel = map.get(x, Math.floor(mid), z)
        const material = this.options.isTerrain(voxel)
          ? materialOf(voxel)
          : materialOf(map.get(x, run.topY, z))
        this.emit(
          out,
          polygon,
          corners.map((c) => c.w),
          outward,
          this.shade(material, cellJitter(x, Math.floor(mid), z)),
        )
      }
    }
  }

  /** Vaulted underside of an overhanging run (cave or arch roof, ledge). */
  private bottom(
    out: MeshBuilder,
    map: VoxelMap,
    x: number,
    z: number,
    run: TerrainRun,
    b: FacetCorners,
  ): void {
    const under = map.get(x, run.bottom - 1, z)
    if (!isAir(under) && materialOf(under) !== Material.WATER) return
    const material = materialOf(map.get(x, run.bottom, z))
    const w = oneHotWeights(material)
    const p = CORNER_XZ.map(([dx, dz], i): Vec3 => [
      x + dx,
      b[i as 0 | 1 | 2 | 3] * VOXEL_HEIGHT,
      z + dz,
    ])
    const color = this.shade(material, cellJitter(x, run.bottom, z))
    // Two triangles (the vault is not planar), split like the tops.
    const triangles =
      facetDiagonal(b) === 0
        ? [
            [0, 1, 2],
            [0, 2, 3],
          ]
        : [
            [1, 2, 3],
            [1, 3, 0],
          ]
    for (const corners of triangles) {
      this.emit(
        out,
        corners.map((i): Vec3 => p[i] ?? [0, 0, 0]),
        [w, w, w],
        [0, -1, 0],
        color,
      )
    }
  }

  /**
   * Water plane over this cell: drawn when the column holds water above this
   * run, or a neighbouring column (8 around) has a water surface, and the
   * run's facet dips below that surface.
   */
  private water(
    out: MeshBuilder,
    map: VoxelMap,
    x: number,
    z: number,
    run: TerrainRun,
    h: FacetCorners,
  ): void {
    const level = waterSurfaceNear(map, x, z, run)
    if (level === null || Math.min(h[0], h[1], h[2], h[3]) >= level) return
    const y = level * VOXEL_HEIGHT - WATER_DROP
    // Counter-clockwise seen from above, starting on the bed's diagonal so
    // the fan's diagonal matches the facet's (interpolated depth = bed).
    const order = facetDiagonal(h) === 0 ? [0, 3, 2, 1] : [1, 0, 3, 2]
    const vertices = order.map((i): Vec3 => {
      const [dx, dz] = CORNER_XZ[i] ?? [0, 0]
      return [x + dx, y, z + dz]
    })
    const depths = order.map((i) => [y - h[i as 0 | 1 | 2 | 3] * VOXEL_HEIGHT])
    out.polygon(vertices, [0, 1, 0], this.shade(Material.WATER, 1), depths)
  }

  /** Emit a terrain face: smooth-shaded when `smooth` normals are given, flat otherwise. */
  private emit(
    out: MeshBuilder,
    vertices: Vec3[],
    weights: (readonly number[])[],
    outward: Vec3,
    color: Vec3,
    smooth?: Vec3[],
  ): void {
    if (smooth) out.smoothPolygon(vertices, smooth, outward, color, weights)
    else out.polygon(vertices, outward, color, weights)
  }

  /** Material colour times a brightness factor. */
  private shade(material: number, factor: number): Vec3 {
    const c = this.options.colorOf(material)
    return [c[0] * factor, c[1] * factor, c[2] * factor]
  }
}

/**
 * Level of the water surface relevant to a run: the top of the water
 * column resting on it, else a water surface in a neighbouring column
 * (8 around) between this run's facet and its top. Null when there is none.
 */
export function waterSurfaceNear(
  map: VoxelMap,
  x: number,
  z: number,
  run: TerrainRun,
): number | null {
  const isWater = (vx: number, vy: number, vz: number): boolean =>
    materialOf(map.get(vx, vy, vz)) === Material.WATER
  if (isWater(x, run.topY + 1, z)) {
    let top = run.topY + 1
    while (isWater(x, top + 1, z) && top < run.topY + MAX_WATER_DEPTH) top++
    return top + 1
  }
  for (let y = run.topY - MAX_WATER_DEPTH; y <= run.topY; y++) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (
          (dx !== 0 || dz !== 0) &&
          isWater(x + dx, y, z + dz) &&
          !isWater(x + dx, y + 1, z + dz)
        ) {
          return y + 1
        }
      }
    }
  }
  return null
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

/** A polygon corner with its material weights. */
interface WeightedVertex {
  readonly p: Vec3
  readonly w: readonly number[]
}

/** Remove consecutive duplicate corners (collapsed wall ends). */
function dedupe(vertices: WeightedVertex[]): WeightedVertex[] {
  const same = (a: Vec3, b: Vec3): boolean =>
    Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 1e-9
  const out: WeightedVertex[] = []
  for (const v of vertices) {
    const last = out[out.length - 1]
    if (last && same(last.p, v.p)) continue
    out.push(v)
  }
  const first = out[0]
  const last = out[out.length - 1]
  if (out.length > 1 && first && last && same(first.p, last.p)) out.pop()
  return out
}
