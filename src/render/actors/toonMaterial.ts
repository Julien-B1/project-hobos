/**
 * Cel shading for characters, in the anime style of recent action RPGs:
 * flat colours, one sharp light / shade boundary, tinted shade, a crisp rim
 * light and a thin outline in a darker shade of the surface colour.
 *
 * Layer: render (TSL node materials). The texture is expected flat (the
 * model's painted shading removed, `tooling/compress_glb.py --flat`).
 * - Body: `MeshToonNodeMaterial` with a two-step gradient: the sun's light
 *   is all or nothing ({@link BANDS}, sun shadows included). The shade is
 *   not grey: an emissive term adds the surface colour times
 *   {@link SHADE_TINT} (cool, slightly violet) everywhere, so shaded parts
 *   keep their hue. A rim of light outlines the silhouette (a few ALU).
 * - Outline: the "inverted hull": a second draw of the same skinned mesh,
 *   pushed out along its normals after skinning, back faces only, coloured
 *   by the texture times {@link OUTLINE_TINT}. One extra draw per character
 *   mesh, no post-processing.
 * Both end with the scene's output encoding. Neither is cut: the character
 * is shown or hidden whole (`cutSupported.ts`).
 */
import {
  cameraPosition,
  float,
  max,
  modelWorldMatrix,
  normalLocal,
  normalView,
  positionLocal,
  positionViewDirection,
  smoothstep,
  texture,
  uv,
  vec3,
  vec4,
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
} from 'three/webgpu'
import { encodeOutput } from '../outputEncoding'

/** Sun light levels of the bands, shade then light (0..255). */
const BANDS = [0, 215]

/** Colour of the shade, as a factor of the surface colour (linear RGB). */
const SHADE_TINT = [0.3, 0.27, 0.36] as const

/**
 * Outline thickness per unit of distance to the camera, in model units:
 * about 1 pixel at any zoom (30 degree field of view, 800 pixel high view,
 * model scaled 1.6). A fixed thickness turned sub-pixel when zoomed out,
 * and flickered.
 */
const OUTLINE_PER_DISTANCE = 0.0005

/** Outline colour, as a factor of the surface colour. */
const OUTLINE_TINT = 0x4a3f48

/** Rim light: strength, and where it starts (1 - facing ratio). */
const RIM_STRENGTH = 0.18
const RIM_START = 0.62

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
export function createToonMaterial(map: Texture | null, side: Side): MeshToonNodeMaterial {
  bands ??= bandTexture()
  const material = new MeshToonNodeMaterial({ map, gradientMap: bands, side })
  const albedo = map ? texture(map, uv()).rgb : vec3(1, 1, 1)
  // Crisp light on the silhouette: reads the shape against the ground.
  const facing = max(normalView.dot(positionViewDirection), float(0))
  const rim = smoothstep(float(RIM_START), float(RIM_START + 0.06), float(1).sub(facing))
  material.emissiveNode = albedo
    .mul(vec3(...SHADE_TINT))
    .add(vec3(1, 0.96, 0.9).mul(rim.mul(RIM_STRENGTH)))
  return encodeOutput(material)
}

/**
 * Outline material: the skinned mesh inflated along its normals, back faces
 * only, in a darker shade of its texture `map`.
 */
export function createOutlineMaterial(map: Texture | null): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({ map, color: OUTLINE_TINT, side: BackSide })
  // positionLocal and normalLocal are already skinned here.
  const distance = modelWorldMatrix.mul(vec4(positionLocal, 1)).xyz.distance(cameraPosition)
  material.positionNode = positionLocal.add(
    normalLocal.normalize().mul(distance.mul(OUTLINE_PER_DISTANCE)),
  )
  return encodeOutput(material)
}
