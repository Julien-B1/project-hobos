/**
 * Coordinate conventions and conversions between world space and grid cells.
 *
 * Layer: core (pure TypeScript).
 *
 * Conventions (shared by the whole project):
 * - World frame follows Three.js: Y is up, the ground plane is (x, z).
 * - One horizontal cell is 1 world unit: cell (x, z) covers
 *   [x, x + 1) x [z, z + 1) in world units.
 * - One voxel is {@link VOXEL_HEIGHT} world units tall; voxel level `y`
 *   covers world heights [y * VOXEL_HEIGHT, (y + 1) * VOXEL_HEIGHT).
 */

/** Height of one voxel in world units (a "half step"). Two voxels = one full-height wall. */
export const VOXEL_HEIGHT = 0.5

/** Integer cell coordinates on the ground plane. */
export interface CellCoord {
  readonly x: number
  readonly z: number
}

/**
 * Cell containing a world position on the ground plane.
 *
 * Uses `Math.floor`, not truncation, so negative positions map correctly:
 * world x = -0.25 lies in cell -1, not cell 0.
 */
export function worldToCell(worldX: number, worldZ: number): CellCoord {
  return { x: Math.floor(worldX), z: Math.floor(worldZ) }
}

/** Voxel level containing a world height (floor division by {@link VOXEL_HEIGHT}). */
export function worldToLevel(worldY: number): number {
  return Math.floor(worldY / VOXEL_HEIGHT)
}

/** World height of the bottom of voxel level `y`. */
export function levelToWorld(y: number): number {
  return y * VOXEL_HEIGHT
}

/** Edge length of a chunk, in voxels (chunks are CHUNK_SIZE^3). */
export const CHUNK_SIZE = 16

/** Number of voxels in one chunk. */
export const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE

/** Integer voxel coordinates in world voxel space. */
export interface VoxelCoord {
  readonly x: number
  readonly y: number
  readonly z: number
}

/** Integer chunk coordinates (one unit = one chunk = CHUNK_SIZE voxels). */
export interface ChunkCoord {
  readonly cx: number
  readonly cy: number
  readonly cz: number
}

/**
 * Chunk coordinate containing voxel coordinate `v` (one axis).
 *
 * Arithmetic shift is a floor division by 16 for any 32-bit integer,
 * including negatives: -1 >> 4 === -1, -16 >> 4 === -1, -17 >> 4 === -2.
 */
export function voxelToChunk(v: number): number {
  return v >> 4
}

/**
 * Position of voxel coordinate `v` inside its chunk (one axis), in [0, 15].
 *
 * `& 15` keeps the low 4 bits, which is the positive modulo for any 32-bit
 * integer: -1 & 15 === 15, -16 & 15 === 0.
 */
export function voxelToLocal(v: number): number {
  return v & (CHUNK_SIZE - 1)
}

/**
 * Index of a local voxel in a chunk's flat array.
 *
 * Layout is x fastest, then z, then y: one horizontal slice (y level) is a
 * contiguous block of 256 entries.
 */
export function localIndex(lx: number, ly: number, lz: number): number {
  return lx + lz * CHUNK_SIZE + ly * CHUNK_SIZE * CHUNK_SIZE
}

/** String key of a chunk, used for map lookups: "cx,cy,cz". */
export function chunkKey(cx: number, cy: number, cz: number): string {
  return `${cx},${cy},${cz}`
}

/**
 * Parse a key produced by {@link chunkKey}.
 *
 * @throws Error when the key is malformed.
 */
export function parseChunkKey(key: string): ChunkCoord {
  const parts = key.split(',').map(Number)
  const [cx, cy, cz] = parts
  if (parts.length !== 3 || cx === undefined || cy === undefined || cz === undefined) {
    throw new Error(`Malformed chunk key "${key}"`)
  }
  if (!Number.isInteger(cx) || !Number.isInteger(cy) || !Number.isInteger(cz)) {
    throw new Error(`Malformed chunk key "${key}"`)
  }
  return { cx, cy, cz }
}
