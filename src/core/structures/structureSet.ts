/**
 * The structures of one map, indexed for the renderer.
 *
 * Layer: core (pure TypeScript). Placing a structure stamps its voxels
 * (through its kind) and records:
 * - which voxels it owns (drawn by its mesh, not as blocks: `owns`);
 * - its home chunk, the chunk whose mesh carries the structure's geometry
 *   (`inChunk`), so each structure is meshed exactly once.
 */
import { chunkKey, voxelToChunk, type VoxelCoord } from '../coords'
import type { VoxelMap } from '../voxelMap'
import type { StructureRegistry } from './registry'
import type { Structure, VoxelBox } from './structure'

/** Voxel key for the ownership index. */
function voxelKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`
}

/** Structures placed on a map. */
export class StructureSet {
  private readonly list: Structure[] = []
  private readonly owners = new Map<string, Structure>()
  private readonly homes = new Map<string, Structure[]>()
  private readonly boxes: VoxelBox[] = []

  /**
   * Place `structure`: stamp its voxels into `map` through its kind and
   * index it. Ids must be unique.
   */
  place(structure: Structure, map: VoxelMap, kinds: StructureRegistry): void {
    if (this.list.some((s) => s.id === structure.id)) {
      throw new Error(`duplicate structure id: ${structure.id}`)
    }
    const kind = kinds.get(structure.kind)
    const owned = kind.stamp(structure, map)
    for (const v of owned) this.owners.set(voxelKey(v.x, v.y, v.z), structure)
    const bounds = kind.bounds(structure)
    this.boxes.push(bounds)
    const home = homeVoxel(owned, bounds.min)
    const key = chunkKey(voxelToChunk(home.x), voxelToChunk(home.y), voxelToChunk(home.z))
    const list = this.homes.get(key) ?? []
    list.push(structure)
    this.homes.set(key, list)
    this.list.push(structure)
  }

  /** Every structure, in placement order. */
  get all(): readonly Structure[] {
    return this.list
  }

  /** Number of structures. */
  get size(): number {
    return this.list.length
  }

  /** Structures whose geometry is meshed with chunk `key` ("cx,cy,cz"). */
  inChunk(key: string): readonly Structure[] {
    return this.homes.get(key) ?? []
  }

  /** Structure owning voxel (x, y, z), if any. */
  ownerOf(x: number, y: number, z: number): Structure | undefined {
    return this.owners.get(voxelKey(x, y, z))
  }

  /** Whether voxel (x, y, z) lies inside the bounds of some structure (under a deck, by a post...). */
  within(x: number, y: number, z: number): boolean {
    return this.boxes.some(
      (b) =>
        x >= b.min.x &&
        x <= b.max.x &&
        y >= b.min.y &&
        y <= b.max.y &&
        z >= b.min.z &&
        z <= b.max.z,
    )
  }

  /** Whether a structure owns voxel (x, y, z) (it is drawn by that structure's mesh). */
  owns(x: number, y: number, z: number): boolean {
    return this.owners.has(voxelKey(x, y, z))
  }
}

/**
 * Voxel whose chunk carries the structure's mesh: its first owned voxel
 * (that chunk exists, the voxel is in it), else the bounds' corner.
 */
function homeVoxel(owned: readonly VoxelCoord[], fallback: VoxelCoord): VoxelCoord {
  return owned[0] ?? fallback
}
