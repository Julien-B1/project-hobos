/**
 * Flat test grid (step 1): a rectangle of ground cells with a checker pattern.
 *
 * Layer: core (pure TypeScript). Describes data only; the render layer turns
 * it into a mesh. Replaced by the voxel reference map in step 2.
 */
import type { CellCoord } from '../coords'

/** Rectangular flat grid of cells starting at (0, 0). */
export interface FlatGrid {
  /** Number of cells along X. */
  readonly width: number
  /** Number of cells along Z. */
  readonly depth: number
  /** True when cell (x, z) belongs to the grid. */
  contains(cell: CellCoord): boolean
  /** Checker shade of a cell: 0 or 1, alternating between neighbours. */
  shade(cell: CellCoord): 0 | 1
}

/**
 * Create a `width` x `depth` grid covering cells [0, width) x [0, depth).
 *
 * @throws RangeError when a dimension is not a positive integer.
 */
export function createFlatGrid(width = 32, depth = 32): FlatGrid {
  if (!Number.isInteger(width) || !Number.isInteger(depth) || width <= 0 || depth <= 0) {
    throw new RangeError(`Invalid grid size ${width} x ${depth}`)
  }
  return {
    width,
    depth,
    contains: ({ x, z }) => x >= 0 && z >= 0 && x < width && z < depth,
    // `& 1` on a non-negative sum gives the parity; the grid has no negative cells.
    shade: ({ x, z }) => ((x + z) & 1) as 0 | 1,
  }
}
