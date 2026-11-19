/**
 * Reference map (step 2): a small deterministic test map covering every
 * multi-level case the engine must handle.
 *
 * Layer: core (pure TypeScript). No randomness: the same call always builds
 * the same voxels, so tests and manual checks can use fixed coordinates.
 *
 * Top view, 64 x 64 cells (x right, z down), heights as *surface levels*
 * (level L = standing on top of voxel L-1, world height L * 0.5):
 *
 * ```
 *  x: 0    2      18  22 26     34    44          63
 *  z:0 +------------------+-------+------------------+
 *      | ground (6)       |P|river| ground (6)       |
 *      |                  |a| (3) |                  |
 *   30 | ramp>> =========== bridge deck (11) ===<< ramp |  z 30..32
 *   32 |                  |t|     |      ramp ^^ x50..51, z32..39
 *   40 |                  |h|     |      +-----------+
 *   44 | +-hill (14)--+   |(4)    |      | cliff (14)|
 *   50 | = tunnel ===== (6)|      |      |           |  z 50..52
 *   58 | +------------+   | |     |      |           |
 *   63 +------------------+-------+------+-----------+
 * ```
 *
 * See {@link REFERENCE_LAYOUT} for exact coordinates, and the wiki page
 * "Reference-Map" for the description.
 */
import { Material } from '../materials'
import { Orientation, Shape } from '../shapes'
import { AIR, packVoxel, type Voxel } from '../voxel'
import { VoxelMap } from '../voxelMap'

/** Inclusive integer range. */
export interface Range {
  readonly min: number
  readonly max: number
}

/** Inclusive X or Z extent of a feature. */
interface Span {
  readonly x: Range
}

/** Shape of {@link REFERENCE_LAYOUT}; plain numbers so callers can loop over ranges. */
export interface ReferenceLayout {
  readonly size: { readonly width: number; readonly depth: number }
  readonly groundTop: number
  readonly river: Span & { readonly bedTop: number; readonly waterTop: number }
  readonly path: Span & { readonly top: number }
  readonly bridge: Span & { readonly z: Range; readonly deckLevel: number }
  readonly bridgeRampWest: Span
  readonly bridgeRampEast: Span
  readonly cliff: Span & { readonly z: Range; readonly top: number }
  readonly cliffRamp: Span & { readonly z: Range }
  readonly hill: Span & { readonly z: Range; readonly top: number }
  readonly tunnel: { readonly z: Range; readonly floorTop: number; readonly ceilingLevel: number }
}

/**
 * Exact layout of the reference map, in voxel coordinates (x, z = cells,
 * y = voxel levels). Ranges are inclusive. "top" values are surface levels:
 * the top solid voxel is at `top - 1`.
 */
export const REFERENCE_LAYOUT: ReferenceLayout = {
  size: { width: 64, depth: 64 },
  /** Base ground: solid voxels 0..5, surface level 6. */
  groundTop: 6,
  /** Trench of the river and its low bank path. */
  river: { x: { min: 26, max: 33 }, bedTop: 2, waterTop: 3 },
  path: { x: { min: 22, max: 25 }, top: 4 },
  /** Bridge deck spanning the path and the river along X. */
  bridge: { x: { min: 20, max: 35 }, z: { min: 30, max: 32 }, deckLevel: 10 },
  /** Slope ramps from the ground up to the deck, at both bridge ends. */
  bridgeRampWest: { x: { min: 15, max: 19 } },
  bridgeRampEast: { x: { min: 36, max: 40 } },
  /** Raised plateau with a vertical face towards -Z. */
  cliff: { x: { min: 44, max: 63 }, z: { min: 40, max: 63 }, top: 14 },
  /** Slope ramp climbing +Z against the cliff's north face. */
  cliffRamp: { x: { min: 50, max: 51 }, z: { min: 32, max: 39 } },
  /** Hill crossed by a tunnel along X. */
  hill: { x: { min: 2, max: 18 }, z: { min: 44, max: 58 }, top: 14 },
  tunnel: { z: { min: 50, max: 52 }, floorTop: 6, ceilingLevel: 10 },
}

const v = (material: number, shape: number = Shape.FULL, orientation = 0): Voxel =>
  packVoxel(material, shape, orientation)

/** Fill an inclusive box with one voxel value. */
function fill(map: VoxelMap, x: Range, y: Range, z: Range, voxel: Voxel): void {
  for (let yy = y.min; yy <= y.max; yy++)
    for (let zz = z.min; zz <= z.max; zz++)
      for (let xx = x.min; xx <= x.max; xx++) map.set(xx, yy, zz, voxel)
}

/** Inclusive range helper. */
const r = (min: number, max: number): Range => ({ min, max })

/**
 * Raise the columns of a box to surface level `top`: stone core, dirt under
 * the top, `topMaterial` on the top voxel. Voxels above `top` are cleared.
 */
function terrainColumn(
  map: VoxelMap,
  x: Range,
  z: Range,
  top: number,
  topMaterial: number,
  core: number = Material.STONE,
): void {
  fill(map, x, r(0, top - 3), z, v(core))
  fill(map, x, r(top - 2, top - 2), z, v(Material.DIRT))
  fill(map, x, r(top - 1, top - 1), z, v(topMaterial))
}

/**
 * Build a straight slope ramp. Each step k rises one voxel: full blocks up to
 * `baseTop + k - 1`, then a slope at level `baseTop + k` whose high side faces
 * `orientation`. The last step's high edge reaches `baseTop + steps`.
 *
 * @param cells Cells of the ramp in climbing order, each a list of (x, z).
 */
function ramp(
  map: VoxelMap,
  cells: readonly (readonly (readonly [number, number])[])[],
  baseTop: number,
  orientation: number,
  material: number,
): void {
  cells.forEach((row, k) => {
    for (const [x, z] of row) {
      fill(map, r(x, x), r(baseTop, baseTop + k - 1), r(z, z), v(Material.STONE))
      map.set(x, baseTop + k, z, v(material, Shape.SLOPE, orientation))
    }
  })
}

/** Cells of a ramp running along X across a z range, in climbing order. */
function rampAlongX(xs: readonly number[], z: Range): [number, number][][] {
  return xs.map((x) => {
    const row: [number, number][] = []
    for (let zz = z.min; zz <= z.max; zz++) row.push([x, zz])
    return row
  })
}

/** Inclusive integer sequence from `from` to `to` (either direction). */
function seq(from: number, to: number): number[] {
  const step = from <= to ? 1 : -1
  const out: number[] = []
  for (let i = from; i !== to + step; i += step) out.push(i)
  return out
}

/** Build the reference map. Deterministic. */
export function createReferenceMap(): VoxelMap {
  const L = REFERENCE_LAYOUT
  const map = new VoxelMap()
  const all = { x: r(0, L.size.width - 1), z: r(0, L.size.depth - 1) }

  // 1. Base ground everywhere.
  terrainColumn(map, all.x, all.z, L.groundTop, Material.GRASS)

  // 2. River trench: carve down to the bed, then water on top of the bed.
  fill(map, L.river.x, r(L.river.bedTop, L.groundTop - 1), all.z, AIR)
  fill(map, L.river.x, r(L.river.bedTop - 1, L.river.bedTop - 1), all.z, v(Material.SAND))
  fill(map, L.river.x, r(L.river.bedTop, L.river.waterTop - 1), all.z, v(Material.WATER))

  // 3. Low bank path between the west ground and the river.
  fill(map, L.path.x, r(L.path.top, L.groundTop - 1), all.z, AIR)
  fill(map, L.path.x, r(L.path.top - 1, L.path.top - 1), all.z, v(Material.PATH))

  // 4. Hill, then the tunnel carved through it along X.
  terrainColumn(map, L.hill.x, L.hill.z, L.hill.top, Material.GRASS, Material.ROCK)
  fill(map, L.hill.x, r(L.tunnel.floorTop, L.tunnel.ceilingLevel - 1), L.tunnel.z, AIR)
  fill(map, L.hill.x, r(L.tunnel.floorTop - 1, L.tunnel.floorTop - 1), L.tunnel.z, v(Material.PATH))

  // 5. Cliff plateau.
  terrainColumn(map, L.cliff.x, L.cliff.z, L.cliff.top, Material.GRASS, Material.ROCK)

  // 6. Ramp against the cliff's north face, climbing +Z (high side south).
  ramp(
    map,
    seq(L.cliffRamp.z.min, L.cliffRamp.z.max).map((z) =>
      seq(L.cliffRamp.x.min, L.cliffRamp.x.max).map((x) => [x, z] as const),
    ),
    L.groundTop,
    Orientation.SOUTH,
    Material.STONE,
  )

  // 7. Bridge: ramps up from both banks, then the deck in between.
  ramp(
    map,
    rampAlongX(seq(L.bridgeRampWest.x.min, L.bridgeRampWest.x.max), L.bridge.z),
    L.groundTop,
    Orientation.EAST,
    Material.WOOD,
  )
  ramp(
    map,
    rampAlongX(seq(L.bridgeRampEast.x.max, L.bridgeRampEast.x.min), L.bridge.z),
    L.groundTop,
    Orientation.WEST,
    Material.WOOD,
  )
  fill(map, L.bridge.x, r(L.bridge.deckLevel, L.bridge.deckLevel), L.bridge.z, v(Material.WOOD))

  return map
}
