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
  /** Broad leaves (oaks, bushes). */
  LEAVES: 9,
  /** Conifer needles (pines). */
  NEEDLES: 10,
  /** Small pale leaves (birches). */
  BIRCH_LEAVES: 11,
  /** Dressed stone for built structures (walls, arches, stairs): drawn as blocks. */
  STONE_BRICK: 12,
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

/**
 * Terrain materials: ground that is drawn as a faceted height surface
 * (grass, dirt, stone, rock, sand, path). Everything else is drawn as
 * blocks: built structures (wood: bridges, trunks, future stairs), leaves
 * and water, so they keep sharp edges.
 */
const TERRAIN: ReadonlySet<number> = new Set([
  Material.GRASS,
  Material.DIRT,
  Material.STONE,
  Material.ROCK,
  Material.SAND,
  Material.PATH,
])

/** True for terrain materials, see {@link TERRAIN}. */
export function isTerrainMaterial(id: number): boolean {
  return TERRAIN.has(id)
}

/** Foliage materials: what tree canopies and bushes are made of. */
const FOLIAGE: ReadonlySet<number> = new Set([
  Material.LEAVES,
  Material.NEEDLES,
  Material.BIRCH_LEAVES,
])

/** True for foliage materials (leaves of any kind), see {@link FOLIAGE}. */
export function isFoliageMaterial(id: number): boolean {
  return FOLIAGE.has(id)
}
