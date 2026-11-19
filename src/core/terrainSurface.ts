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
 *   a cliff joins the cliff top (the cliff becomes a steep facet). Around an
 *   opening (a corner touched by a covered run: cave or arch floor), runs
 *   only join when they agree on that covered run, so the ground in front of
 *   a cave mouth stays level with its floor and the hill keeps a vertical
 *   face around the mouth instead of sloping across it.
 * - The group's height is the mean of its run tops. All cells sharing the
 *   corner read the same value, so facets join without gaps.
 * - Water is not terrain: beds blend with the banks like any ground, so a
 *   bank slopes on under the water and the shoreline is where the facets
 *   cross the flat water plane drawn by the mesher.
 */
import { VOXEL_HEIGHT } from './coords'
import { Material } from './materials'
import { hash01 } from './noise'
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
  /** Material id of the top voxel (0 when the top is above the scanned window). */
  readonly material: number
}

/**
 * Terrain materials blended by the renderer, in channel order. A vertex
 * carries one weight per channel (see {@link TerrainField.cornerWeights}).
 */
export const TERRAIN_CHANNELS: readonly number[] = [
  Material.GRASS,
  Material.DIRT,
  Material.SAND,
  Material.ROCK,
  Material.STONE,
  Material.PATH,
]

/** Channel of a material in {@link TERRAIN_CHANNELS}; unknown materials count as dirt. */
export function terrainChannel(material: number): number {
  const i = TERRAIN_CHANNELS.indexOf(material)
  return i >= 0 ? i : 1
}

/** Weights (summing to 1) of every terrain channel for one material. */
export function oneHotWeights(material: number): number[] {
  const w: number[] = TERRAIN_CHANNELS.map(() => 0)
  w[terrainChannel(material)] = 1
  return w
}

/** Height, blended material weights and group of a run at one corner. */
interface CornerValue {
  readonly height: number
  readonly weights: readonly number[]
  /** Id of the connected group at this lattice point (shared by its members). */
  readonly group: number
}

/** A direction in world space (x, y, z). */
export type Direction3 = readonly [number, number, number]

/** Corner heights of a run's top, in levels: [c00, c10, c11, c01] (see `shapes.ts`). */
export type FacetCorners = readonly [number, number, number, number]

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
  private readonly cornerCache = new Map<string, Map<TerrainRun, CornerValue>>()
  private readonly normalCache = new Map<string, Direction3>()

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
        runs.push(this.makeRun(start, y - 1, lastVoxel))
        start = null
      }
    }
    if (start !== null) {
      runs.push({ bottom: this.bottomOf(start), top: Infinity, topY: this.yMax, material: 0 })
    }
    this.runsCache.set(key, runs)
    return runs
  }

  /**
   * Material weights of a run's top at its 4 corners, in `FacetCorners`
   * order. Each corner averages the top materials of the connected runs
   * around it (the same groups as the heights), so neighbouring cells agree
   * and material transitions are continuous instead of following cells.
   */
  cornerWeights(x: number, z: number, run: TerrainRun): (readonly number[])[] {
    return CELL_CORNERS.map(
      ([dx, dz]) =>
        this.cornerGroups(x + dx, z + dz).get(run)?.weights ?? oneHotWeights(run.material),
    )
  }

  /** Corner heights (levels) of a run's top in cell (x, z). */
  cornerHeights(x: number, z: number, run: TerrainRun): FacetCorners {
    const h = CELL_CORNERS.map(([dx, dz]) => this.cornerHeight(x + dx, z + dz, run))
    return [h[0] ?? run.top, h[1] ?? run.top, h[2] ?? run.top, h[3] ?? run.top]
  }

  /**
   * Smooth shading normals of a run's top at its 4 corners, in
   * `FacetCorners` order (world space, unit length, pointing up).
   *
   * Each corner averages the facets of every run in its connected group
   * around the lattice point (see {@link facetCornerNormal}), so the
   * neighbouring cells, including those of other chunks, compute the same
   * normal there: lighting is continuous across facets and chunk borders,
   * while the geometry stays low-poly. Walls and undersides are not part of
   * any group and keep their flat normals (sharp cliff edges).
   */
  cornerNormals(x: number, z: number, run: TerrainRun): Direction3[] {
    return CELL_CORNERS.map(([dx, dz]) => this.latticeNormal(x + dx, z + dz, run))
  }

  /** Normal of `run`'s group at lattice point (cx, cz), cached per group. */
  private latticeNormal(cx: number, cz: number, run: TerrainRun): Direction3 {
    const groups = this.cornerGroups(cx, cz)
    const mine = groups.get(run)
    const key = `${cx},${cz},${mine?.group ?? -1}`
    const cached = mine ? this.normalCache.get(key) : undefined
    if (cached) return cached

    let nx = 0
    let ny = 0
    let nz = 0
    for (const [dx, dz] of CELLS_AROUND_CORNER) {
      const x = cx + dx
      const z = cz + dz
      // Index of the lattice point among this cell's corners.
      const corner = CELL_CORNERS.findIndex(([ox, oz]) => x + ox === cx && z + oz === cz)
      for (const other of this.runsAt(x, z)) {
        if (!Number.isFinite(other.top)) continue
        const same = other === run || (mine && groups.get(other)?.group === mine.group)
        if (!same) continue
        const n = facetCornerNormal(this.cornerHeights(x, z, other), corner as 0 | 1 | 2 | 3)
        nx += n[0]
        ny += n[1]
        nz += n[2]
      }
    }
    const len = Math.hypot(nx, ny, nz)
    const normal: Direction3 = len > 0 ? [nx / len, ny / len, nz / len] : [0, 1, 0]
    if (mine) this.normalCache.set(key, normal)
    return normal
  }

  /**
   * Corner heights (levels) of the underside of an overhanging run (cave or
   * arch roof) in cell (x, z), in `FacetCorners` order.
   *
   * The underside is vaulted: a corner touching a cell that is solid just
   * under the roof (the opening's side wall) drops by about half the
   * opening's height, and every corner gets a small random offset, so an
   * opening is an irregular arch instead of a rectangle. Cells sharing a
   * lattice point compute the same value when their roofs and floors are at
   * the same levels (the usual case along a tunnel).
   */
  cornerBottoms(x: number, z: number, run: TerrainRun): FacetCorners {
    const b = CELL_CORNERS.map(([dx, dz]) => this.cornerBottom(x, z, x + dx, z + dz, run))
    return [b[0] ?? run.bottom, b[1] ?? run.bottom, b[2] ?? run.bottom, b[3] ?? run.bottom]
  }

  /** Underside height of `run` (column x, z) at lattice point (cx, cz). */
  private cornerBottom(x: number, z: number, cx: number, cz: number, run: TerrainRun): number {
    if (!Number.isFinite(run.bottom)) return run.bottom
    // Floor of the opening: top of the run right below in the same column.
    let floor = -Infinity
    for (const r of this.runsAt(x, z)) if (r.top <= run.bottom) floor = Math.max(floor, r.top)
    // No floor below: not an opening (e.g. the map's own bottom), keep it flat.
    if (!Number.isFinite(floor)) return run.bottom
    const gap = run.bottom - floor
    // Solid just under the roof in a cell around the corner: a side wall.
    const probe = run.bottom - 0.5
    const walled = CELLS_AROUND_CORNER.some(([dx, dz]) =>
      this.runsAt(cx + dx, cz + dz).some((r) => r.bottom < probe && r.top > probe),
    )
    const jitter = (hash01(cx, cz, 977 + run.bottom) - 0.5) * Math.min(1, gap * 0.25)
    const dropped = run.bottom - (walled ? gap * 0.5 : 0) + jitter
    // Stay above the floor and below the run's own top.
    return Math.min(Math.max(dropped, floor + Math.min(1.5, gap * 0.5)), run.top - 0.25)
  }

  /** Height (levels) of `run` at lattice point (cx, cz); the run must belong to a cell around it. */
  private cornerHeight(cx: number, cz: number, run: TerrainRun): number {
    const h = this.cornerGroups(cx, cz).get(run)?.height ?? run.top
    // An overhanging run must not be pulled below its own bottom (plus the
    // largest upward jitter of its vaulted underside).
    return Number.isFinite(run.bottom) ? Math.max(h, run.bottom + 0.75) : h
  }

  /** Group heights of every run around lattice point (cx, cz), cached. */
  private cornerGroups(cx: number, cz: number): Map<TerrainRun, CornerValue> {
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
    const linked = (i: number, j: number): boolean => {
      const a = members[i]
      const b = members[j]
      if (!a || !b || a.cell === b.cell) return false
      return connects(a.run, a.runs, b.run, b.runs)
    }
    // Covered members: runs with a roof above them (cave or arch floors).
    const covered = members
      .map((m, i) => (m.runs.some((r) => r.bottom > m.run.topY) ? i : -1))
      .filter((i) => i >= 0)
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        if (!linked(i, j)) continue
        // Openings: two runs only join if they agree on every covered run
        // around the corner. Otherwise the open ground in front of a cave
        // mouth would chain the cave floor to the hill top (ground joins
        // both), lifting the floor and closing the mouth. With this rule the
        // ground stays level with the floor there and the hill keeps a
        // vertical face around the opening.
        const agree = covered.every((k) => k === i || k === j || linked(i, k) === linked(j, k))
        if (agree) parent[find(i)] = find(j)
      }
    }
    const sums = new Map<number, { sum: number; count: number; weights: number[] }>()
    // Group ids: the union-find roots (indices into `members`).
    members.forEach((m, i) => {
      const root = find(i)
      const s = sums.get(root) ?? { sum: 0, count: 0, weights: TERRAIN_CHANNELS.map(() => 0) }
      s.sum += m.run.top
      s.count++
      const channel = terrainChannel(m.run.material)
      s.weights[channel] = (s.weights[channel] ?? 0) + 1
      sums.set(root, s)
    })
    const result = new Map<TerrainRun, CornerValue>()
    members.forEach((m, i) => {
      const s = sums.get(find(i))
      const group = find(i)
      result.set(
        m.run,
        s
          ? { height: s.sum / s.count, weights: s.weights.map((w) => w / s.count), group }
          : { height: m.run.top, weights: oneHotWeights(m.run.material), group },
      )
    })
    this.cornerCache.set(key, result)
    return result
  }

  /** Run from voxel `start` to voxel `end` (inclusive); `top` counts a wedge's partial height. */
  private makeRun(start: number, end: number, topVoxel: Voxel): TerrainRun {
    const c = voxelTopCorners(topVoxel)
    const topFraction = (c[0] + c[1] + c[2] + c[3]) / 4
    return {
      bottom: this.bottomOf(start),
      top: end + topFraction,
      topY: end,
      material: materialOf(topVoxel),
    }
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
 * Contribution of one facet to the smooth normal at one of its corners
 * (world space, not normalised, pointing up).
 *
 * The facet is the cell's two triangles (split by {@link facetDiagonal}) in
 * world units (heights times `VOXEL_HEIGHT`). A corner on the diagonal
 * touches both triangles and gets their mean; the other corners touch one.
 * Every cell thus weighs the same in the average around a lattice point
 * (each covers a right angle there), and the vertical component is always 1:
 * summing contributions averages the height gradients.
 */
export function facetCornerNormal(h: FacetCorners, corner: 0 | 1 | 2 | 3): Direction3 {
  const triangles: readonly (readonly [number, number, number])[] =
    facetDiagonal(h) === 0
      ? [
          [0, 1, 2],
          [0, 2, 3],
        ]
      : [
          [1, 2, 3],
          [1, 3, 0],
        ]
  const touching = triangles.filter((t) => t.includes(corner))
  let nx = 0
  let ny = 0
  let nz = 0
  for (const t of touching) {
    const [a, b, c] = t.map((i) => {
      const [ox, oz] = CELL_CORNERS[i] ?? [0, 0]
      return [ox, h[i as 0 | 1 | 2 | 3] * VOXEL_HEIGHT, oz] as const
    }) as [Direction3, Direction3, Direction3]
    const u: Direction3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const v: Direction3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    let cx = u[1] * v[2] - u[2] * v[1]
    let cy = u[2] * v[0] - u[0] * v[2]
    let cz = u[0] * v[1] - u[1] * v[0]
    // Every triangle covers half a cell: |cy| = 1. Orient it upwards.
    if (cy < 0) {
      cx = -cx
      cy = -cy
      cz = -cz
    }
    nx += cx
    ny += cy
    nz += cz
  }
  const k = 1 / Math.max(1, touching.length)
  return [nx * k, ny * k, nz * k]
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
