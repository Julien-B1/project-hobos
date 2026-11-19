/**
 * Material colours (no textures yet).
 *
 * Layer: render. Maps core material ids to colours. Colours are authored as
 * sRGB hex values and converted once to the linear space that Three.js uses
 * for vertex colours.
 */
import { Color } from 'three/webgpu'
import { Material, type MaterialId } from '@/core/materials'
import type { ColorLookup } from './meshing/mesher'

/** Authored sRGB colour per material. */
const PALETTE: Readonly<Record<MaterialId, number>> = {
  [Material.AIR]: 0xff00ff, // never meshed; magenta makes a bug obvious
  [Material.GRASS]: 0x6f9a4a,
  [Material.DIRT]: 0x8a6a45,
  [Material.STONE]: 0x8d8f93,
  [Material.ROCK]: 0x6e6763,
  [Material.SAND]: 0xd9c48f,
  [Material.WATER]: 0x3f7fb8,
  [Material.WOOD]: 0x9b6b3c,
  [Material.PATH]: 0xb9a27a,
}

/** Colour shown for ids missing from the palette. */
const UNKNOWN = 0xff00ff

/** Linear RGB triplets indexed by material id (0..255). */
const LINEAR: readonly (readonly [number, number, number])[] = Array.from(
  { length: 256 },
  (_, id) => {
    const hex = (PALETTE as Partial<Record<number, number>>)[id] ?? UNKNOWN
    const c = new Color().setHex(hex) // setHex converts sRGB -> linear working space
    return [c.r, c.g, c.b] as const
  },
)

/** Linear RGB colour of a material id, for vertex colours. */
export const materialColor: ColorLookup = (id) => LINEAR[id] ?? [1, 0, 1]
