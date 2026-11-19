/**
 * Coordinate conventions and conversions between world space and grid cells.
 *
 * Layer: core (pure TypeScript).
 *
 * Conventions (shared by the whole project):
 * - World frame follows Three.js: Y is up, the ground plane is (x, z).
 * - One horizontal cell is 1 world unit: cell (x, z) covers
 *   [x, x + 1) x [z, z + 1) in world units.
 * - One voxel is {@link VOXEL_HEIGHT} world units tall; voxel level `y`
 *   covers world heights [y * VOXEL_HEIGHT, (y + 1) * VOXEL_HEIGHT).
 */

/** Height of one voxel in world units (a "half step"). Two voxels = one full-height wall. */
export const VOXEL_HEIGHT = 0.5

/** Integer cell coordinates on the ground plane. */
export interface CellCoord {
  readonly x: number
  readonly z: number
}

/**
 * Cell containing a world position on the ground plane.
 *
 * Uses `Math.floor`, not truncation, so negative positions map correctly:
 * world x = -0.25 lies in cell -1, not cell 0.
 */
export function worldToCell(worldX: number, worldZ: number): CellCoord {
  return { x: Math.floor(worldX), z: Math.floor(worldZ) }
}

/** Voxel level containing a world height (floor division by {@link VOXEL_HEIGHT}). */
export function worldToLevel(worldY: number): number {
  return Math.floor(worldY / VOXEL_HEIGHT)
}

/** World height of the bottom of voxel level `y`. */
export function levelToWorld(y: number): number {
  return y * VOXEL_HEIGHT
}
