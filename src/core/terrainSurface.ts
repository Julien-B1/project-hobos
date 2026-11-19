/**
 * Faceted terrain surface: smoothed corner heights computed from voxels.
 *
 * Layer: core (pure TypeScript, unit-tested). Used by the faceted terrain
 * mesher (render) and anything that needs the *rendered* height of terrain.
 * Game logic keeps using voxel surfaces (`surface.ts`); this module only
 * describes how terrain looks.
 *
 * Model:
 * - A *run* is a vertical stretch of terrain voxels in one column (cell),
 *   from `bottom` to `top`, in levels (one level = one voxel = 0.5 world
 *   unit). A column has one run for plain ground, two for a tunnel (floor and
 *   roof), etc. The top of a run whose top voxel is a wedge (slope, corner)
 *   counts its partial height (e.g. +0.5 for a slope).
 * - Every lattice point (cell corner) gets one height per *group* of runs
 *   meeting there. Runs of the up to 4 cells around a corner are grouped when
 *   they *connect*: the higher run's column is solid down to the lower top,
 *   and nothing covers the lower run below the higher top. A tunnel floor
 *   therefore never joins the hill top above it, while ground at the foot of
 *   a cliff joins the cliff top (the cliff becomes a steep facet).
 * - The group's height is the mean of its run tops. All cells sharing the
 *   corner read the same value, so facets join without gaps.
 * - Water: runs under water (beds) only group with other beds. A dry corner
 *   touching a water column is set to the water surface level, so shores
 *   meet the water on a clean line instead of dipping under it.
 */
import { isAir, materialOf, type Voxel } from './voxel'
import { voxelTopCorners } from './shapes'
import type { VoxelMap } from './voxelMap'

/** A vertical stretch of terrain voxels in one column, in levels. */
export interface TerrainRun {
  /** Level of the run's lowest voxel bottom (`-Infinity` if below the scanned window). */
  readonly bottom: number
  /**
   * Level of the run's top: top voxel y + its mean corner height (1 for a
   * full block, 0.5 for a slope). `Infinity` if above the scanned window.
   */
  readonly top: number
  /** Voxel y of the top voxel. */
  readonly topY: number
  /**
   * Level of the water surface above the run when the voxel on top of it is
   * water (river or lake bed), else null.
   */
  readonly waterLevel: number | null
}

/** Corner heights of a run's top, in levels: [c00, c10, c11, c01] (see `shapes.ts`). */
export type FacetCorners = readonly [number, number, number, number]

/** Safety bound when scanning a water column upwards, in voxels. */
const CHUNK_LIMIT = 64

/** Largest height difference (levels) that a facet may bridge between two runs. */
export const MAX_FACET_RISE = 12

/** Offsets (dx, dz) of the 4 cells around lattice point (cx, cz): cell = corner + offset. */
const CELLS_AROUND_CORNER: readonly (readonly [number, number])[] = [
  [-1, -1],
  [0, -1],
  [-1, 0],
  [0, 0],
]

/** Lattice offsets of the 4 corners of a cell, in `FacetCorners` order. */
const CELL_CORNERS: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
]

/**
 * Terrain runs and corner heights over a vertical window of a map, with
 * caches. Create one per meshing job; it reads the map lazily.
 */
export class TerrainField {
  private readonly runsCache = new Map<string, TerrainRun[]>()
  private readonly cornerCache = new Map<string, Map<TerrainRun, number>>()

  /**
   * @param isTerrain Which voxels are terrain (others count as empty).
   * @param yMin Lowest voxel y scanned.
   * @param yMax Highest voxel y scanned.
   */
  constructor(
    private readonly map: VoxelMap,
    private readonly isTerrain: (voxel: Voxel) => boolean,
    private readonly yMin: number,
    private readonly yMax: number,
    private readonly isWater: (voxel: Voxel) => boolean = () => false,
  ) {}

  /** Runs of column (x, z) inside the window, bottom to top. */
  runsAt(x: number, z: number): TerrainRun[] {
    const key = `${x},${z}`
    const cached = this.runsCache.get(key)
    if (cached) return cached
    const runs: TerrainRun[] = []
    let start: number | null = null
    let lastVoxel = 0
    for (let y = this.yMin; y <= this.yMax; y++) {
      const v = this.map.get(x, y, z)
      const solid = !isAir(v) && this.isTerrain(v)
      if (solid && start === null) start = y
      if (solid) lastVoxel = v
      if (!solid && start !== null) {
        runs.push(this.makeRun(start, y - 1, lastVoxel, this.waterSurfaceFrom(x, y, z)))
        start = null
      }
    }
    if (start !== null) {
      runs.push({ bottom: this.bottomOf(start), top: Infinity, topY: this.yMax, waterLevel: null })
    }
    this.runsCache.set(key, runs)
    return runs
  }

  /** Corner heights (levels) of a run's top in cell (x, z). */
  cornerHeights(x: number, z: number, run: TerrainRun): FacetCorners {
    const h = CELL_CORNERS.map(([dx, dz]) => this.cornerHeight(x + dx, z + dz, run))
    return [h[0] ?? run.top, h[1] ?? run.top, h[2] ?? run.top, h[3] ?? run.top]
  }

  /** Height (levels) of `run` at lattice point (cx, cz); the run must belong to a cell around it. */
  private cornerHeight(cx: number, cz: number, run: TerrainRun): number {
    const h = this.cornerGroups(cx, cz).get(run) ?? run.top
    // An overhanging run must not be pulled below its own bottom.
    return Number.isFinite(run.bottom) ? Math.max(h, run.bottom + 0.25) : h
  }

  /** Group heights of every run around lattice point (cx, cz), cached. */
  private cornerGroups(cx: number, cz: number): Map<TerrainRun, number> {
    const key = `${cx},${cz}`
    const cached = this.cornerCache.get(key)
    if (cached) return cached

    const members: { cell: number; run: TerrainRun; runs: TerrainRun[] }[] = []
    CELLS_AROUND_CORNER.forEach(([dx, dz], cell) => {
      const runs = this.runsAt(cx + dx, cz + dz)
      for (const run of runs) if (Number.isFinite(run.top)) members.push({ cell, run, runs })
    })

    // Union-find over runs of different cells that connect.
    const parent = members.map((_, i) => i)
    const find = (i: number): number => {
      while (parent[i] !== i) i = parent[i] ?? i
      return i
    }
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const a = members[i]
        const b = members[j]
        if (!a || !b || a.cell === b.cell) continue
        // Underwater beds and dry ground never blend: the bed is hidden by
        // the water anyway, and blending would pull banks below the water.
        if ((a.run.waterLevel === null) !== (b.run.waterLevel === null)) continue
        if (connects(a.run, a.runs, b.run, b.runs)) parent[find(i)] = find(j)
      }
    }
    const sums = new Map<number, { sum: number; count: number }>()
    members.forEach((m, i) => {
      const root = find(i)
      const s = sums.get(root) ?? { sum: 0, count: 0 }
      s.sum += m.run.top
      s.count++
      sums.set(root, s)
    })
    // Shore: a dry corner next to water sits exactly on the water surface,
    // so banks meet the water along a clean line.
    let shoreLevel = Infinity
    for (const m of members) {
      if (m.run.waterLevel !== null) shoreLevel = Math.min(shoreLevel, m.run.waterLevel)
    }
    const result = new Map<TerrainRun, number>()
    members.forEach((m, i) => {
      const s = sums.get(find(i))
      let h = s ? s.sum / s.count : m.run.top
      if (m.run.waterLevel === null && m.run.top >= shoreLevel) h = Math.min(h, shoreLevel)
      result.set(m.run, h)
    })
    this.cornerCache.set(key, result)
    return result
  }

  /** Run from voxel `start` to voxel `end` (inclusive); `top` counts a wedge's partial height. */
  private makeRun(
    start: number,
    end: number,
    topVoxel: Voxel,
    waterLevel: number | null,
  ): TerrainRun {
    const c = voxelTopCorners(topVoxel)
    const topFraction = (c[0] + c[1] + c[2] + c[3]) / 4
    return { bottom: this.bottomOf(start), top: end + topFraction, topY: end, waterLevel }
  }

  /** Water surface level when voxel (x, y, z) starts a water column, else null. */
  private waterSurfaceFrom(x: number, y: number, z: number): number | null {
    if (!this.isWater(this.map.get(x, y, z))) return null
    let top = y
    while (top < this.yMax + CHUNK_LIMIT && this.isWater(this.map.get(x, top + 1, z))) top++
    return top + 1
  }

  /** A run starting at the window's first voxel may continue below it. */
  private bottomOf(start: number): number {
    return start === this.yMin ? -Infinity : start
  }
}

/**
 * Whether run `a` (in a column whose runs are `aRuns`) and run `b` (column
 * `bRuns`) of two different cells form one continuous terrain surface.
 */
export function connects(
  a: TerrainRun,
  aRuns: readonly TerrainRun[],
  b: TerrainRun,
  bRuns: readonly TerrainRun[],
): boolean {
  const [low, lowRuns, high] = a.top <= b.top ? [a, aRuns, b] : [b, bRuns, a]
  if (high.top - low.top > MAX_FACET_RISE) return false
  // The higher column must be solid from the lower top up to its own top.
  if (high.bottom > low.top) return false
  // Nothing may sit on the lower run below the higher top (no roof over it).
  const above = lowRuns.find((r) => r.bottom > low.topY)
  return !above || above.bottom >= high.top
}

/**
 * Diagonal splitting a facet into two triangles: 0 = c00-c11, 1 = c10-c01.
 * Picks the diagonal whose ends are closest in height, which keeps facets
 * convex-looking (valleys and ridges follow the terrain). Ties use 0.
 */
export function facetDiagonal(h: FacetCorners): 0 | 1 {
  return Math.abs(h[1] - h[3]) < Math.abs(h[0] - h[2]) ? 1 : 0
}

/**
 * Height (levels) of a facet at (fx, fz) in [0, 1]^2, following the
 * triangle split of {@link facetDiagonal}.
 */
export function facetHeightAt(h: FacetCorners, fx: number, fz: number): number {
  const [h00, h10, h11, h01] = h
  if (facetDiagonal(h) === 0) {
    if (fz <= fx) return h00 + (h10 - h00) * (fx - fz) + (h11 - h00) * fz
    return h00 + (h01 - h00) * (fz - fx) + (h11 - h00) * fx
  }
  if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz
  return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz)
}

/** Material of the voxel at level `level` in column (x, z), or 0. */
export function materialAtLevel(map: VoxelMap, x: number, level: number, z: number): number {
  return materialOf(map.get(x, Math.floor(level), z))
}
