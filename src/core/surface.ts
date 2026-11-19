/**
 * Surfaces: the tops of voxels that something could stand on.
 *
 * Layer: core (pure TypeScript).
 *
 * Definition used throughout the project: a *surface* is the top of a
 * non-air voxel whose voxel directly above is air. A column (x, z) can hold
 * several surfaces at different heights, e.g. a path under a bridge: this is
 * the multi-level case the map must support. Clearance (head room) is not
 * checked here; navigation will add that later.
 */
import { isAir } from './voxel'
import type { VoxelMap } from './voxelMap'

/**
 * Voxel levels `y` in column (x, z) whose top is a surface, scanning
 * `yMin..yMax` inclusive, from bottom to top.
 */
export function columnSurfaces(
  map: VoxelMap,
  x: number,
  z: number,
  yMin: number,
  yMax: number,
): number[] {
  const levels: number[] = []
  for (let y = yMin; y <= yMax; y++) {
    if (!isAir(map.get(x, y, z)) && isAir(map.get(x, y + 1, z))) levels.push(y)
  }
  return levels
}
