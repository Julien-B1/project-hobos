/**
 * Terrain and block materials (TSL node materials), designed to be cheap.
 *
 * Layer: render. Per pixel the terrain shader does 2 fetches of a small
 * precomputed noise texture (`noiseTexture.ts`) plus a few mixes: no noise
 * function is evaluated on the GPU, no derivative-based bump.
 *
 * Terrain shading:
 * 1. Each vertex carries blended material weights (grass, dirt, sand, rock,
 *    stone, path), averaged per lattice point in `core/terrainSurface.ts`, so
 *    weights are continuous from cell to cell.
 * 2. The noise texture is projected in world space on the plane facing the
 *    facet (facets are flat, so one projection per facet is enough). It is
 *    sampled at two scales with unrelated ratios: no visible tiling, and
 *    nothing aligned with the cell grid.
 * 3. Weights are modulated by the noise and sharpened (squared), giving
 *    irregular borders between materials instead of straight gradients.
 * 4. Each material is a dark/light colour pair mixed by the large-scale
 *    noise, times a small detail factor.
 * 5. Steep facets fade towards dirt then rock, from the normal.
 */
import {
  Fn,
  abs,
  attribute,
  color,
  float,
  max,
  mix,
  normalWorld,
  positionWorld,
  select,
  smoothstep,
  texture,
  vec2,
  vertexColor,
} from 'three/tsl'
import { MeshStandardNodeMaterial, type DataTexture } from 'three/webgpu'

/** Dark and light colour (sRGB hex) of each terrain channel, in channel order. */
const PALETTE: readonly (readonly [number, number])[] = [
  [0x4b7330, 0x7ea64a], // grass
  [0x5f452d, 0x8d6a45], // dirt
  [0xc6ad7c, 0xe4d2a2], // sand
  [0x57524d, 0x8b847b], // rock
  [0x86888c, 0xb4b6b9], // stone
  [0x9f8559, 0xc8b083], // path
]

/** World units covered by one repetition of the noise texture (large and small scale). */
const LARGE_SCALE = 41.3
const SMALL_SCALE = 6.7

/** Create the material of the terrain layer. */
export function createTerrainMaterial(noise: DataTexture): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0 })
  material.name = 'terrain'

  const wa = attribute('weightsA', 'vec4')
  const wb = attribute('weightsB', 'vec4')

  material.colorNode = Fn(() => {
    // Planar projection facing the facet: XZ for tops, ZY or XY for walls.
    const n = abs(normalWorld)
    const p = positionWorld
    const uv = select(n.y.greaterThan(0.6), p.xz, select(n.x.greaterThan(n.z), p.zy, p.xy))
    const large = texture(noise, uv.div(LARGE_SCALE))
    const small = texture(noise, uv.div(SMALL_SCALE).add(vec2(0.37, 0.71)))

    // Material weights, wobbled by the noise (opposite directions for
    // alternate channels) and squared to sharpen the borders.
    const wobble = mix(large.b, small.a, 0.5)
    const raw = [wa.x, wa.y, wa.z, wa.w, wb.x, wb.y]
    const weights = raw.map((w, i) => {
      const factor = i % 2 === 0 ? wobble.mul(1.2).add(0.4) : wobble.mul(-1.2).add(1.6)
      const shaped = w.mul(factor)
      return shaped.mul(shaped)
    })
    let sum = weights[0] ?? float(0)
    for (let i = 1; i < weights.length; i++) sum = sum.add(weights[i] ?? 0)
    const total = max(sum, float(1e-5))

    // Albedo of each material: dark/light mix by large noise, small detail.
    const detail = small.g.mul(0.24).add(0.88)
    const albedo = PALETTE.map(([dark, light]) => mix(color(dark), color(light), large.r))
    let blended = (albedo[0] ?? color(0xff00ff)).mul(weights[0] ?? 0)
    for (let i = 1; i < albedo.length; i++) {
      blended = blended.add((albedo[i] ?? color(0)).mul(weights[i] ?? 0))
    }
    blended = blended.div(total).mul(detail)

    // Slopes: bare dirt on medium slopes, rock on steep ones (less on sand).
    const dirt = albedo[1] ?? blended
    const rock = albedo[3] ?? blended
    const bare = mix(dirt, rock, smoothstep(0.62, 0.35, n.y)).mul(detail)
    const sandShare = (weights[2] ?? float(0)).div(total)
    const steep = smoothstep(0.86, 0.6, n.y).mul(float(1).sub(sandShare.mul(0.7)))
    return mix(blended, bare, steep)
  })()
  return material
}

/**
 * Material of the blocks layer (wood, leaves, or everything in blocky mode):
 * vertex colours with a light variation from the noise texture, so large
 * flat faces are not uniform.
 */
export function createBlocksMaterial(noise: DataTexture): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0 })
  material.name = 'blocks'
  const p = positionWorld
  const variation = texture(noise, p.xz.add(p.y).div(SMALL_SCALE)).g.mul(0.2).add(0.9)
  material.colorNode = vertexColor().mul(variation)
  return material
}
