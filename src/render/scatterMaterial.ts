/**
 * Materials of the ground decoration layers (TSL node materials).
 *
 * Layer: render. Data comes from `meshing/scatterMesher.ts`.
 * - **Scatter cards** (grass tufts, flowers, reeds, algae, fallen leaves):
 *   alpha-tested cards from the foliage atlas, 1 texture fetch per pixel.
 *   All 4 vertices sit at the item's base; the vertex stage spreads them:
 *   upright cards turn around the vertical axis to face the camera (their
 *   base stays on the ground) and sway with the wind at the top; flat cards
 *   lie on the ground. Lit as ground (normal straight up), no shadow cast.
 * - **Props** (pebbles, rocks): flat-shaded vertex colours with a light
 *   noise variation; no grid.
 */
import {
  attribute,
  cameraWorldMatrix,
  dFdx,
  dFdy,
  dot,
  float,
  log2,
  max,
  mix,
  normalize,
  positionGeometry,
  positionWorld,
  texture,
  transformNormalToView,
  vec3,
  vec4,
  vertexColor,
} from 'three/tsl'
import { DoubleSide, MeshStandardNodeMaterial, type DataTexture } from 'three/webgpu'
import { LEAF_TEXTURE_SIZE } from './leafTexture'
import { windSway } from './wind'

/**
 * Mip bias of the atlas: sharper blades at a distance. Without it, far tufts
 * blur into blobs; thin blades may instead thin out, which reads better.
 */
const MIP_BIAS = -1.2
/** Alpha boost per mip level (see `foliageMaterial.ts`), kept low for thin blades. */
const ALPHA_PER_MIP = 0.1
/** Wind sway at the top of a card with sway 1, in world units. */
const SWAY = 0.08
/** Height of flat cards above the ground, in world units (avoids z-fighting). */
const FLAT_LIFT = 0.015

/** Create the material of the scatter layer (cards from the foliage atlas). */
export function createScatterMaterial(atlas: DataTexture): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({
    side: DoubleSide,
    roughness: 0.9,
    metalness: 0,
    alphaTest: 0.5,
  })
  material.name = 'scatter'
  material.alphaToCoverage = true

  const wa = attribute('weightsA', 'vec4')
  const wb = attribute('weightsB', 'vec4')
  const uv = wa.xy
  const corner = wa.zw
  const half = wb.x
  const height = wb.y
  const sway = wb.z
  const mode = wb.w

  // Upright: camera right projected on the ground plane, world up.
  const camRight = cameraWorldMatrix.mul(vec4(1, 0, 0, 0)).xyz
  const right = normalize(vec3(camRight.x, 0, camRight.z))
  const base = positionGeometry
  const upright = base
    .add(right.mul(corner.x.mul(half)))
    .add(vec3(0, corner.y.mul(height), 0))
    .add(windSway(base).mul(SWAY).mul(sway).mul(corner.y))
  const flat = base.add(vec3(corner.x.mul(half), FLAT_LIFT, corner.y.mul(half)))
  material.positionNode = mix(upright, flat, mode)

  const leaf = texture(atlas, uv).bias(float(MIP_BIAS))
  const texel = uv.mul(LEAF_TEXTURE_SIZE)
  const dx = dFdx(texel)
  const dy = dFdy(texel)
  const mip = max(float(0), log2(max(dot(dx, dx), dot(dy, dy))).mul(0.5))
  const alpha = leaf.a.mul(mip.mul(ALPHA_PER_MIP).add(1))
  material.colorNode = vec4(vertexColor().rgb.mul(leaf.rgb), alpha)
  material.normalNode = transformNormalToView(vec3(0, 1, 0))
  return material
}

/** Create the material of the props layer (small rocks). */
export function createPropsMaterial(noise: DataTexture): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0 })
  material.name = 'props'
  const p = positionWorld
  const variation = texture(noise, p.xz.add(p.y).div(1.7)).g.mul(0.3).add(0.85)
  material.colorNode = vertexColor().rgb.mul(variation)
  return material
}
