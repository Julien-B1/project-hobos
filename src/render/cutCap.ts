/**
 * Cut cap: the mesh that fills what the cut plane slices (see
 * `meshing/capMesher.ts`), rebuilt when the cut height or the terrain
 * changes.
 *
 * Layer: render. One mesh for the whole map (maps are encounter sized), not
 * pickable. Its material shows the cut material's colour with diagonal
 * hatching, the usual way to draw a section, and is lit and shadowed like
 * the rest. Cost: a few ALU per pixel, no texture.
 */
import { float, fract, positionWorld, smoothstep, abs, vertexColor } from 'three/tsl'
import { BufferAttribute, BufferGeometry, Mesh, MeshStandardNodeMaterial } from 'three/webgpu'
import type { VoxelMap } from '@/core/voxelMap'
import type { CapMesher } from './meshing/capMesher'

/** Hatch lines per world unit, and how much they darken the cap. */
const HATCH_FREQUENCY = 3
const HATCH_STRENGTH = 0.3

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
    const stripe = abs(fract(positionWorld.x.add(positionWorld.z).mul(HATCH_FREQUENCY)).sub(0.5))
    const hatch = float(1).sub(smoothstep(0.18, 0.08, stripe).mul(HATCH_STRENGTH))
    this.material.colorNode = vertexColor().rgb.mul(hatch)
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
