/**
 * Materials of the chunk render layers.
 *
 * Layer: render. One material per layer (see `MESH_LAYERS`), shared by every
 * chunk: procedural terrain (`terrainMaterial.ts`), patterned blocks
 * (`blocksMaterial.ts`), the
 * translucent water surface (`waterMaterial.ts`), the leaf cards
 * (`foliageMaterial.ts`) and the ground decoration (`scatterMaterial.ts`). The ground layers draw the battle-map grid, whose
 * opacity uniform is returned with them.
 */
import { positionWorld, uniform } from 'three/tsl'
import type { UniformNode } from 'three/webgpu'
import type { LayerMaterials } from './chunkRenderer'
import { createDetailTexture } from './detailTexture'
import { createFoliageMaterial } from './foliageMaterial'
import { createGridOpacity, type GridOpacity } from './gridOverlay'
import { createLeafTexture } from './leafTexture'
import { createLightUniforms, type LightUniforms } from './lightUniforms'
import { createNoiseTexture } from './noiseTexture'
import { createPropsMaterial, createScatterMaterial } from './scatterMaterial'
import { createBlocksMaterial } from './blocksMaterial'
import { createTerrainMaterial } from './terrainMaterial'
import { createWaterMaterial } from './waterMaterial'

/** Layer materials and the controls they share. */
export interface LayerMaterialSet {
  readonly materials: LayerMaterials
  /** Grid opacity (1 visible, 0 hidden), read by the terrain, blocks and water shaders. */
  readonly gridOpacity: GridOpacity
  /** Main light values for shader-side light effects (water sheen). */
  readonly light: LightUniforms
  /**
   * Cut height in world units: every layer discards what lies above it
   * (also in the shadow pass), to open caves and look under roofs.
   * {@link NO_CUT} shows everything.
   */
  readonly cutHeight: UniformNode<'float'>
}

/** Cut height that hides nothing. */
export const NO_CUT = 1e6

/** Create the materials of the render layers. */
export function createLayerMaterials(gridVisible: boolean): LayerMaterialSet {
  // Textures generated once and shared by the procedural materials.
  const noise = createNoiseTexture()
  const detail = createDetailTexture()
  const leaves = createLeafTexture()
  const gridOpacity = createGridOpacity(gridVisible)
  const light = createLightUniforms()
  const cutHeight = uniform(NO_CUT)
  const materials = {
    terrain: createTerrainMaterial(noise, detail, gridOpacity),
    blocks: createBlocksMaterial(noise, gridOpacity),
    water: createWaterMaterial(noise, gridOpacity, light),
    foliage: createFoliageMaterial(leaves),
    scatter: createScatterMaterial(leaves),
    props: createPropsMaterial(noise),
  }
  // One mask for every layer: keep only what lies below the cut.
  for (const material of Object.values(materials)) {
    material.maskNode = positionWorld.y.lessThan(cutHeight)
  }
  return { materials, gridOpacity, light, cutHeight }
}
