/**
 * Flat test map: a one-voxel-thick checkerboard floor.
 *
 * Layer: core (pure TypeScript). Successor of the step 1 flat grid, now
 * expressed as voxels so it goes through the same meshing and picking as
 * every other map. Useful to check the camera and picking on trivial terrain
 * (`?map=flat`).
 */
import { Material } from '../materials'
import { packVoxel } from '../voxel'
import { VoxelMap } from '../voxelMap'

/**
 * Build a `width` x `depth` floor at voxel level 0, alternating grass and dirt
 * like a checkerboard. Cells cover [0, width) x [0, depth).
 *
 * @throws RangeError when a dimension is not a positive integer.
 */
export function createFlatMap(width = 32, depth = 32): VoxelMap {
  if (!Number.isInteger(width) || !Number.isInteger(depth) || width <= 0 || depth <= 0) {
    throw new RangeError(`Invalid map size ${width} x ${depth}`)
  }
  const map = new VoxelMap()
  const light = packVoxel(Material.GRASS)
  const dark = packVoxel(Material.DIRT)
  for (let z = 0; z < depth; z++) {
    for (let x = 0; x < width; x++) map.set(x, 0, z, (x + z) % 2 === 0 ? light : dark)
  }
  return map
}
