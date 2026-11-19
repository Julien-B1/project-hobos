/**
 * Hover highlight: a translucent quad drawn over the targeted cell.
 *
 * Layer: render. Positioned in world units by the engine after picking.
 */
import { DoubleSide, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three/webgpu'

/**
 * Small lift above the surface, in world units, so the quad does not
 * z-fight with the ground it covers.
 */
const LIFT = 0.01

/** Translucent quad marking the hovered cell. Hidden until `showCell` is called. */
export class CellHighlight {
  /** Scene object to add to the scene once. */
  readonly mesh: Mesh

  constructor(color = 0xffe066) {
    // PlaneGeometry lies in XY; rotate it to lie flat in XZ.
    const geometry = new PlaneGeometry(1, 1)
    geometry.rotateX(-Math.PI / 2)
    const material = new MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      side: DoubleSide,
    })
    this.mesh = new Mesh(geometry, material)
    this.mesh.name = 'cell-highlight'
    this.mesh.visible = false
    // Draw after opaque geometry so transparency blends over it.
    this.mesh.renderOrder = 1
  }

  /**
   * Show the highlight on top of cell (x, z) at world height `surfaceY`.
   * The quad is centred on the cell: cell (x, z) spans [x, x+1] x [z, z+1].
   */
  showCell(x: number, z: number, surfaceY: number): void {
    this.mesh.position.set(x + 0.5, surfaceY + LIFT, z + 0.5)
    this.mesh.visible = true
  }

  /** Hide the highlight. */
  hide(): void {
    this.mesh.visible = false
  }
}
