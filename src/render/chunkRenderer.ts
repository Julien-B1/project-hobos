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
import { FOLIAGE_CARD_REACH } from './meshing/treeMesher'
import {
  addStencilCompanions,
  setCompanionsVisible,
  syncCompanions,
  type StencilMaterials,
} from './sectionCap'

/** Layers left out of picking: decoration whose shapes do not match voxels. */
const UNPICKABLE: ReadonlySet<string> = new Set(['foliage', 'scatter', 'props'])

/** Solid layers: closed shells counted by the cut section's stencil pass. */
const SOLID: ReadonlySet<string> = new Set(['terrain', 'blocks', 'props'])

/** Tallest scatter card, in world units (bounding sphere margin). */
const SCATTER_REACH = 1.6
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
  /** Whether the cut section's stencil companions are drawn. */
  private sectionOn = false
  /** Layers hidden by the performance probes. */
  private readonly hidden = new Set<MeshLayer>()

  /**
   * @param materials One material per layer, shared by all chunks (the
   *   engine owns and disposes them).
   * @param stencil Materials of the cut section's stencil companions
   *   (`sectionCap.ts`), added to the solid layers' meshes; none when null.
   */
  constructor(
    private readonly map: VoxelMap,
    private readonly mesher: LayeredMesher,
    private readonly materials: LayerMaterials,
    private readonly stencil: StencilMaterials | null = null,
  ) {
    this.group.name = 'chunks'
  }

  /** Draw (true) or skip the stencil companions of the solid layers (cut on/off). */
  setSectionVisible(on: boolean): void {
    this.sectionOn = on
    for (const layers of this.meshes.values()) {
      for (const mesh of Object.values(layers)) setCompanionsVisible(mesh, on)
    }
  }

  /** Show or hide one layer in every chunk (performance probes). */
  setLayerVisible(layer: MeshLayer, visible: boolean): void {
    if (visible) this.hidden.delete(layer)
    else this.hidden.add(layer)
    for (const layers of this.meshes.values()) {
      const mesh = layers[layer]
      if (mesh) mesh.visible = visible
    }
  }

  /** Meshes of one layer, every chunk (a fresh array each call). */
  layerMeshes(layer: MeshLayer): Mesh[] {
    const out: Mesh[] = []
    for (const layers of this.meshes.values()) {
      const mesh = layers[layer]
      if (mesh) out.push(mesh)
    }
    return out
  }

  /**
   * Meshes to raycast against for picking (a fresh array each call).
   * Foliage and ground decoration are left out: they do not match voxel
   * faces, and the cursor reaches the ground or trunk through them.
   */
  get pickables(): Mesh[] {
    const out: Mesh[] = []
    for (const layers of this.meshes.values()) {
      for (const [layer, mesh] of Object.entries(layers)) {
        if (!UNPICKABLE.has(layer)) out.push(mesh)
      }
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
      // Foliage positions are card centres; the shader spreads the corners.
      if (layer === 'foliage' && geometry.boundingSphere) {
        geometry.boundingSphere.radius += FOLIAGE_CARD_REACH
      }
      if (layer === 'scatter' && geometry.boundingSphere) {
        geometry.boundingSphere.radius += SCATTER_REACH
      }
      if (old) {
        old.geometry.dispose()
        old.geometry = geometry
        syncCompanions(old)
        next[layer] = old
        continue
      }
      const mesh = new Mesh(geometry, this.materials[layer])
      mesh.name = `chunk ${key} ${layer}`
      mesh.userData.chunkKey = key
      mesh.userData.layer = layer
      // Water is see-through and scatter cards are tiny: they receive shadows
      // but cast none. Foliage casts through its alpha test (dappled shadows).
      mesh.castShadow = layer !== 'water' && layer !== 'scatter'
      // Clear water lets light through: shadows land on the bed, seen through
      // it; a shadow on the surface as well would show twice, offset.
      mesh.receiveShadow = layer !== 'water'
      if (this.stencil && SOLID.has(layer)) addStencilCompanions(mesh, this.stencil, this.sectionOn)
      mesh.visible = !this.hidden.has(layer)
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
  if (data.weights) {
    // Split the 8 weights per vertex into two vec4 attributes for the shader.
    const count = data.positions.length / 3
    const a = new Float32Array(count * 4)
    const b = new Float32Array(count * 4)
    for (let v = 0; v < count; v++) {
      for (let k = 0; k < 4; k++) {
        a[v * 4 + k] = data.weights[v * 8 + k] ?? 0
        b[v * 4 + k] = data.weights[v * 8 + 4 + k] ?? 0
      }
    }
    geometry.setAttribute('weightsA', new BufferAttribute(a, 4))
    geometry.setAttribute('weightsB', new BufferAttribute(b, 4))
  }
  // Needed by the raycaster's early-out test.
  geometry.computeBoundingSphere()
  geometry.computeBoundingBox()
  return geometry
}
