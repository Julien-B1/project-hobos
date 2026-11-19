/**
 * Chunk renderer: one Three.js mesh per non-empty chunk, rebuilt on demand.
 *
 * Layer: render. Reads the `VoxelMap` (never writes it) and consumes its
 * dirty set: `update()` rebuilds only the chunks whose keys were drained,
 * which is what keeps edits cheap (a voxel edit rebuilds its chunk, plus its
 * face neighbours when the voxel is on a border).
 */
import { BufferAttribute, BufferGeometry, Group, Mesh, type Material } from 'three/webgpu'
import type { VoxelMap } from '@/core/voxelMap'
import {
  MESH_LAYERS,
  isEmptyMesh,
  type LayeredMesher,
  type MeshData,
  type MeshLayer,
} from './meshing/mesher'

/** Materials used to draw each render layer. */
export type LayerMaterials = Readonly<Record<MeshLayer, Material>>

/** Owns the chunk meshes of one map. Add {@link ChunkRenderer.group} to the scene. */
export class ChunkRenderer {
  /** Parent of every chunk mesh. */
  readonly group = new Group()
  /** Per chunk key, one mesh per non-empty layer. */
  private readonly meshes = new Map<string, Partial<Record<MeshLayer, Mesh>>>()

  /**
   * @param materials One material per layer, shared by all chunks (the
   *   engine owns and disposes them).
   */
  constructor(
    private readonly map: VoxelMap,
    private readonly mesher: LayeredMesher,
    private readonly materials: LayerMaterials,
  ) {
    this.group.name = 'chunks'
  }

  /** Meshes to raycast against for picking (a fresh array each call). */
  get pickables(): Mesh[] {
    const out: Mesh[] = []
    for (const layers of this.meshes.values()) {
      for (const mesh of Object.values(layers)) out.push(mesh)
    }
    return out
  }

  /** Number of chunks that currently have at least one mesh. */
  get meshCount(): number {
    return this.meshes.size
  }

  /**
   * Rebuild every dirty chunk. Call once per frame.
   *
   * @returns Keys of the chunks whose meshes were rebuilt or removed, for
   *   debug. Dirty keys of chunks that have no voxels and had no mesh are
   *   skipped.
   */
  update(): string[] {
    const touched: string[] = []
    for (const key of this.map.drainDirty()) {
      if (this.rebuild(key)) touched.push(key)
    }
    return touched
  }

  /** Release geometries (materials belong to the engine). */
  dispose(): void {
    for (const layers of this.meshes.values()) {
      for (const mesh of Object.values(layers)) mesh.geometry.dispose()
    }
    this.meshes.clear()
    this.group.clear()
  }

  /** Rebuild one chunk's layers. Returns false when nothing existed or exists. */
  private rebuild(key: string): boolean {
    const chunk = this.map.getChunk(key)
    const existing = this.meshes.get(key) ?? {}
    const hadAny = Object.keys(existing).length > 0
    const data = chunk ? this.mesher.mesh(this.map, chunk) : null
    const next: Partial<Record<MeshLayer, Mesh>> = {}

    for (const layer of MESH_LAYERS) {
      const old = existing[layer]
      const part = data?.[layer]
      if (!part || isEmptyMesh(part)) {
        if (old) {
          this.group.remove(old)
          old.geometry.dispose()
        }
        continue
      }
      const geometry = toGeometry(part)
      if (old) {
        old.geometry.dispose()
        old.geometry = geometry
        next[layer] = old
        continue
      }
      const mesh = new Mesh(geometry, this.materials[layer])
      mesh.name = `chunk ${key} ${layer}`
      mesh.userData.chunkKey = key
      mesh.userData.layer = layer
      this.group.add(mesh)
      next[layer] = mesh
    }

    if (Object.keys(next).length > 0) this.meshes.set(key, next)
    else this.meshes.delete(key)
    return hadAny || Boolean(chunk)
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
