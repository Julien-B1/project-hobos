/**
 * Hover highlight: a translucent quad laid on the targeted surface.
 *
 * Layer: render. The quad follows the top of the surface voxel, so it lies
 * flat on blocks and tilts on slopes. Positioned by the engine after picking.
 */
import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, MeshBasicMaterial } from 'three/webgpu'
import { VOXEL_HEIGHT } from '@/core/coords'
import type { CornerHeights } from '@/core/shapes'

/**
 * Small lift above the surface, in world units, so the quad does not
 * z-fight with the terrain it covers.
 */
const LIFT = 0.02

/** Corner offsets (dx, dz) within a cell, in `CornerHeights` order. */
const CORNERS: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
]

/** Translucent quad marking the hovered surface. Hidden until `show` is called. */
export class SurfaceHighlight {
  /** Scene object to add to the scene once. */
  readonly mesh: Mesh
  private readonly positions = new Float32Array(4 * 3)

  constructor(color = 0xffe066) {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(this.positions, 3))
    geometry.setIndex([0, 2, 1, 0, 3, 2]) // up-facing, but drawn double-sided anyway
    const material = new MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      side: DoubleSide,
    })
    this.mesh = new Mesh(geometry, material)
    this.mesh.name = 'surface-highlight'
    this.mesh.visible = false
    // Draw after opaque geometry so transparency blends over it.
    this.mesh.renderOrder = 1
    // Never pick the highlight itself.
    this.mesh.raycast = () => undefined
  }

  /**
   * Show the highlight on top of voxel (x, y, z), following its top corner
   * heights (voxel units).
   */
  show(x: number, y: number, z: number, corners: CornerHeights): void {
    CORNERS.forEach(([dx, dz], i) => {
      const h = corners[i as 0 | 1 | 2 | 3]
      this.positions.set([x + dx, (y + h) * VOXEL_HEIGHT + LIFT, z + dz], i * 3)
    })
    const geometry = this.mesh.geometry
    const position = geometry.getAttribute('position')
    position.needsUpdate = true
    geometry.computeBoundingSphere()
    this.mesh.visible = true
  }

  /** Hide the highlight. */
  hide(): void {
    this.mesh.visible = false
  }
}
