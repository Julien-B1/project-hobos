/**
 * Walk area: where a character can stand on a voxel map, and how it moves
 * from one standing spot to the next.
 *
 * Layer: core (pure TypeScript, unit-tested).
 *
 * A *stand* is a surface voxel (see `surface.ts`) a character can stand on:
 * - the voxel is solid and neither water nor foliage (canopies are not
 *   floors);
 * - the {@link CLEARANCE} voxels above it are free: air, or water no
 *   deeper than {@link WADING_DEPTH} levels (one wades through a ford).
 * Its coordinates are those of the surface voxel: feet at level `y + 1`.
 *
 * Moves go to the 8 neighbouring columns, to a stand at most
 * {@link MAX_STEP} levels higher or lower. A diagonal move also needs both
 * orthogonal neighbours to be reachable, so a path never cuts a corner of a
 * wall or a cliff.
 */
import type { VoxelCoord } from '../coords'
import { Material, isFoliageMaterial } from '../materials'
import { WADING_DEPTH } from '../surface'
import { isAir, materialOf } from '../voxel'
import type { VoxelMap } from '../voxelMap'
import { CHUNK_SIZE } from '../coords'

/** Free levels needed above a stand (1.5 world units: a character's height). */
export const CLEARANCE = 3

/** Largest height difference between neighbouring stands, in levels (1 world unit). */
export const MAX_STEP = 2

/** A standing spot: the surface voxel under the feet. */
export type Stand = VoxelCoord

/** Horizontal neighbour offsets: 4 orthogonal first, then 4 diagonal. */
const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
]

/** Key of a stand in maps and sets. */
export function standKey(s: Stand): string {
  return `${s.x},${s.y},${s.z}`
}

/** Whether the surface voxel at (x, y, z) is a stand (see the module comment). */
export function isStand(map: VoxelMap, x: number, y: number, z: number): boolean {
  const voxel = map.get(x, y, z)
  if (isAir(voxel)) return false
  const material = materialOf(voxel)
  if (material === Material.WATER || isFoliageMaterial(material)) return false
  for (let dy = 1; dy <= CLEARANCE; dy++) {
    const above = map.get(x, y + dy, z)
    if (isAir(above)) continue
    if (materialOf(above) !== Material.WATER || dy > WADING_DEPTH) return false
  }
  return true
}

/** Every stand of a map, with moves between them, built lazily per column. */
export class WalkArea {
  /** Stand levels per column, bottom to top. */
  private readonly columns = new Map<string, readonly number[]>()
  /** Lowest and highest voxel level stored in the map. */
  private readonly yMin: number
  private readonly yMax: number
  /** Horizontal extent of the stored chunks, in voxels (inclusive). */
  readonly bounds: {
    readonly minX: number
    readonly maxX: number
    readonly minZ: number
    readonly maxZ: number
  }

  constructor(private readonly map: VoxelMap) {
    let cyMin = Infinity
    let cyMax = -Infinity
    let cxMin = Infinity
    let cxMax = -Infinity
    let czMin = Infinity
    let czMax = -Infinity
    for (const c of map.chunks()) {
      cyMin = Math.min(cyMin, c.cy)
      cyMax = Math.max(cyMax, c.cy)
      cxMin = Math.min(cxMin, c.cx)
      cxMax = Math.max(cxMax, c.cx)
      czMin = Math.min(czMin, c.cz)
      czMax = Math.max(czMax, c.cz)
    }
    const empty = cyMin > cyMax
    this.yMin = empty ? 0 : cyMin * CHUNK_SIZE
    this.yMax = empty ? -1 : (cyMax + 1) * CHUNK_SIZE - 1
    this.bounds = empty
      ? { minX: 0, maxX: -1, minZ: 0, maxZ: -1 }
      : {
          minX: cxMin * CHUNK_SIZE,
          maxX: (cxMax + 1) * CHUNK_SIZE - 1,
          minZ: czMin * CHUNK_SIZE,
          maxZ: (czMax + 1) * CHUNK_SIZE - 1,
        }
  }

  /** Stand levels of column (x, z), bottom to top. */
  standsAt(x: number, z: number): readonly number[] {
    const key = `${x},${z}`
    let levels = this.columns.get(key)
    if (!levels) {
      const found: number[] = []
      for (let y = this.yMin; y <= this.yMax; y++) {
        if (isStand(this.map, x, y, z)) found.push(y)
      }
      levels = found
      this.columns.set(key, levels)
    }
    return levels
  }

  /** Forget cached columns (after the map changed). */
  invalidate(): void {
    this.columns.clear()
  }

  /**
   * Stand of column (x, z) closest in height to level `y`, at most
   * {@link MAX_STEP} levels away; null when there is none.
   */
  nearestStand(x: number, y: number, z: number): Stand | null {
    let best: number | null = null
    for (const level of this.standsAt(x, z)) {
      if (Math.abs(level - y) > MAX_STEP) continue
      if (best === null || Math.abs(level - y) < Math.abs(best - y)) best = level
    }
    return best === null ? null : { x, y: best, z }
  }

  /** Stands reachable in one move from `s`, with the length of the move (cells). */
  neighbours(s: Stand): { stand: Stand; cost: number }[] {
    const out: { stand: Stand; cost: number }[] = []
    const orthogonal = new Map<string, Stand>()
    for (const [dx, dz] of NEIGHBOURS) {
      const diagonal = dx !== 0 && dz !== 0
      if (diagonal) {
        // Both orthogonal steps must be possible: no corner cutting.
        if (!orthogonal.has(`${dx},0`) || !orthogonal.has(`0,${dz}`)) continue
      }
      const next = this.nearestStand(s.x + dx, s.y, s.z + dz)
      if (!next) continue
      if (!diagonal) orthogonal.set(`${dx},${dz}`, next)
      out.push({ stand: next, cost: diagonal ? Math.SQRT2 : 1 })
    }
    return out
  }

  /**
   * Shortest path from `from` to `to` (A*), both ends included; null when
   * `to` cannot be reached. Searches at most `maxNodes` stands.
   */
  findPath(from: Stand, to: Stand, maxNodes = 20000): Stand[] | null {
    const goal = standKey(to)
    const start = standKey(from)
    if (start === goal) return [from]
    const heuristic = (s: Stand): number => {
      const dx = Math.abs(s.x - to.x)
      const dz = Math.abs(s.z - to.z)
      // Octile distance: exact on an empty grid, never overestimates.
      return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz)
    }
    const open = new MinHeap<Stand>()
    const cost = new Map<string, number>([[start, 0]])
    const parent = new Map<string, Stand>()
    const closed = new Set<string>()
    open.push(from, heuristic(from))
    while (closed.size < maxNodes) {
      const current = open.pop()
      if (!current) break
      const key = standKey(current)
      if (closed.has(key)) continue
      if (key === goal) return rebuild(parent, current)
      closed.add(key)
      const base = cost.get(key) ?? 0
      for (const { stand, cost: step } of this.neighbours(current)) {
        const k = standKey(stand)
        if (closed.has(k)) continue
        // A small extra for climbing or dropping: flat detours win ties.
        const g = base + step + 0.1 * Math.abs(stand.y - current.y)
        if (g >= (cost.get(k) ?? Infinity)) continue
        cost.set(k, g)
        parent.set(k, current)
        open.push(stand, g + heuristic(stand))
      }
    }
    return null
  }

  /**
   * Stands connected to `from` (flood fill over moves), `from` included.
   */
  region(from: Stand): Stand[] {
    const seen = new Set<string>([standKey(from)])
    const out: Stand[] = [from]
    // Iterating an array while pushing to it visits the new items too.
    for (const current of out) {
      for (const { stand } of this.neighbours(current)) {
        const k = standKey(stand)
        if (seen.has(k)) continue
        seen.add(k)
        out.push(stand)
      }
    }
    return out
  }

  /**
   * Where to put a character at start: a stand on `material` (grass by
   * default) in the largest connected walkable region, the closest to
   * (x, z). Null when the map has no such stand.
   */
  spawnPoint(x: number, z: number, material: number = Material.GRASS): Stand | null {
    const { minX, maxX, minZ, maxZ } = this.bounds
    const seen = new Set<string>()
    let largest: Stand[] = []
    for (let cz = minZ; cz <= maxZ; cz++) {
      for (let cx = minX; cx <= maxX; cx++) {
        for (const y of this.standsAt(cx, cz)) {
          const stand = { x: cx, y, z: cz }
          if (seen.has(standKey(stand))) continue
          const region = this.region(stand)
          for (const s of region) seen.add(standKey(s))
          if (region.length > largest.length) largest = region
        }
      }
    }
    let best: Stand | null = null
    let bestDistance = Infinity
    for (const s of largest) {
      if (materialOf(this.map.get(s.x, s.y, s.z)) !== material) continue
      // Away from water and cliffs: every neighbour must be walkable too.
      if (this.neighbours(s).length < NEIGHBOURS.length) continue
      const d = (s.x + 0.5 - x) ** 2 + (s.z + 0.5 - z) ** 2
      if (d < bestDistance) {
        bestDistance = d
        best = s
      }
    }
    return best
  }
}

/** Path from the start to `end`, following the parent links. */
function rebuild(parent: ReadonlyMap<string, Stand>, end: Stand): Stand[] {
  const path = [end]
  let current = parent.get(standKey(end))
  while (current) {
    path.push(current)
    current = parent.get(standKey(current))
  }
  return path.reverse()
}

/** Binary min-heap of items by priority. */
class MinHeap<T> {
  private readonly items: T[] = []
  private readonly priorities: number[] = []

  get size(): number {
    return this.items.length
  }

  push(item: T, priority: number): void {
    this.items.push(item)
    this.priorities.push(priority)
    let i = this.items.length - 1
    while (i > 0) {
      const up = (i - 1) >> 1
      if ((this.priorities[up] ?? 0) <= priority) break
      this.swap(i, up)
      i = up
    }
  }

  pop(): T | undefined {
    const top = this.items[0]
    const lastItem = this.items.pop()
    const lastPriority = this.priorities.pop()
    if (this.items.length > 0 && lastItem !== undefined && lastPriority !== undefined) {
      this.items[0] = lastItem
      this.priorities[0] = lastPriority
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < this.items.length && (this.priorities[l] ?? 0) < (this.priorities[m] ?? 0)) m = l
        if (r < this.items.length && (this.priorities[r] ?? 0) < (this.priorities[m] ?? 0)) m = r
        if (m === i) break
        this.swap(i, m)
        i = m
      }
    }
    return top
  }

  private swap(a: number, b: number): void {
    const item = this.items[a] as T
    this.items[a] = this.items[b] as T
    this.items[b] = item
    const p = this.priorities[a] ?? 0
    this.priorities[a] = this.priorities[b] ?? 0
    this.priorities[b] = p
  }
}
