/**
 * Cut section by stencil: an opaque plane at the cut height, drawn exactly
 * where the cut slices solid geometry.
 *
 * Layer: render. The cut (`Engine.setCutHeight`) discards everything above
 * a height, which leaves the hollow chunk shells open. The classic stencil
 * capping technique fills them:
 * 1. every solid layer (terrain, blocks with tree trunks, props) is drawn a
 *    second time into the stencil buffer only, below the cut (same mask as
 *    the layer materials), depth test off: back faces increment, front
 *    faces decrement. Along a pixel's ray, the count is then 1 or more when
 *    the ray enters the cut plane inside solid matter (closed shells, and
 *    any union of them), 0 outside;
 * 2. a horizontal plane at the cut height is drawn where the count is
 *    positive, opaque and depth-written, before the rest of the scene: it
 *    hides whatever lies inside the solid (leaf cards and tufts poking into
 *    the ground, the inner faces), and its outline is exactly the cut of the
 *    meshes as drawn (rock crags, round trunks, stones included).
 * The stencil is cleared to {@link STENCIL_BASE} each frame, so a negative
 * count (a shell left open, e.g. a block face hidden against water) never
 * reads as solid.
 *
 * Cost while cutting: the solid layers' vertices twice more and a few
 * fragment writes with no shading; one plane. Nothing when the cut is off
 * (the companions and the plane are hidden).
 */
import { positionWorld, vec3 } from 'three/tsl'
import {
  AlwaysStencilFunc,
  BackSide,
  Color,
  DecrementWrapStencilOp,
  FrontSide,
  IncrementWrapStencilOp,
  KeepStencilOp,
  LessStencilFunc,
  Mesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  type Node,
  type UniformNode,
} from 'three/webgpu'
import { encodeOutput } from './outputEncoding'
import { sectionColor } from './terrainMaterial'

/** Value the stencil buffer is cleared to; counts above it mean "inside". */
export const STENCIL_BASE = 128

/** Draw order: stencil passes first, then the plane, then the scene (0). */
const STENCIL_ORDER = -2
const PLANE_ORDER = -1

/** Colour of the section (sRGB), before darkening and hatching. */
const SECTION_COLOR = 0x8a6f52

/** Half the side of the section plane, in world units (covers any test map). */
const PLANE_HALF = 512

/** Stencil-only materials of the solid layers' companion meshes. */
export interface StencilMaterials {
  /** Back faces: increment. */
  readonly back: MeshBasicNodeMaterial
  /** Front faces: decrement. */
  readonly front: MeshBasicNodeMaterial
}

/** Create the stencil materials, masked by the cut like the layer materials. */
export function createStencilMaterials(cutHeight: UniformNode<'float'>): StencilMaterials {
  const make = (back: boolean): MeshBasicNodeMaterial => {
    const material = new MeshBasicNodeMaterial({
      side: back ? BackSide : FrontSide,
      colorWrite: false,
      depthWrite: false,
      depthTest: false,
      stencilWrite: true,
      stencilFunc: AlwaysStencilFunc,
      stencilZPass: back ? IncrementWrapStencilOp : DecrementWrapStencilOp,
    })
    material.name = back ? 'section stencil back' : 'section stencil front'
    material.maskNode = positionWorld.y.lessThan(cutHeight)
    return material
  }
  return { back: make(true), front: make(false) }
}

/**
 * Add the two stencil companions of a solid chunk mesh (children sharing its
 * geometry). They follow the mesh's geometry swaps through `syncCompanions`.
 */
export function addStencilCompanions(
  mesh: Mesh,
  materials: StencilMaterials,
  visible: boolean,
): void {
  for (const material of [materials.back, materials.front]) {
    const companion = new Mesh(mesh.geometry, material)
    companion.name = `${mesh.name} ${material.name}`
    companion.renderOrder = STENCIL_ORDER
    companion.castShadow = false
    companion.receiveShadow = false
    companion.visible = visible
    companion.userData.stencilCompanion = true
    companion.raycast = () => undefined
    mesh.add(companion)
  }
}

/** Point the companions of `mesh` at its current geometry. */
export function syncCompanions(mesh: Mesh): void {
  for (const child of mesh.children) {
    if (child instanceof Mesh && child.userData.stencilCompanion === true) {
      child.geometry = mesh.geometry
    }
  }
}

/** Show or hide the companions of `mesh`. */
export function setCompanionsVisible(mesh: Mesh, visible: boolean): void {
  for (const child of mesh.children) {
    if (child.userData.stencilCompanion === true) child.visible = visible
  }
}

/** The section plane. Add {@link SectionPlane.mesh} to the scene. */
export class SectionPlane {
  readonly mesh: Mesh
  private readonly material: MeshBasicNodeMaterial

  constructor() {
    const earth = new Color(SECTION_COLOR) // linear RGB
    const base: Node<'vec3'> = vec3(earth.r, earth.g, earth.b)
    this.material = new MeshBasicNodeMaterial({
      stencilWrite: true,
      stencilRef: STENCIL_BASE,
      stencilFunc: LessStencilFunc, // passes where STENCIL_BASE < stencil
      stencilFail: KeepStencilOp,
      stencilZFail: KeepStencilOp,
      stencilZPass: KeepStencilOp,
    })
    this.material.name = 'section plane'
    this.material.colorNode = sectionColor(base)
    encodeOutput(this.material)
    const geometry = new PlaneGeometry(2 * PLANE_HALF, 2 * PLANE_HALF)
    geometry.rotateX(-Math.PI / 2)
    this.mesh = new Mesh(geometry, this.material)
    this.mesh.name = 'section plane'
    this.mesh.renderOrder = PLANE_ORDER
    this.mesh.frustumCulled = false
    this.mesh.visible = false
    this.mesh.raycast = () => undefined
  }

  /** Place the plane at world height `height`, or hide it with null. */
  update(height: number | null): void {
    this.mesh.visible = height !== null
    if (height !== null) this.mesh.position.y = height
  }

  /** Release GPU resources. */
  dispose(): void {
    this.mesh.geometry.dispose()
    this.material.dispose()
  }
}
