/**
 * Water surface material (TSL node material), designed to be cheap.
 *
 * Layer: render. Per water pixel: 2 fetches of the shared noise texture
 * (`noiseTexture.ts`) plus a few mixes. No refraction pass, no scene copy,
 * no GPU noise function.
 *
 * - **Depth**: each vertex carries the water depth above the bed (computed by
 *   the terrain mesher, interpolated per pixel). Like real water, the tint
 *   comes from depth: shallows are almost clear (the bed shows, lit or in
 *   shadow, instead of a saturated layer that would glow cyan in shadows),
 *   deep water is dark blue and nearly opaque; the surface fades out at the
 *   shore, so shorelines are soft lines instead of the hard intersection
 *   with the banks.
 * - **Foam**: a thin, noise-broken lighter band where the depth is small.
 * - **Grid**: the battle-map grid continues over the water (`gridOverlay.ts`).
 * - **Ripples**: two layers of the noise texture scrolling in different
 *   directions gently tilt the shading normal (diffuse lighting).
 * - **Sun sheen, view-independent**: a real specular highlight depends on
 *   the camera, so it showed as one bright spot that moved when the view
 *   turned. The material's specular is off; instead, the sun adds a broad
 *   sheen computed as if the water were seen from straight above (sun
 *   half-vector with the vertical), plus sparse glints where the two
 *   ripple layers peak together. Both depend only on the sun direction and
 *   the ripples, so the whole surface looks the same from every side, like
 *   a wide, parallel sunlight.
 * - **Reflectance**: physical material with the IOR of water (1.33); no
 *   transmission or other physical extension, so the cost is that of the
 *   standard model.
 */
import {
  attribute,
  color,
  dot,
  float,
  max,
  mix,
  normalize,
  pow,
  positionWorld,
  smoothstep,
  texture,
  time,
  transformNormalToView,
  vec2,
  vec3,
} from 'three/tsl'
import { MeshPhysicalNodeMaterial, type DataTexture } from 'three/webgpu'
import { applyGrid, type GridOpacity } from './gridOverlay'
import type { LightUniforms } from './lightUniforms'

/** Colours (sRGB hex) of shallow water, deep water and foam. */
const SHALLOW = 0x86b3ad
const DEEP = 0x14435e
const FOAM = 0xe8f2ef

/** Depth (world units) at which the water reaches its deep colour and opacity. */
const DEEP_AT = 1.3
/** Depth (world units) over which the surface fades in from the shoreline. */
const SHORE_FADE = 0.3
/** Opacity of shallow and deep water. */
const SHALLOW_OPACITY = 0.3
const DEEP_OPACITY = 0.92

/** World units covered by one repetition of the noise texture, per ripple layer. */
const RIPPLE_SCALE_A = 9.1
const RIPPLE_SCALE_B = 5.3
/** Ripple strength: horizontal tilt of the shading normal. */
const RIPPLE_STRENGTH = 0.12
/** Sheen: sharpness of the broad sun sheen, and its strength. */
const SHEEN_POWER = 6
const SHEEN_STRENGTH = 0.07
/** Glints: product of the two fine ripple values above which they appear, and their strength. */
const GLINT_FROM = 0.42
const GLINT_TO = 0.62
const GLINT_STRENGTH = 0.45

/**
 * Create the material of the water layer.
 *
 * Expects the water layer's vertex data (see `MeshData.weights`): the depth
 * in the `weightsA` attribute's first channel. Chunk meshes have an identity
 * transform, so the world-space ripple normal is also the local normal.
 */
export function createWaterMaterial(
  noise: DataTexture,
  grid: GridOpacity,
  light: LightUniforms,
): MeshPhysicalNodeMaterial {
  const material = new MeshPhysicalNodeMaterial({
    roughness: 0.3,
    metalness: 0,
    ior: 1.33,
    // No view-dependent highlight: see the sheen below.
    specularIntensity: 0,
    transparent: true,
    depthWrite: false,
  })
  material.name = 'water'

  const depth = attribute('weightsA', 'vec4').x
  const p = positionWorld.xz

  // Two ripple layers drifting in different directions (units per second).
  const a = texture(noise, p.div(RIPPLE_SCALE_A).add(vec2(time.mul(0.021), time.mul(0.013))))
  const b = texture(
    noise,
    p
      .div(RIPPLE_SCALE_B)
      .add(vec2(time.mul(-0.017), time.mul(0.026)))
      .add(vec2(0.43, 0.19)),
  )
  // Centred noise values used as surface slopes (not true derivatives, but
  // smooth and uncorrelated in x and z, which reads as ripples).
  const slope = vec2(a.b.add(b.a).sub(1), a.a.add(b.b).sub(1)).mul(RIPPLE_STRENGTH)
  const rippled = normalize(vec3(slope.x, 1, slope.y))
  material.normalNode = transformNormalToView(rippled)

  const deep = smoothstep(0, DEEP_AT, depth)
  const shore = smoothstep(0, SHORE_FADE, depth)
  // Foam band near the shore, broken up by the fine noise.
  const foam = smoothstep(0.35, 0.08, depth.add(a.g.sub(0.5).mul(0.3))).mul(shore)

  const water = mix(color(SHALLOW), color(DEEP), deep)
  material.colorNode = applyGrid(mix(water, color(FOAM), foam.mul(0.7)), positionWorld, 1, grid)
  material.opacityNode = max(
    shore.mul(mix(float(SHALLOW_OPACITY), float(DEEP_OPACITY), deep)),
    foam.mul(0.85),
  )

  // View-independent sun sheen and glints (see the module comment).
  // Half-vector of the light with the vertical (the water "seen from above").
  const half = normalize(light.direction.add(vec3(0, 1, 0)))
  const sheen = pow(max(dot(rippled, half), 0), SHEEN_POWER).mul(SHEEN_STRENGTH)
  const glint = smoothstep(GLINT_FROM, GLINT_TO, a.g.mul(b.g)).mul(GLINT_STRENGTH)
  material.emissiveNode = light.color.mul(sheen.add(glint)).mul(shore).mul(float(1).sub(foam))
  return material
}
