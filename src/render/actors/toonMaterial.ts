/**
 * Toon (cel) shading for characters: banded light, a rim light and an ink
 * outline.
 *
 * Layer: render (TSL node materials).
 * - Body: `MeshToonNodeMaterial`, the diffuse light quantised by a tiny
 *   gradient texture into {@link BANDS} hard steps (sun shadows included),
 *   plus a warm rim on the silhouette (a few ALU).
 * - Outline: the "inverted hull": a second draw of the same skinned mesh,
 *   pushed out along its normals after skinning, back faces only, flat ink
 *   colour. One extra draw per character mesh, no post-processing.
 * Both end with the scene's output encoding and are cut at the cut height.
 */
import {
  float,
  max,
  normalLocal,
  normalView,
  positionLocal,
  positionViewDirection,
  positionWorld,
  pow,
  vec3,
} from 'three/tsl'
import {
  BackSide,
  DataTexture,
  MeshBasicNodeMaterial,
  MeshToonNodeMaterial,
  NearestFilter,
  RGBAFormat,
  type Side,
  type Texture,
  type UniformNode,
} from 'three/webgpu'
import { encodeOutput } from '../outputEncoding'

/** Light levels of the bands, darkest to brightest (0..255). */
const BANDS = [96, 176, 255]

/** Outline thickness, in model units (the model is about 1 unit tall). */
const OUTLINE_WIDTH = 0.0045

/** Ink colour of the outline. */
const OUTLINE_COLOR = 0x3b2b20

/** Rim light: strength and sharpness. */
const RIM_STRENGTH = 0.22
const RIM_POWER = 3

/** Gradient texture of the bands (nearest filtering: hard steps). */
function bandTexture(): DataTexture {
  const data = new Uint8Array(BANDS.length * 4)
  BANDS.forEach((v, i) => {
    data.set([v, v, v, 255], i * 4)
  })
  const texture = new DataTexture(data, BANDS.length, 1, RGBAFormat)
  texture.minFilter = NearestFilter
  texture.magFilter = NearestFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

/** Shared band texture (created on first use). */
let bands: DataTexture | null = null

/** Toon material of a character mesh, textured with `map`. */
export function createToonMaterial(
  map: Texture | null,
  side: Side,
  cutHeight: UniformNode<'float'>,
): MeshToonNodeMaterial {
  bands ??= bandTexture()
  const material = new MeshToonNodeMaterial({ map, gradientMap: bands, side })
  // Warm light on the silhouette: reads the shape against the ground.
  const facing = max(normalView.dot(positionViewDirection), float(0))
  material.emissiveNode = vec3(1, 0.93, 0.8).mul(
    pow(float(1).sub(facing), float(RIM_POWER)).mul(RIM_STRENGTH),
  )
  material.maskNode = positionWorld.y.lessThan(cutHeight)
  return encodeOutput(material)
}

/** Outline material: the skinned mesh inflated along its normals, back faces only. */
export function createOutlineMaterial(cutHeight: UniformNode<'float'>): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({ color: OUTLINE_COLOR, side: BackSide })
  // positionLocal and normalLocal are already skinned here.
  material.positionNode = positionLocal.add(normalLocal.normalize().mul(OUTLINE_WIDTH))
  material.maskNode = positionWorld.y.lessThan(cutHeight)
  return encodeOutput(material)
}
