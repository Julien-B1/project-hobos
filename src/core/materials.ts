/**
 * Material identifiers (the 8-bit material field of a voxel).
 *
 * Layer: core (pure TypeScript). Only ids and names live here; colours are a
 * rendering concern (`src/render/materialPalette.ts`).
 *
 * Adding a material: append an id here (never renumber existing ones: ids may
 * end up in saved maps later), then give it a colour in the render palette.
 */

/** Known material ids. 0 is reserved for air. */
export const Material = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  ROCK: 4,
  SAND: 5,
  WATER: 6,
  WOOD: 7,
  PATH: 8,
  LEAVES: 9,
} as const

/** A material id from {@link Material}. */
export type MaterialId = (typeof Material)[keyof typeof Material]

/** Human-readable name of a material id, for the debug HUD. */
export function materialName(id: number): string {
  for (const [name, value] of Object.entries(Material)) {
    if (value === id) return name.toLowerCase()
  }
  return `unknown(${id})`
}
