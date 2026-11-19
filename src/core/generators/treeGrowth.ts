/**
 * Tree growing for map generators: writes a tree of a given kind as voxels.
 *
 * Layer: core (pure TypeScript). The shapes match what `core/trees.ts`
 * expects (trunk topped by foliage, canopy centre per kind) and what the
 * renderer draws (`render/meshing/treeMesher.ts`).
 */
import { Material } from '../materials'
import type { TreeKind } from '../trees'
import { isAir, packVoxel } from '../voxel'
import type { VoxelMap } from '../voxelMap'

/**
 * Grow a tree of `kind` on the ground at (x, z), surface level `h`. `r` in
 * [0, 1) varies the trunk height. Canopy voxels only fill air.
 * - oak: trunk 4 to 6 voxels, round canopy (radius about 2.3 cells);
 * - pine: trunk 7 to 9, cone of needles hanging from the trunk's upper part;
 * - birch: trunk 5 to 7, narrow and tall canopy of birch leaves;
 * - bush: one trunk voxel in a low round clump.
 */
export function growTree(
  map: VoxelMap,
  x: number,
  h: number,
  z: number,
  kind: TreeKind,
  r: number,
): void {
  const trunkHeight =
    { oak: 4, pine: 7, birch: 5, bush: 1 }[kind] + (kind === 'bush' ? 0 : Math.floor(r * 3))
  const trunk = packVoxel(Material.WOOD)
  for (let y = h; y < h + trunkHeight; y++) map.set(x, y, z, trunk)
  const cy = h + trunkHeight // first level above the trunk
  const foliage = packVoxel(
    kind === 'pine' ? Material.NEEDLES : kind === 'birch' ? Material.BIRCH_LEAVES : Material.LEAVES,
  )
  const put = (dx: number, dy: number, dz: number): void => {
    if (isAir(map.get(x + dx, cy + dy, z + dz))) map.set(x + dx, cy + dy, z + dz, foliage)
  }
  for (let dy = -5; dy <= 4; dy++) {
    for (let dz = -3; dz <= 3; dz++) {
      for (let dx = -3; dx <= 3; dx++) {
        const d2 = dx * dx + dz * dz
        let inside: boolean
        switch (kind) {
          case 'oak':
            inside = dy >= -2 && dy <= 3 && d2 / 5.5 + ((dy - 0.5) * (dy - 0.5)) / 7 <= 1
            break
          case 'pine': {
            // Cone: radius shrinking from 2.6 cells at the bottom to 0.3 at the top.
            const t = (dy + 5) / 8
            const radius = 2.3 * (1 - t) + 0.3
            inside = dy <= 3 && d2 <= radius * radius
            break
          }
          case 'birch':
            inside = dy >= -2 && dy <= 4 && d2 / 2.4 + ((dy - 1) * (dy - 1)) / 10 <= 1
            break
          case 'bush':
            inside = dy >= -1 && dy <= 1 && d2 / 2.6 + ((dy + 0.3) * (dy + 0.3)) / 2.2 <= 1
            break
        }
        if (inside) put(dx, dy, dz)
      }
    }
  }
}
