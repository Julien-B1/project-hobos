/**
 * Organic test map: procedural, natural-looking terrain.
 *
 * Layer: core (pure TypeScript). Deterministic for a given seed (see
 * `noise.ts`), so a seed reproduces exactly the same map.
 *
 * Pipeline:
 * 1. Height field: fractal value noise shaped into plains and hills,
 *    blurred, terraced into plateaus and cliffs inside noise-selected cliff
 *    zones, rounded to integer surface levels (one level = one half-height
 *    voxel), then step-limited (2 levels on ordinary ground, 8 in cliffs).
 * 2. River: a meandering channel carved across the map, with banks blended
 *    into the terrain; everything below the water level is filled with water
 *    (river and natural lakes).
 * 3. Columns: stone core, dirt under the top, top material chosen from
 *    height, steepness and a patch noise (sand on shores, grass, rock on
 *    steep faces and in patches on hills, stone on peaks).
 * 4. Wedges: every dry column next to higher ground gets a wedge on top
 *    whose raised corners follow the surrounding cells (slopes, outer and
 *    inner corners). They give one-level steps a walkable slope; the smooth
 *    terrain renderer rounds everything else.
 * 5. Trees: trunks and leaf canopies on flat grass, denser in forest patches.
 */
import { CHUNK_SIZE } from '../coords'
import { Material } from '../materials'
import { fbm2, hash01, smoothstep } from '../noise'
import { ORIENTATION_OFFSETS, shapeForCornerMask } from '../shapes'
import { isAir, materialOf, packVoxel } from '../voxel'
import { VoxelMap } from '../voxelMap'

/** Options for {@link createOrganicMap}. */
export interface OrganicMapOptions {
  /** Noise seed (any 32-bit integer). Default 1337. */
  readonly seed?: number
  /** Edge length of the square map, in cells. Default 128. */
  readonly size?: number
}

/** Generated organic map with the data needed to frame and test it. */
export interface OrganicMap {
  readonly map: VoxelMap
  readonly size: number
  readonly seed: number
  /** Surface level of the water (water voxels fill levels below it). */
  readonly waterLevel: number
  /** Terrain surface level of a column before slopes and trees (no water). */
  heightAt(x: number, z: number): number
}

/** Water surface level: terrain below it is flooded. */
const WATER_LEVEL = 10
/** Lowest and highest terrain surface levels. */
const MIN_LEVEL = 3
const MAX_LEVEL = 2 * CHUNK_SIZE + 8
/** Levels at and above which the top turns to bare stone. */
const PEAK_LEVEL = 27
/** Levels from which rocky patches may replace grass on hills. */
const ROCK_LEVEL = 17
/**
 * Maximum height difference between two orthogonal neighbours, in levels,
 * on ordinary ground. Two levels (one world unit per cell, 45 degrees) is
 * still a smooth slope once rendered by the smooth terrain mesher.
 */
const MAX_STEP = 2
/** Maximum step inside cliff zones: steep, almost vertical faces. */
const CLIFF_MAX_STEP = 8
/** Height of one cliff terrace, in levels. */
const TERRACE = 7
/** Height difference to a neighbour (in levels) from which ground is bare rock. */
const STEEP_STEP = 3

/** Build the organic map. Deterministic for a given seed and size. */
export function createOrganicMap(options: OrganicMapOptions = {}): OrganicMap {
  const seed = options.seed ?? 1337
  const size = options.size ?? 128
  const heights = buildHeightField(size, seed)
  const heightAt = (x: number, z: number): number =>
    heights[clampIndex(x, size) + clampIndex(z, size) * size] ?? MIN_LEVEL

  const map = new VoxelMap()
  const wedgeColumns = new Set<number>()
  fillColumns(map, size, seed, heightAt)
  placeWedges(map, size, heightAt, wedgeColumns)
  placeTrees(map, size, seed, heightAt, wedgeColumns)

  return { map, size, seed, waterLevel: WATER_LEVEL, heightAt }
}

/** Step 1 + 2: integer surface levels with the river carved in. */
function buildHeightField(size: number, seed: number): Int32Array {
  const raw = new Float64Array(size * size)
  for (let z = 0; z < size; z++) {
    // River centre line along Z: a slow sine for the main bends, plus noise so
    // no two bends look alike.
    const meander =
      Math.sin(z * 0.045 + seed * 0.1) * size * 0.16 +
      (fbm2(z / 28, 0.5, seed + 77, { octaves: 3 }) - 0.5) * size * 0.3
    const riverX = size * 0.5 + meander
    const riverHalfWidth = 2 + fbm2(z / 20, 3.5, seed + 91, { octaves: 2 }) * 2.5

    for (let x = 0; x < size; x++) {
      // Large-scale relief: plains where the noise is low, hills where high.
      const n = fbm2(x / 72, z / 72, seed, { octaves: 4 })
      const relief = Math.pow(smoothstep(0.2, 0.9, n), 1.4)
      // Gentle undulation so plains are not perfectly flat.
      const detail = (fbm2(x / 14, z / 14, seed + 31, { octaves: 2 }) - 0.5) * 1.2
      let h = 9 + relief * 20 + detail

      // Carve the river: bed below water, banks blending back to the terrain.
      const dist = Math.abs(x - riverX)
      const bed = WATER_LEVEL - 3
      const t = smoothstep(riverHalfWidth, riverHalfWidth + 16, dist)
      h = bed + (h - bed) * t

      raw[x + z * size] = h
    }
  }

  // Blur before rounding: removes one-cell spikes and pits that would show as
  // a checkerboard of cubes once quantised to half-height levels.
  const smooth = boxBlur(boxBlur(boxBlur(raw, size), size), size)
  const heights = new Int32Array(size * size)
  const stepLimits = new Int32Array(size * size)
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const i = x + z * size
      let h = smooth[i] ?? MIN_LEVEL
      // Cliff zones: hills become plateaus separated by steep risers.
      const cliff = smoothstep(0.52, 0.6, fbm2(x / 60, z / 60, seed + 300, { octaves: 2 }))
      // Terraces count from just above the water: a plateau never sinks below
      // it (otherwise water would flood the terrace and draw contour channels).
      const shore = WATER_LEVEL + 2
      if (cliff > 0 && h > shore) h += (shore + terrace(h - shore, TERRACE) - h) * cliff
      heights[i] = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, Math.round(h)))
      stepLimits[i] = cliff > 0.5 ? CLIFF_MAX_STEP : MAX_STEP
    }
  }
  limitSteps(heights, size, stepLimits)
  return heights
}

/**
 * Terrace a height: flat plateaus every `step` levels joined by steep risers
 * (the last 25 % of each step climbs the whole step).
 */
function terrace(h: number, step: number): number {
  const base = Math.floor(h / step) * step
  const t = (h - base) / step
  return base + step * smoothstep(0.75, 1, t)
}

/**
 * Lower cells so a cell never rises more than its step limit above an
 * orthogonal neighbour (`limits[i]` levels for cell i).
 *
 * This is a min-plus distance transform: each cell becomes
 * min(own height, neighbour height + own limit), propagated in one forward
 * and one backward raster pass. Only lowers terrain: river beds and valleys
 * stay where they are; hills too steep around them are cut back into regular
 * slopes, except in cliff zones whose limit is high.
 */
function limitSteps(heights: Int32Array, size: number, limits: Int32Array): void {
  const at = (x: number, z: number): number => heights[x + z * size] ?? 0
  const limit = (x: number, z: number): number => limits[x + z * size] ?? MAX_STEP
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      let h = at(x, z)
      const m = limit(x, z)
      if (x > 0) h = Math.min(h, at(x - 1, z) + m)
      if (z > 0) h = Math.min(h, at(x, z - 1) + m)
      heights[x + z * size] = h
    }
  }
  for (let z = size - 1; z >= 0; z--) {
    for (let x = size - 1; x >= 0; x--) {
      let h = at(x, z)
      const m = limit(x, z)
      if (x < size - 1) h = Math.min(h, at(x + 1, z) + m)
      if (z < size - 1) h = Math.min(h, at(x, z + 1) + m)
      heights[x + z * size] = h
    }
  }
}

/** 3 x 3 box blur of a square field, edges clamped. */
function boxBlur(field: Float64Array, size: number): Float64Array {
  const out = new Float64Array(field.length)
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      let sum = 0
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          sum += field[clampIndex(x + dx, size) + clampIndex(z + dz, size) * size] ?? 0
        }
      out[x + z * size] = sum / 9
    }
  }
  return out
}

/** Step 3: solid columns and water. */
function fillColumns(
  map: VoxelMap,
  size: number,
  seed: number,
  heightAt: (x: number, z: number) => number,
): void {
  const stone = packVoxel(Material.STONE)
  const dirt = packVoxel(Material.DIRT)
  const water = packVoxel(Material.WATER)

  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const h = heightAt(x, z)
      // Rocky patches: low-frequency noise, so rock comes in coherent areas
      // instead of speckles.
      const rocky = fbm2(x / 11, z / 11, seed + 200, { octaves: 2 }) > 0.58
      const steep = maxNeighbourDrop(x, z, size, heightAt) >= STEEP_STEP
      const top = topMaterial(h, rocky || steep, nearWater(x, z, size, heightAt))
      const under = top === Material.ROCK || top === Material.STONE ? packVoxel(top) : dirt
      for (let y = 0; y < h; y++) {
        if (y === h - 1) map.set(x, y, z, packVoxel(top))
        else if (y >= h - 3) map.set(x, y, z, under)
        else map.set(x, y, z, stone)
      }
      for (let y = h; y < WATER_LEVEL; y++) map.set(x, y, z, water)
    }
  }
}

/** Material of a column's top voxel. */
function topMaterial(h: number, rocky: boolean, shore: boolean): number {
  if (h < WATER_LEVEL || (shore && h <= WATER_LEVEL + 1)) return Material.SAND // beds and beaches
  if (h >= PEAK_LEVEL) return Material.STONE
  if (rocky && h >= ROCK_LEVEL) return Material.ROCK // patches on hills, steep faces
  return Material.GRASS
}

/** True when a flooded column lies within 2 cells of (x, z) (beach width). */
function nearWater(
  x: number,
  z: number,
  size: number,
  heightAt: (x: number, z: number) => number,
): boolean {
  for (let dz = -2; dz <= 2; dz++)
    for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx
      const nz = z + dz
      if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue
      if (heightAt(nx, nz) < WATER_LEVEL) return true
    }
  return false
}

/** Largest height difference between a column and its 4 neighbours inside the map. */
function maxNeighbourDrop(
  x: number,
  z: number,
  size: number,
  heightAt: (x: number, z: number) => number,
): number {
  const h = heightAt(x, z)
  let max = 0
  for (const [dx, dz] of ORIENTATION_OFFSETS) {
    const nx = x + dx
    const nz = z + dz
    if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue
    max = Math.max(max, Math.abs(heightAt(nx, nz) - h))
  }
  return max
}

/**
 * Cells sharing each top corner of a column, besides the column itself:
 * offsets (dx, dz) indexed by corner (c00 = north-west, c10 = north-east,
 * c11 = south-east, c01 = south-west; see `shapes.ts`).
 */
const CORNER_NEIGHBOURS: readonly (readonly (readonly [number, number])[])[] = [
  [
    [-1, 0],
    [0, -1],
    [-1, -1],
  ],
  [
    [1, 0],
    [0, -1],
    [1, -1],
  ],
  [
    [1, 0],
    [0, 1],
    [1, 1],
  ],
  [
    [-1, 0],
    [0, 1],
    [-1, 1],
  ],
]

/**
 * Step 4: smooth the steps with wedges. For each dry column at level h, a
 * top corner is raised to h + 1 when any of the 3 other cells sharing that
 * corner is higher. The raised corners select the voxel added on top: slope,
 * outer or inner corner, saddle, or a full block (see
 * `shapeForCornerMask`). Two neighbours compute the same raised height for a
 * shared corner, so wedges join without gaps around corners and diagonals.
 * Steps of 2 levels or more keep a vertical part above the wedge.
 */
function placeWedges(
  map: VoxelMap,
  size: number,
  heightAt: (x: number, z: number) => number,
  wedgeColumns: Set<number>,
): void {
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const h = heightAt(x, z)
      if (h < WATER_LEVEL) continue // under water: keep the bed flat
      let mask = 0
      CORNER_NEIGHBOURS.forEach((cells, corner) => {
        if (cells.some(([dx, dz]) => heightAt(x + dx, z + dz) > h)) mask |= 1 << corner
      })
      const wedge = shapeForCornerMask(mask)
      if (!wedge) continue
      const top = materialOf(map.get(x, h - 1, z))
      map.set(x, h, z, packVoxel(top, wedge.shape, wedge.orientation))
      wedgeColumns.add(x + z * size)
    }
  }
}

/**
 * Step 5: trees on a jittered grid (at most one candidate per 5 x 5 block),
 * kept where the ground is flat grass. A low-frequency noise mask makes
 * forests; elsewhere trees are sparse.
 */
function placeTrees(
  map: VoxelMap,
  size: number,
  seed: number,
  heightAt: (x: number, z: number) => number,
  wedgeColumns: Set<number>,
): void {
  const BLOCK = 5
  const trunk = packVoxel(Material.WOOD)
  const leaves = packVoxel(Material.LEAVES)

  for (let bz = 0; bz < size; bz += BLOCK) {
    for (let bx = 0; bx < size; bx += BLOCK) {
      const x = bx + Math.floor(hash01(bx, bz, seed + 1) * BLOCK)
      const z = bz + Math.floor(hash01(bx, bz, seed + 2) * BLOCK)
      if (x < 2 || z < 2 || x >= size - 2 || z >= size - 2) continue

      const forest = fbm2(x / 38, z / 38, seed + 500, { octaves: 3 }) > 0.55
      if (hash01(x, z, seed + 3) > (forest ? 0.85 : 0.12)) continue

      const h = heightAt(x, z)
      const ground = materialOf(map.get(x, h - 1, z))
      if (ground !== Material.GRASS || wedgeColumns.has(x + z * size)) continue
      if (maxNeighbourDrop(x, z, size, heightAt) > 1) continue

      // Trunk of 4 to 6 voxels (2 to 3 world units).
      const trunkHeight = 4 + Math.floor(hash01(x, z, seed + 4) * 3)
      for (let y = h; y < h + trunkHeight; y++) map.set(x, y, z, trunk)

      // Canopy: ellipsoid of leaves around the trunk top, only into air.
      const cy = h + trunkHeight
      for (let dy = -2; dy <= 3; dy++) {
        for (let dz = -2; dz <= 2; dz++) {
          for (let dx = -2; dx <= 2; dx++) {
            const r = (dx * dx + dz * dz) / 5.5 + ((dy - 0.5) * (dy - 0.5)) / 7
            if (r > 1) continue
            if (isAir(map.get(x + dx, cy + dy, z + dz))) map.set(x + dx, cy + dy, z + dz, leaves)
          }
        }
      }
    }
  }
}

/** Clamp a coordinate into [0, size). */
function clampIndex(v: number, size: number): number {
  return Math.min(size - 1, Math.max(0, v))
}
