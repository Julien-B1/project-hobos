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
import { GreaterEqualStencilFunc, KeepStencilOp, type UniformNode } from 'three/webgpu'
import { STENCIL_BASE } from './sectionCap'
import type { LayerMaterials } from './chunkRenderer'
import { createDetailTexture } from './detailTexture'
import { createFoliageMaterial } from './foliageMaterial'
import { createGridOpacity, type GridOpacity } from './gridOverlay'
import { createLeafTexture } from './leafTexture'
import { createLightUniforms, type LightUniforms } from './lightUniforms'
import { createNoiseTexture } from './noiseTexture'
import { createPropsMaterial, createScatterMaterial } from './scatterMaterial'
import { createBlocksMaterial } from './blocksMaterial'
import { createHoverCell, createTerrainMaterial, type HoverCell } from './terrainMaterial'
import { createWaterMaterial } from './waterMaterial'
import { encodeOutput } from './outputEncoding'

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
  /** Hovered terrain cell, tinted by the terrain shader (the cursor on terrain). */
  readonly hover: HoverCell
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
  const hover = createHoverCell()
  const materials = {
    terrain: createTerrainMaterial(noise, detail, gridOpacity, hover),
    blocks: createBlocksMaterial(noise, gridOpacity),
    water: createWaterMaterial(noise, gridOpacity, light),
    foliage: createFoliageMaterial(leaves),
    scatter: createScatterMaterial(leaves),
    props: createPropsMaterial(noise),
  }
  // One mask for every layer: keep only what lies below the cut.
  for (const material of Object.values(materials)) {
    encodeOutput(material)
    material.maskNode = positionWorld.y.lessThan(cutHeight)
    // Never drawn where the cut section says "inside matter" (stencil above
    // its base, see `sectionCap.ts`): what pokes into the ground, or lies
    // just under the section plane, cannot show through it. Without a cut
    // the stencil stays at its base and every pixel passes.
    material.stencilWrite = true
    material.stencilRef = STENCIL_BASE
    material.stencilFunc = GreaterEqualStencilFunc // passes where stencil <= STENCIL_BASE
    material.stencilFail = KeepStencilOp
    material.stencilZFail = KeepStencilOp
    material.stencilZPass = KeepStencilOp
  }
  return { materials, gridOpacity, light, cutHeight, hover }
}
