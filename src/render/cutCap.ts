/**
 * Cut cap: the mesh that fills the built blocks the cut plane slices (see
 * `meshing/capMesher.ts`), rebuilt when the cut height or the map changes.
 * Everything else is filled by the stencil-masked section plane
 * (`sectionCap.ts`), which this cap is drawn over.
 *
 * Layer: render. One mesh for the whole map (maps are encounter sized), not
 * pickable. Its material shows the cut material's colour, darkened and
 * hatched (`sectionColor`), the usual way to draw a section, unlit like
 * the terrain's section. Cost: a few ALU per pixel, no texture.
 */
import { vec3, vertexColor } from 'three/tsl'
import { BufferAttribute, BufferGeometry, Mesh, MeshStandardNodeMaterial } from 'three/webgpu'
import type { VoxelMap } from '@/core/voxelMap'
import type { CapMesher } from './meshing/capMesher'
import { encodeOutput } from './outputEncoding'
import { sectionColor } from './terrainMaterial'

/** Owns the cap mesh. Add {@link CutCap.mesh} to the scene. */
export class CutCap {
  readonly mesh: Mesh
  private readonly material: MeshStandardNodeMaterial

  constructor(
    private readonly map: VoxelMap,
    private readonly mesher: CapMesher,
  ) {
    this.material = new MeshStandardNodeMaterial({ roughness: 1, metalness: 0 })
    this.material.name = 'cut cap'
    // Same look as the terrain's section: unlit, hatched on the screen.
    this.material.colorNode = vec3(0)
    this.material.emissiveNode = sectionColor(vertexColor().rgb)
    // Drawn over the section plane (same height) that fills everything else.
    encodeOutput(this.material)
    this.material.polygonOffset = true
    this.material.polygonOffsetFactor = -1
    this.material.polygonOffsetUnits = -4
    this.mesh = new Mesh(new BufferGeometry(), this.material)
    this.mesh.name = 'cut cap'
    this.mesh.castShadow = true
    this.mesh.receiveShadow = true
    this.mesh.visible = false
  }

  /** Rebuild the cap at world height `height`, or hide it with null. */
  update(height: number | null): void {
    this.mesh.geometry.dispose()
    if (height === null) {
      this.mesh.geometry = new BufferGeometry()
      this.mesh.visible = false
      return
    }
    const data = this.mesher.mesh(this.map, height)
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(data.positions, 3))
    geometry.setAttribute('normal', new BufferAttribute(data.normals, 3))
    geometry.setAttribute('color', new BufferAttribute(data.colors, 3))
    geometry.setIndex(new BufferAttribute(data.indices, 1))
    this.mesh.geometry = geometry
    this.mesh.visible = data.indices.length > 0
  }

  /** Release GPU resources. */
  dispose(): void {
    this.mesh.geometry.dispose()
    this.material.dispose()
  }
}
