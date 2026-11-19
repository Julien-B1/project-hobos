/**
 * Surfaces (colour and blocks-shader look) shared by structure meshers.
 *
 * Layer: render (no Three.js import). Colours are sRGB hex, converted to
 * linear here; `k` scales the brightness (per-piece variation).
 */
import { BlockLook } from '../meshing/mesher'
import { srgbHexToLinear } from '../meshing/meshBuilder'
import type { Surface } from '../geometry/primitives'

/** Surface of `look` in sRGB tone `hex`, brightness scaled by `k`. */
export function surface(look: number, hex: number, k = 1): Surface {
  const c = srgbHexToLinear(hex)
  return { color: [c[0] * k, c[1] * k, c[2] * k], look }
}

/** Plain wood (beams, planks, posts). */
export const wood = (hex: number, k = 1): Surface => surface(BlockLook.WOOD, hex, k)
/** Rubble masonry (piers, walls, arches). */
export const masonry = (hex: number, k = 1): Surface => surface(BlockLook.MASONRY, hex, k)
/** Plain stone (slabs, stepping stones, boulders). */
export const stone = (hex: number, k = 1): Surface => surface(BlockLook.STONE, hex, k)
/** Rope. */
export const rope = (hex: number, k = 1): Surface => surface(BlockLook.ROPE, hex, k)
/** Bark (logs). */
export const bark = (hex: number, k = 1): Surface => surface(BlockLook.BARK, hex, k)
