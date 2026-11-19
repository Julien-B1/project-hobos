/**
 * Hybrid mesher: faceted terrain, blocky structures, trees and water.
 *
 * Layer: render (no Three.js import). Produces the three render layers of a
 * chunk (see `MESH_LAYERS`):
 * - terrain materials (`isTerrainMaterial`: grass, dirt, rock, ...) go
 *   through the `TerrainMesher` (faceted low-poly height surface);
 * - trees (a WOOD trunk topped by LEAVES, see `core/trees.ts`) go through the
 *   `TreeMesher`: round trunks in the blocks layer, leaf cards in the
 *   foliage layer;
 * - other wood goes through the `CulledMesher`, so built structures and
 *   stairs keep sharp edges;
 * - water is drawn by the `TerrainMesher` as a flat plane, so shorelines
 *   follow the terrain facets;
 * - ground decorations (grass tufts, pebbles, reeds...) come from the
 *   `ScatterMesher` (scatter and props layers).
 *
 * Occlusion rule for the blocky part: a face is hidden only against a FULL
 * face of another blocky voxel or of water. Faces against terrain and
 * leaves are kept: the faceted surface can recede inside the cell, and
 * leaves are no longer blocks, so either would otherwise leave a gap. (A
 * block touching a tree trunk still has that face hidden: rare enough.)
 */
import type { Chunk } from '@/core/chunk'
import { Material, isFoliageMaterial, isTerrainMaterial } from '@/core/materials'
import { FaceProfile, faceProfile, oppositeFace } from '@/core/shapes'
import { isAir, materialOf, type Voxel } from '@/core/voxel'
import type { VoxelMap } from '@/core/voxelMap'
import { isTrunkVoxel } from '@/core/trees'
import { CulledMesher } from './culledMesher'
import {
  EMPTY_MESH,
  mergeMeshData,
  type ColorLookup,
  type LayeredMeshData,
  type LayeredMesher,
} from './mesher'
import { ScatterMesher } from './scatterMesher'
import { TerrainMesher } from './terrainMesher'
import { TreeMesher } from './treeMesher'

/** True for voxels drawn by the terrain mesher. */
export const isTerrainVoxel = (voxel: Voxel): boolean => isTerrainMaterial(materialOf(voxel))

/** Faceted terrain plus blocky structures, in one mesh per chunk. */
export class HybridMesher implements LayeredMesher {
  private readonly terrain: TerrainMesher
  private readonly blocky: CulledMesher
  private readonly trees: TreeMesher
  private readonly scatter: ScatterMesher

  /** @param colorOf Linear RGB colour of a material id. */
  constructor(colorOf: ColorLookup) {
    this.terrain = new TerrainMesher({ isTerrain: isTerrainVoxel, colorOf })
    this.trees = new TreeMesher(colorOf)
    this.scatter = new ScatterMesher(isTerrainVoxel)
    this.blocky = new CulledMesher(colorOf, {
      // Water is drawn by the terrain mesher as a flat plane.
      include: (voxel) => {
        const m = materialOf(voxel)
        return !isTerrainVoxel(voxel) && m !== Material.WATER && !isFoliageMaterial(m)
      },
      occludes: (_self, neighbour, face) => {
        if (isAir(neighbour) || isTerrainVoxel(neighbour)) return false
        if (isFoliageMaterial(materialOf(neighbour))) return false
        return faceProfile(neighbour, oppositeFace(face)) === FaceProfile.FULL
      },
    })
  }

  /** Mesh the layers of the chunk. */
  mesh(map: VoxelMap, chunk: Chunk): LayeredMeshData {
    const { terrain, water } = this.terrain.mesh(map, chunk)
    const trees = this.trees.mesh(map, chunk)
    const blocks = this.blocky.mesh(
      map,
      chunk,
      (voxel, x, y, z) =>
        trees.trunks.length === 0 ||
        materialOf(voxel) !== Material.WOOD ||
        !isTrunkVoxel(trees.trunks, x, y, z),
    )
    const decoration = this.scatter.mesh(map, chunk)
    return {
      terrain,
      water,
      blocks: mergeMeshData(blocks, trees.bark),
      foliage: trees.foliage,
      scatter: decoration.cards,
      props: decoration.props,
    }
  }
}

/** Every voxel as its exact block shape (debug mode `?mesher=blocky`), in the blocks layer. */
export class BlockyMesher implements LayeredMesher {
  private readonly culled: CulledMesher

  /** @param colorOf Linear RGB colour of a material id. */
  constructor(colorOf: ColorLookup) {
    this.culled = new CulledMesher(colorOf)
  }

  /** Mesh the chunk as blocks only. */
  mesh(map: VoxelMap, chunk: Chunk): LayeredMeshData {
    return {
      terrain: EMPTY_MESH,
      water: EMPTY_MESH,
      blocks: this.culled.mesh(map, chunk),
      foliage: EMPTY_MESH,
      scatter: EMPTY_MESH,
      props: EMPTY_MESH,
    }
  }
}
