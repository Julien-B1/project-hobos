/**
 * Materials of the chunk render layers.
 *
 * Layer: render. One material per layer (see `MESH_LAYERS`), shared by every
 * chunk. Terrain and blocks use vertex colours for now; water is a separate
 * layer so it can get its own (transparent) material.
 */
import { MeshStandardMaterial } from 'three/webgpu'
import type { LayerMaterials } from './chunkRenderer'

/** Create the materials of the three render layers. */
export function createLayerMaterials(): LayerMaterials {
  return {
    terrain: new MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }),
    blocks: new MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }),
    water: new MeshStandardMaterial({ vertexColors: true, roughness: 0.3 }),
  }
}
