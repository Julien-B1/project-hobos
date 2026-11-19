/**
 * Sparse, chunked voxel map with dirty-chunk tracking.
 *
 * Layer: core (pure TypeScript). This is the single source of truth for the
 * terrain. Coordinates are integer voxel coordinates in world voxel space
 * (see `coords.ts`); negative coordinates are fine.
 *
 * Storage: only chunks holding at least one non-air voxel exist. Reading an
 * absent chunk returns air; writing a solid voxel creates the chunk lazily;
 * a chunk that becomes all-air is removed.
 *
 * Dirty tracking: every effective change marks the voxel's chunk dirty, plus
 * every neighbouring chunk (faces, edges and corners) that lies within
 * {@link DIRTY_MARGIN} voxels of it, because their meshes read voxels across
 * the border: the blocky mesher looks one voxel away (face culling), the
 * smooth mesher two (density blur plus dual cells). The renderer consumes the
 * set with {@link VoxelMap.drainDirty}. A dirty key may name a chunk that does
 * not exist (any more): its mesh must then be removed.
 */
import { Chunk } from './chunk'
import { CHUNK_SIZE, chunkKey, voxelToChunk, voxelToLocal } from './coords'
import { AIR, isAir, type Voxel } from './voxel'

/**
 * How far (in voxels) a mesher may read beyond its chunk. A voxel closer than
 * this to a chunk border also dirties the chunk(s) across that border.
 */
export const DIRTY_MARGIN = 2

/** Chunked voxel terrain. */
export class VoxelMap {
  private readonly chunkMap = new Map<string, Chunk>()
  private readonly dirty = new Set<string>()

  /** Voxel at (x, y, z), air when nothing is stored there. */
  get(x: number, y: number, z: number): Voxel {
    const chunk = this.chunkMap.get(chunkKey(voxelToChunk(x), voxelToChunk(y), voxelToChunk(z)))
    if (!chunk) return AIR
    return chunk.get(voxelToLocal(x), voxelToLocal(y), voxelToLocal(z))
  }

  /**
   * Write the voxel at (x, y, z).
   *
   * @returns True when the stored value changed (and dirty chunks were marked).
   */
  set(x: number, y: number, z: number, voxel: Voxel): boolean {
    const cx = voxelToChunk(x)
    const cy = voxelToChunk(y)
    const cz = voxelToChunk(z)
    const key = chunkKey(cx, cy, cz)
    let chunk = this.chunkMap.get(key)
    if (!chunk) {
      // Writing air into a missing chunk changes nothing: do not create it.
      if (isAir(voxel)) return false
      chunk = new Chunk(cx, cy, cz)
      this.chunkMap.set(key, chunk)
    }

    const lx = voxelToLocal(x)
    const ly = voxelToLocal(y)
    const lz = voxelToLocal(z)
    const previous = chunk.set(lx, ly, lz, voxel)
    if (previous === voxel) return false

    if (chunk.isEmpty) this.chunkMap.delete(key)
    this.markDirty(cx, cy, cz, lx, ly, lz)
    return true
  }

  /** Existing (non-empty) chunk by key, if any. */
  getChunk(key: string): Chunk | undefined {
    return this.chunkMap.get(key)
  }

  /** Iterate over all existing chunks, i.e. those holding at least one solid voxel. */
  chunks(): IterableIterator<Chunk> {
    return this.chunkMap.values()
  }

  /** Number of existing chunks. */
  get chunkCount(): number {
    return this.chunkMap.size
  }

  /** Return and clear the keys of chunks whose mesh must be rebuilt. */
  drainDirty(): string[] {
    const keys = [...this.dirty]
    this.dirty.clear()
    return keys
  }

  /**
   * Mark the chunk and every neighbour chunk within {@link DIRTY_MARGIN}
   * voxels: per axis the offsets are {0}, plus -1 near the low border and +1
   * near the high border; all combinations are marked (up to 8 chunks for a
   * voxel near a chunk corner).
   */
  private markDirty(cx: number, cy: number, cz: number, lx: number, ly: number, lz: number): void {
    const ox = axisOffsets(lx)
    const oy = axisOffsets(ly)
    const oz = axisOffsets(lz)
    for (const dx of ox)
      for (const dy of oy)
        for (const dz of oz) {
          this.dirty.add(chunkKey(cx + dx, cy + dy, cz + dz))
        }
  }
}

/** Chunk offsets along one axis touched by a voxel at local coordinate `l`. */
function axisOffsets(l: number): number[] {
  const offsets = [0]
  if (l < DIRTY_MARGIN) offsets.push(-1)
  if (l >= CHUNK_SIZE - DIRTY_MARGIN) offsets.push(1)
  return offsets
}
