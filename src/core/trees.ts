/**
 * Tree detection in the voxel map.
 *
 * Layer: core (pure TypeScript, unit-tested). Trees stay plain voxels: a
 * column of WOOD (the trunk) whose top voxel has foliage (any
 * `isFoliageMaterial`) right above it, and foliage voxels around (the
 * canopy). Game logic keeps working on these voxels; renderers use this
 * module to draw them as real trees (round trunks, foliage) instead of
 * blocks. WOOD without foliage on top (bridges, structures) is not a trunk.
 *
 * The kind of tree comes from the voxels too: the foliage material on top
 * of the trunk (needles: pine, birch leaves: birch, leaves: oak) and, for
 * broad leaves, the trunk height (a one-voxel trunk is a bush).
 */
import { Material, isFoliageMaterial } from './materials'
import { materialOf } from './voxel'
import type { VoxelMap } from './voxelMap'

/** A tree trunk: one column of WOOD voxels, voxel coordinates (inclusive). */
export interface Trunk {
  readonly x: number
  readonly z: number
  /** Voxel y of the lowest trunk voxel. */
  readonly baseY: number
  /** Voxel y of the highest trunk voxel (foliage sits at `topY + 1`). */
  readonly topY: number
  /** Foliage material right above the trunk top (sets the tree kind). */
  readonly foliage: number
}

/** Kinds of trees, see {@link treeKind}. */
export type TreeKind = 'oak' | 'pine' | 'birch' | 'bush'

/** Kind of a tree, from its foliage material and trunk height. */
export function treeKind(t: Trunk): TreeKind {
  if (t.foliage === Material.NEEDLES) return 'pine'
  if (t.foliage === Material.BIRCH_LEAVES) return 'birch'
  return t.topY === t.baseY ? 'bush' : 'oak'
}

/** Longest trunk followed downwards, in voxels. */
export const MAX_TRUNK_HEIGHT = 16

/**
 * Horizontal reach (cells) of a canopy around its trunk: leaves farther
 * than this from every trunk count as loose leaves.
 */
export const CANOPY_REACH = 4

/**
 * Trunks whose top voxel lies in the box [x0, x1] x [y0, y1] x [z0, z1]
 * (voxel coordinates, inclusive). Each trunk is followed down to its base,
 * even below `y0`.
 */
export function findTrunks(
  map: VoxelMap,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
): Trunk[] {
  const isWood = (x: number, y: number, z: number): boolean =>
    materialOf(map.get(x, y, z)) === Material.WOOD
  const trunks: Trunk[] = []
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        if (!isWood(x, y, z)) continue
        const foliage = materialOf(map.get(x, y + 1, z))
        if (!isFoliageMaterial(foliage)) continue
        let base = y
        while (base > y - MAX_TRUNK_HEIGHT + 1 && isWood(x, base - 1, z)) base--
        trunks.push({ x, z, baseY: base, topY: y, foliage })
      }
    }
  }
  return trunks
}

/** Whether voxel (x, y, z) belongs to one of `trunks`. */
export function isTrunkVoxel(trunks: readonly Trunk[], x: number, y: number, z: number): boolean {
  return trunks.some((t) => t.x === x && t.z === z && y >= t.baseY && y <= t.topY)
}

/**
 * Trunk whose canopy a leaf voxel most likely belongs to: the closest trunk
 * (horizontal distance between cell centres) within {@link CANOPY_REACH},
 * whose top is at most 8 voxels above (pine cones hang low) and 8 below the
 * leaf. Null for loose leaves.
 */
export function canopyTrunk(
  trunks: readonly Trunk[],
  x: number,
  y: number,
  z: number,
): Trunk | null {
  let best: Trunk | null = null
  let bestDistance = Infinity
  for (const t of trunks) {
    if (y < t.topY - 8 || y > t.topY + 8) continue
    const d = Math.hypot(t.x - x, t.z - z)
    if (d <= CANOPY_REACH && d < bestDistance) {
      best = t
      bestDistance = d
    }
  }
  return best
}

/** Height of the canopy centre above the trunk top voxel, in levels, per kind. */
const CANOPY_CENTRE_LEVEL: Readonly<Record<TreeKind, number>> = {
  oak: 2, // round canopy starting beside the last trunk voxels
  pine: 0, // cone hanging along the upper half of the trunk
  birch: 1.5,
  bush: 0.8,
}

/**
 * Centre of a trunk's canopy, in voxel units (cell centre in x and z,
 * level in y), for the canopy shapes the generators build (see
 * `CANOPY_CENTRE_LEVEL`).
 */
export function canopyCenter(t: Trunk): { x: number; level: number; z: number } {
  return { x: t.x + 0.5, level: t.topY + CANOPY_CENTRE_LEVEL[treeKind(t)], z: t.z + 0.5 }
}
