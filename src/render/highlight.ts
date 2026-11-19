/**
 * Hover highlight: a translucent patch laid on the targeted surface cell.
 *
 * Used for block tops; the faceted terrain is tinted by its own shader
 * instead (`terrainMaterial.ts` `applyHover`), exact on the drawn ground.
 *
 * Layer: render. The patch is a small grid (GRID x GRID quads) whose vertex
 * heights come from a sampling function, so it can follow a blocky top
 * (corner heights) or the smooth terrain mesh (downward raycasts). The
 * engine decides how to sample; this class only owns the geometry.
 */
import { positionWorld } from 'three/tsl'
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Mesh,
  MeshBasicNodeMaterial,
  type UniformNode,
} from 'three/webgpu'

/** Subdivisions per side of the patch. */
export const HIGHLIGHT_GRID = 3

/**
 * Small lift above the surface, in world units, so the patch does not
 * z-fight with the terrain it covers.
 */
const LIFT = 0.03

/** World height of the surface at a point of the cell (fx, fz in [0, 1]). */
export type SurfaceSampler = (fx: number, fz: number) => number

/** Translucent patch marking the hovered surface. Hidden until `show` is called. */
export class SurfaceHighlight {
  /** Scene object to add to the scene once. */
  readonly mesh: Mesh
  private readonly positions = new Float32Array((HIGHLIGHT_GRID + 1) ** 2 * 3)

  /**
   * @param cutHeight Cut height uniform (world units): the patch is cut like
   *   the scene, nothing of it shows above the cut.
   */
  constructor(cutHeight: UniformNode<'float'>, color = 0xffe066) {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(this.positions, 3))
    geometry.setIndex(gridIndices(HIGHLIGHT_GRID))
    const material = new MeshBasicNodeMaterial({
      color,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      side: DoubleSide,
    })
    material.maskNode = positionWorld.y.lessThan(cutHeight)
    this.mesh = new Mesh(geometry, material)
    this.mesh.name = 'surface-highlight'
    this.mesh.visible = false
    // Draw after opaque geometry so transparency blends over it.
    this.mesh.renderOrder = 1
    // Never pick the highlight itself.
    this.mesh.raycast = () => undefined
  }

  /** Show the patch over cell (x, z), with heights from `heightAt`. */
  show(x: number, z: number, heightAt: SurfaceSampler): void {
    const g = HIGHLIGHT_GRID
    for (let j = 0; j <= g; j++) {
      for (let i = 0; i <= g; i++) {
        const fx = i / g
        const fz = j / g
        this.positions.set([x + fx, heightAt(fx, fz) + LIFT, z + fz], (i + j * (g + 1)) * 3)
      }
    }
    const geometry = this.mesh.geometry
    geometry.getAttribute('position').needsUpdate = true
    geometry.computeBoundingSphere()
    this.mesh.visible = true
  }

  /** Hide the patch. */
  hide(): void {
    this.mesh.visible = false
  }
}

/** Triangle indices of a (g + 1) x (g + 1) vertex grid. */
function gridIndices(g: number): number[] {
  const indices: number[] = []
  for (let j = 0; j < g; j++) {
    for (let i = 0; i < g; i++) {
      const a = i + j * (g + 1)
      const b = a + 1
      const c = a + g + 1
      const d = c + 1
      indices.push(a, c, b, b, c, d)
    }
  }
  return indices
}
