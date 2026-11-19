/**
 * Foliage material: camera-facing, alpha-tested leaf cards (TSL node
 * material).
 *
 * Layer: render. Cost per foliage pixel: 1 texture fetch (leaf atlas,
 * `leafTexture.ts`) and a few ALU; cards overlap, so a canopy is shaded a
 * few times per pixel. Per vertex: a few ALU to place the card. Edges use
 * alpha to coverage (smooth with the 4x MSAA already in place, no blending,
 * no sorting).
 *
 * - Placement: all 4 vertices of a card sit at its centre; the vertex stage
 *   moves each one along the current camera's right and up axes by its
 *   corner offset times the card half size (data from `treeMesher.ts`). The
 *   card always faces the camera, so a canopy reads as a full volume with
 *   leafy edges; in the shadow pass the "camera" is the sun's, so cards face
 *   the sun and cast a full, dappled shadow.
 * - Wind: each card sways with the wind (`wind.ts`), more at the top of the
 *   canopy, and its corners flutter a little. The shadow pass uses the
 *   still cards (`castShadowPositionNode`), so the shadow map is not
 *   re-rendered every frame.
 * - Shadows received: one lookup position per card (its centre), so the
 *   canopy gets soft, card-sized dappling instead of hard edges.
 * - Colour: vertex colour (per-card tint and fake occlusion) times the leaf
 *   shade; alpha: the leaf mask, boosted per mip level (mipmapped alpha
 *   shrinks with distance and would make far canopies vanish).
 * - Normal: per pixel, out of the canopy's ellipsoid (from the canopy centre
 *   stored per vertex), slightly biased upwards, so the canopy is lit as one
 *   rounded volume.
 */
import {
  attribute,
  cameraWorldMatrix,
  clamp,
  dFdx,
  dFdy,
  dot,
  float,
  log2,
  max,
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
import { windFlutter, windSway } from './wind'

/** Alpha boost per mip level, compensating mipmap coverage loss. */
const ALPHA_PER_MIP = 0.3
/** Vertical stretch of the canopy ellipsoid used for the normals. */
const CANOPY_FLATNESS = 1.5
/** Upward bias of the canopy normals (brighter tops). */
const NORMAL_UP_BIAS = 0.35
/** Wind sway of a card at the top of a canopy, in world units. */
const SWAY = 0.07
/** Corner flutter, as a fraction of the card half size. */
const FLUTTER = 0.06

/**
 * Create the material of the foliage layer. Chunk meshes have an identity
 * transform, so local positions are world positions.
 */
export function createFoliageMaterial(leaves: DataTexture): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({
    side: DoubleSide,
    roughness: 0.85,
    metalness: 0,
    alphaTest: 0.5,
  })
  material.name = 'foliage'
  material.alphaToCoverage = true

  const wa = attribute('weightsA', 'vec4')
  const wb = attribute('weightsB', 'vec4')
  const uv = wa.xy
  const corner = wa.zw
  const half = wb.x
  const canopy = wb.yzw

  // Billboard: spread the corners along the camera's right and up axes.
  const right = cameraWorldMatrix.mul(vec4(1, 0, 0, 0)).xyz
  const up = cameraWorldMatrix.mul(vec4(0, 1, 0, 0)).xyz
  const still = positionGeometry.add(right.mul(corner.x.mul(half))).add(up.mul(corner.y.mul(half)))
  // Sway grows from the canopy's lower half to its top.
  const height = clamp(positionGeometry.y.sub(canopy.y).add(1.2).div(2.4), 0, 1)
  const sway = windSway(canopy).mul(SWAY).mul(height.mul(0.7).add(0.3))
  const flutter = windFlutter(positionGeometry).mul(FLUTTER).mul(half)
  material.positionNode = still
    .add(sway)
    .add(right.mul(corner.x.mul(flutter)))
    .add(up.mul(corner.y.mul(flutter)))
  material.castShadowPositionNode = still
  // Received shadows are looked up at the card centre: a whole card is lit
  // or shaded. Per-pixel lookups on overlapping camera-facing cards drew
  // hard shadow edges slicing through the canopy.
  material.receivedShadowPositionNode = positionGeometry

  const leaf = texture(leaves, uv)
  const texel = uv.mul(LEAF_TEXTURE_SIZE)
  const dx = dFdx(texel)
  const dy = dFdy(texel)
  const mip = max(float(0), log2(max(dot(dx, dx), dot(dy, dy))).mul(0.5))
  const alpha = leaf.a.mul(mip.mul(ALPHA_PER_MIP).add(1))
  material.colorNode = vec4(vertexColor().rgb.mul(leaf.rgb), alpha)

  const d = positionWorld.sub(canopy)
  const n = normalize(vec3(d.x, d.y.mul(CANOPY_FLATNESS), d.z)).add(vec3(0, NORMAL_UP_BIAS, 0))
  material.normalNode = transformNormalToView(normalize(n))
  return material
}
