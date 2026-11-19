/**
 * Chunk: a dense 16 x 16 x 16 block of voxels.
 *
 * Layer: core (pure TypeScript). Chunks are created and owned by `VoxelMap`;
 * other code reads them (e.g. meshing) but writes go through the map so that
 * dirty tracking stays correct.
 */
import { CHUNK_VOLUME, chunkKey, localIndex } from './coords'
import { AIR, isAir, type Voxel } from './voxel'

/** Dense voxel storage for one chunk, with a count of non-air voxels. */
export class Chunk {
  /** Map lookup key, "cx,cy,cz". */
  readonly key: string
  /** Packed voxels, indexed with `localIndex(lx, ly, lz)`. */
  readonly voxels = new Uint16Array(CHUNK_VOLUME)
  private solid = 0

  /**
   * @param cx Chunk coordinate along X (chunk units).
   * @param cy Chunk coordinate along Y (chunk units).
   * @param cz Chunk coordinate along Z (chunk units).
   */
  constructor(
    readonly cx: number,
    readonly cy: number,
    readonly cz: number,
  ) {
    this.key = chunkKey(cx, cy, cz)
  }

  /** Number of non-air voxels. */
  get solidCount(): number {
    return this.solid
  }

  /** True when the chunk holds only air. */
  get isEmpty(): boolean {
    return this.solid === 0
  }

  /** Voxel at local coordinates, each in [0, 15]. */
  get(lx: number, ly: number, lz: number): Voxel {
    return this.voxels[localIndex(lx, ly, lz)] ?? AIR
  }

  /**
   * Write a voxel at local coordinates and keep the solid count in sync.
   * Prefer `VoxelMap.set()`, which also tracks dirty chunks.
   *
   * @returns The previous voxel value.
   */
  set(lx: number, ly: number, lz: number, voxel: Voxel): Voxel {
    const index = localIndex(lx, ly, lz)
    const previous = this.voxels[index] ?? AIR
    this.voxels[index] = voxel
    this.solid += Number(!isAir(voxel)) - Number(!isAir(previous))
    return previous
  }
}
