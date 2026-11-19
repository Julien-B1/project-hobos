/**
 * Hybrid mesher: faceted terrain, blocky structures, vegetation and water.
 *
 * Layer: render (no Three.js import). Combines two meshers into one chunk
 * mesh:
 * - terrain materials (`isTerrainMaterial`: grass, dirt, rock, ...) go
 *   through the `TerrainMesher` (faceted low-poly height surface);
 * - everything else (wood, leaves, water) goes through the `CulledMesher`,
 *   so built structures and stairs keep sharp edges and water stays flat.
 *
 * Occlusion rules for the blocky part:
 * - water hides its faces against any solid voxel (no water walls poking
 *   through banks, whose faceted surface does not follow voxel faces);
 * - other blocks hide a face only against a FULL face of another blocky
 *   voxel. Faces against terrain are kept: the faceted surface can recede
 *   inside the cell and would otherwise leave a gap.
 */
import type { Chunk } from '@/core/chunk'
import { Material, isTerrainMaterial } from '@/core/materials'
import { FaceProfile, faceProfile, oppositeFace } from '@/core/shapes'
import { isAir, materialOf, type Voxel } from '@/core/voxel'
import type { VoxelMap } from '@/core/voxelMap'
import { CulledMesher } from './culledMesher'
import { mergeMeshData } from './meshBuilder'
import type { ChunkMesher, ColorLookup, MeshData } from './mesher'
import { TerrainMesher } from './terrainMesher'

/** True for voxels drawn by the terrain mesher. */
export const isTerrainVoxel = (voxel: Voxel): boolean => isTerrainMaterial(materialOf(voxel))

/** Faceted terrain plus blocky structures, in one mesh per chunk. */
export class HybridMesher implements ChunkMesher {
  private readonly terrain: TerrainMesher
  private readonly blocky: CulledMesher

  /** @param colorOf Linear RGB colour of a material id. */
  constructor(colorOf: ColorLookup) {
    this.terrain = new TerrainMesher({ isTerrain: isTerrainVoxel, colorOf })
    this.blocky = new CulledMesher(colorOf, {
      include: (voxel) => !isTerrainVoxel(voxel),
      occludes: (self, neighbour, face) => {
        if (isAir(neighbour)) return false
        if (materialOf(self) === Material.WATER) return true
        if (isTerrainVoxel(neighbour)) return false
        return faceProfile(neighbour, oppositeFace(face)) === FaceProfile.FULL
      },
    })
  }

  /** Mesh both parts of the chunk and merge them. */
  mesh(map: VoxelMap, chunk: Chunk): MeshData {
    return mergeMeshData([this.terrain.mesh(map, chunk), this.blocky.mesh(map, chunk)])
  }
}
