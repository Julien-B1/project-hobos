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
 * the face-adjacent chunk(s) when the voxel lies on a chunk border, because
 * their meshes may show or hide a face against this voxel. The renderer
 * consumes the set with {@link VoxelMap.drainDirty}. A dirty key may name a
 * chunk that does not exist (any more): its mesh must then be removed.
 */
import { Chunk } from './chunk'
import { CHUNK_SIZE, chunkKey, voxelToChunk, voxelToLocal } from './coords'
import { AIR, isAir, type Voxel } from './voxel'

/** Last local coordinate on a chunk axis (15). */
const LAST = CHUNK_SIZE - 1

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
   * Mark the chunk and, for border voxels, the face-adjacent chunks.
   * Diagonal neighbours are not needed: face culling only looks at the six
   * face neighbours of a voxel.
   */
  private markDirty(cx: number, cy: number, cz: number, lx: number, ly: number, lz: number): void {
    this.dirty.add(chunkKey(cx, cy, cz))
    if (lx === 0) this.dirty.add(chunkKey(cx - 1, cy, cz))
    if (lx === LAST) this.dirty.add(chunkKey(cx + 1, cy, cz))
    if (ly === 0) this.dirty.add(chunkKey(cx, cy - 1, cz))
    if (ly === LAST) this.dirty.add(chunkKey(cx, cy + 1, cz))
    if (lz === 0) this.dirty.add(chunkKey(cx, cy, cz - 1))
    if (lz === LAST) this.dirty.add(chunkKey(cx, cy, cz + 1))
  }
}
