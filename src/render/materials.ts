/**
 * Materials of the chunk render layers.
 *
 * Layer: render. One material per layer (see `MESH_LAYERS`), shared by every
 * chunk: procedural terrain and blocks (see `terrainMaterial.ts`); water is a
 * separate layer with its own material.
 */
import { MeshStandardMaterial } from 'three/webgpu'
import type { LayerMaterials } from './chunkRenderer'
import { createNoiseTexture } from './noiseTexture'
import { createBlocksMaterial, createTerrainMaterial } from './terrainMaterial'

/** Create the materials of the three render layers. */
export function createLayerMaterials(): LayerMaterials {
  // One small noise texture shared by the procedural materials.
  const noise = createNoiseTexture()
  return {
    terrain: createTerrainMaterial(noise),
    blocks: createBlocksMaterial(noise),
    water: new MeshStandardMaterial({ vertexColors: true, roughness: 0.3 }),
  }
}
