/**
 * Organic test map: procedural, natural-looking terrain.
 *
 * Layer: core (pure TypeScript). Deterministic for a given seed (see
 * `noise.ts`), so a seed reproduces exactly the same map.
 *
 * Pipeline:
 * 1. Height field: fractal value noise shaped into plains and hills, as
 *    integer surface levels (one level = one half-height voxel).
 * 2. River: a meandering channel carved across the map, with banks blended
 *    into the terrain; everything below the water level is filled with water
 *    (river and natural lakes).
 * 3. Columns: stone core, dirt under the top, top material chosen from
 *    height and steepness (sand on shores, grass, rock on steep or high
 *    ground).
 * 4. Slopes: wherever a column is exactly one level below a horizontal
 *    neighbour, a slope voxel is added on top, rising towards it. Gentle
 *    terrain becomes smooth ramps; steep terrain keeps vertical steps.
 * 5. Trees: trunks and leaf canopies on flat grass, denser in forest patches.
 */
import { CHUNK_SIZE } from '../coords'
import { Material } from '../materials'
import { fbm2, hash01, smoothstep } from '../noise'
import { ORIENTATION_OFFSETS, Shape } from '../shapes'
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
const PEAK_LEVEL = 30
/** Height difference to a neighbour (in levels) that counts as steep. */
const STEEP_STEP = 3

/** Build the organic map. Deterministic for a given seed and size. */
export function createOrganicMap(options: OrganicMapOptions = {}): OrganicMap {
  const seed = options.seed ?? 1337
  const size = options.size ?? 128
  const heights = buildHeightField(size, seed)
  const heightAt = (x: number, z: number): number =>
    heights[clampIndex(x, size) + clampIndex(z, size) * size] ?? MIN_LEVEL

  const map = new VoxelMap()
  const slopeColumns = new Set<number>()
  fillColumns(map, size, heightAt)
  placeSlopes(map, size, heightAt, slopeColumns)
  placeTrees(map, size, seed, heightAt, slopeColumns)

  return { map, size, seed, waterLevel: WATER_LEVEL, heightAt }
}

/** Step 1 + 2: integer surface levels with the river carved in. */
function buildHeightField(size: number, seed: number): Int32Array {
  const heights = new Int32Array(size * size)
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
      const n = fbm2(x / 46, z / 46, seed, { octaves: 5 })
      const relief = Math.pow(smoothstep(0.28, 0.82, n), 1.6)
      // A little high-frequency roughness so plains are not perfectly flat.
      const detail = (fbm2(x / 9, z / 9, seed + 31, { octaves: 2 }) - 0.5) * 2
      let h = 8.5 + relief * 26 + detail

      // Carve the river: bed below water, banks blending back to the terrain.
      const dist = Math.abs(x - riverX)
      const bed = WATER_LEVEL - 3
      const t = smoothstep(riverHalfWidth, riverHalfWidth + 10, dist)
      h = bed + (h - bed) * t

      heights[x + z * size] = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, Math.round(h)))
    }
  }
  return heights
}

/** Step 3: solid columns and water. */
function fillColumns(
  map: VoxelMap,
  size: number,
  heightAt: (x: number, z: number) => number,
): void {
  const stone = packVoxel(Material.STONE)
  const dirt = packVoxel(Material.DIRT)
  const water = packVoxel(Material.WATER)

  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const h = heightAt(x, z)
      const top = topMaterial(h, maxNeighbourDrop(x, z, size, heightAt))
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
function topMaterial(h: number, steepness: number): number {
  if (h <= WATER_LEVEL + 1) return Material.SAND // shores and river/lake beds
  if (h >= PEAK_LEVEL) return Material.STONE
  if (steepness >= STEEP_STEP) return Material.ROCK
  return Material.GRASS
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
 * Step 4: add a slope on top of every dry column that is exactly one level
 * below a neighbour, rising towards that neighbour. Skipped when the opposite
 * neighbour is also higher (a one-cell trench): a slope cannot rise both ways.
 */
function placeSlopes(
  map: VoxelMap,
  size: number,
  heightAt: (x: number, z: number) => number,
  slopeColumns: Set<number>,
): void {
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const h = heightAt(x, z)
      if (h < WATER_LEVEL) continue // under water: keep the bed flat
      for (let o = 0; o < ORIENTATION_OFFSETS.length; o++) {
        const [dx, dz] = ORIENTATION_OFFSETS[o] ?? [0, 0]
        if (!inside(x + dx, z + dz, size) || heightAt(x + dx, z + dz) !== h + 1) continue
        if (inside(x - dx, z - dz, size) && heightAt(x - dx, z - dz) > h) continue
        const top = map.get(x, h - 1, z)
        map.set(x, h, z, packVoxel(materialOf(top), Shape.SLOPE, o))
        slopeColumns.add(x + z * size)
        break
      }
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
  slopeColumns: Set<number>,
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
      if (ground !== Material.GRASS || slopeColumns.has(x + z * size)) continue
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

/** True when (x, z) lies on the map. */
function inside(x: number, z: number, size: number): boolean {
  return x >= 0 && z >= 0 && x < size && z < size
}

/** Clamp a coordinate into [0, size). */
function clampIndex(v: number, size: number): number {
  return Math.min(size - 1, Math.max(0, v))
}
