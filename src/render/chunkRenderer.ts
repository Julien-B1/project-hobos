/**
 * Chunk renderer: one Three.js mesh per non-empty chunk, rebuilt on demand.
 *
 * Layer: render. Reads the `VoxelMap` (never writes it) and consumes its
 * dirty set: `update()` rebuilds only the chunks whose keys were drained,
 * which is what keeps edits cheap (a voxel edit rebuilds its chunk, plus its
 * face neighbours when the voxel is on a border).
 */
import { BufferAttribute, BufferGeometry, Group, Mesh, MeshStandardMaterial } from 'three/webgpu'
import type { VoxelMap } from '@/core/voxelMap'
import { isEmptyMesh, type ChunkMesher, type MeshData } from './meshing/mesher'

/** Owns the chunk meshes of one map. Add {@link ChunkRenderer.group} to the scene. */
export class ChunkRenderer {
  /** Parent of every chunk mesh. */
  readonly group = new Group()
  private readonly meshes = new Map<string, Mesh>()
  /** One material shared by all chunks: colours come from vertex attributes. */
  private readonly material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.92 })

  constructor(
    private readonly map: VoxelMap,
    private readonly mesher: ChunkMesher,
  ) {
    this.group.name = 'chunks'
  }

  /** Meshes to raycast against for picking (a fresh array each call). */
  get pickables(): Mesh[] {
    return [...this.meshes.values()]
  }

  /** Number of chunk meshes currently in the scene. */
  get meshCount(): number {
    return this.meshes.size
  }

  /**
   * Rebuild every dirty chunk. Call once per frame.
   *
   * @returns Keys of the chunks whose mesh was rebuilt or removed, for debug.
   *   Dirty keys of chunks that have no voxels and had no mesh are skipped.
   */
  update(): string[] {
    const touched: string[] = []
    for (const key of this.map.drainDirty()) {
      if (this.rebuild(key)) touched.push(key)
    }
    return touched
  }

  /** Release GPU resources. */
  dispose(): void {
    for (const mesh of this.meshes.values()) mesh.geometry.dispose()
    this.meshes.clear()
    this.group.clear()
    this.material.dispose()
  }

  /** Rebuild one chunk: replace, create or remove its mesh. Returns false when nothing existed. */
  private rebuild(key: string): boolean {
    const chunk = this.map.getChunk(key)
    const existing = this.meshes.get(key)
    const data = chunk ? this.mesher.mesh(this.map, chunk) : null

    if (!data || isEmptyMesh(data)) {
      // Chunk deleted, or fully hidden: drop its mesh if it had one.
      if (existing) {
        this.group.remove(existing)
        existing.geometry.dispose()
        this.meshes.delete(key)
      }
      return Boolean(existing) || Boolean(chunk)
    }

    const geometry = toGeometry(data)
    if (existing) {
      existing.geometry.dispose()
      existing.geometry = geometry
      return true
    }
    const mesh = new Mesh(geometry, this.material)
    mesh.name = `chunk ${key}`
    mesh.userData.chunkKey = key
    this.meshes.set(key, mesh)
    this.group.add(mesh)
    return true
  }
}

/** Upload mesher output into a BufferGeometry. */
function toGeometry(data: MeshData): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(data.positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(data.normals, 3))
  geometry.setAttribute('color', new BufferAttribute(data.colors, 3))
  geometry.setIndex(new BufferAttribute(data.indices, 1))
  // Needed by the raycaster's early-out test.
  geometry.computeBoundingSphere()
  geometry.computeBoundingBox()
  return geometry
}
