/**
 * Hybrid mesher: smooth natural terrain, blocky built and fluid voxels.
 *
 * Layer: render (no Three.js import). Combines two meshers into one chunk
 * mesh:
 * - natural materials (`isNaturalMaterial`: grass, dirt, rock, ...) go
 *   through the `SurfaceNetsMesher` (smooth hills, rounded corners);
 * - everything else (wood, water) goes through the `CulledMesher`, so built
 *   structures and stairs keep sharp edges and water stays flat.
 *
 * Occlusion rules for the blocky part:
 * - water hides its faces against any solid voxel (no water walls poking
 *   through smooth banks, whose surface does not follow voxel faces);
 * - other blocks hide a face only against a FULL face of another blocky
 *   voxel. Faces against smooth terrain are kept: the smooth surface can
 *   recede inside the cell and would otherwise leave a gap.
 */
import { Material, isNaturalMaterial } from '@/core/materials'
import { FaceProfile, faceProfile, oppositeFace } from '@/core/shapes'
import { isAir, materialOf, type Voxel } from '@/core/voxel'
import type { Chunk } from '@/core/chunk'
import type { VoxelMap } from '@/core/voxelMap'
import { CulledMesher } from './culledMesher'
import { mergeMeshData } from './meshBuilder'
import type { ChunkMesher, ColorLookup, MeshData } from './mesher'
import { SurfaceNetsMesher } from './surfaceNetsMesher'

const isNatural = (voxel: Voxel): boolean => isNaturalMaterial(materialOf(voxel))

/** Smooth terrain plus blocky structures, in one mesh per chunk. */
export class HybridMesher implements ChunkMesher {
  private readonly smooth: SurfaceNetsMesher
  private readonly blocky: CulledMesher

  /** @param colorOf Linear RGB colour of a material id. */
  constructor(colorOf: ColorLookup) {
    this.smooth = new SurfaceNetsMesher({ include: isNatural, colorOf })
    this.blocky = new CulledMesher(colorOf, {
      include: (voxel) => !isNatural(voxel),
      occludes: (self, neighbour, face) => {
        if (isAir(neighbour)) return false
        if (materialOf(self) === Material.WATER) return true
        if (isNatural(neighbour)) return false
        return faceProfile(neighbour, oppositeFace(face)) === FaceProfile.FULL
      },
    })
  }

  /** Mesh both parts of the chunk and merge them. */
  mesh(map: VoxelMap, chunk: Chunk): MeshData {
    return mergeMeshData([this.smooth.mesh(map, chunk), this.blocky.mesh(map, chunk)])
  }
}
