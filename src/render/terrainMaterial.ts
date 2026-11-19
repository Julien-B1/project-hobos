/**
 * Terrain material (TSL node material), designed to be cheap.
 *
 * Layer: render. Per pixel the terrain shader does 3 texture fetches: 2 of a
 * small noise texture (`noiseTexture.ts`, large-scale variation) and 1 of the
 * material detail texture (`detailTexture.ts`, fine definition), plus a few
 * dozen ALU. No noise function is evaluated on the GPU, no bump mapping.
 *
 * Terrain shading:
 * 1. Each vertex carries blended material weights (grass, dirt, sand, rock,
 *    stone, path), averaged per lattice point in `core/terrainSurface.ts`, so
 *    weights are continuous from cell to cell.
 * 2. Textures are projected in world space on the plane facing the facet,
 *    chosen from the facet's geometric normal (screen derivatives of the
 *    position): the smooth shading normal varies across a triangle and would
 *    cut the projection in the middle of it. The detail texture is rotated
 *    so nothing lines up with the cell grid.
 * 3. Steep ground moves weight to dirt (medium slopes) and rock (steep
 *    slopes), from the smooth normal, so the change is continuous.
 * 4. **Height blending**: each material gets a height, its detail pattern
 *    (grass clumps, pebbles, rock grain, sand ripples) plus a random
 *    large-scale offset. Where materials meet, the highest one wins within a
 *    narrow band, so borders are crisp, irregular and follow the patterns
 *    (grass thins out into dirt between clumps) instead of a smooth
 *    gradient that reveals the triangles.
 * 5. Each material is a dark/light colour pair mixed by the large noise,
 *    modulated by its detail pattern; grass also drifts very slightly
 *    between warmer and cooler greens.
 * 6. The battle-map grid darkens the cell borders (`gridOverlay.ts`).
 */
import {
  abs,
  attribute,
  color,
  cross,
  dFdx,
  dFdy,
  float,
  max,
  mix,
  normalWorld,
  normalize,
  positionWorld,
  select,
  smoothstep,
  texture,
  vec2,
  vec3,
} from 'three/tsl'
import { MeshStandardNodeMaterial, type DataTexture, type Node } from 'three/webgpu'
import { applyGrid, type GridOpacity } from './gridOverlay'

/** One terrain channel's look, in `TERRAIN_CHANNELS` order. */
interface ChannelLook {
  /** Dark and light colour (sRGB hex), mixed by the large-scale noise. */
  readonly dark: number
  readonly light: number
  /** Detail texture channel giving the material its pattern and height. */
  readonly detail: 'r' | 'g' | 'b' | 'a'
  /** How strongly the detail pattern modulates the colour. */
  readonly contrast: number
  /**
   * Detail channel used as the blend height when it must differ from the
   * colour pattern (sand: its ripples would comb the border into stripes).
   */
  readonly blend?: 'r' | 'g' | 'b' | 'a'
}

/** Look of each terrain channel, in channel order (see `TERRAIN_CHANNELS`). */
const LOOKS: readonly ChannelLook[] = [
  { dark: 0x4b7330, light: 0x7ea64a, detail: 'r', contrast: 0.55 }, // grass
  { dark: 0x5f452d, light: 0x8d6a45, detail: 'g', contrast: 0.6 }, // dirt
  { dark: 0xc6ad7c, light: 0xe4d2a2, detail: 'a', contrast: 0.3, blend: 'g' }, // sand
  { dark: 0x57524d, light: 0x8b847b, detail: 'b', contrast: 0.85 }, // rock
  { dark: 0x86888c, light: 0xb4b6b9, detail: 'b', contrast: 0.6 }, // stone
  { dark: 0x9f8559, light: 0xc8b083, detail: 'g', contrast: 0.45 }, // path
]

/**
 * Very light hue drift of the grass between a warmer (yellower) and a
 * cooler (bluer) green, as RGB factors.
 */
const GRASS_WARM = vec3(1.05, 1.02, 0.84)
const GRASS_COOL = vec3(0.93, 1.0, 1.07)

/** Channel indices used by the slope rule. */
const GRASS = 0
const SAND = 2
const DIRT = 1
const ROCK = 3

/** World units covered by one repetition of the noise texture (large and small scale). */
const LARGE_SCALE = 41.3
const SMALL_SCALE = 6.7
/** World units covered by one repetition of the detail texture. */
const DETAIL_SCALE = 3.7
/** Rotation of the detail texture (radians), so its axes miss the cell grid. */
const DETAIL_ANGLE = 0.61

/** Influence of the detail height on the blend, in weight units. */
const HEIGHT_INFLUENCE = 0.5
/** Width of the band where two materials mix, in weight units: smaller is crisper. */
const BLEND_BAND = 0.12

/** Create the material of the terrain layer. */
export function createTerrainMaterial(
  noise: DataTexture,
  detailTexture: DataTexture,
  grid: GridOpacity,
): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0 })
  material.name = 'terrain'

  const wa = attribute('weightsA', 'vec4')
  const wb = attribute('weightsB', 'vec4')

  // Planar projection facing the facet: XZ for tops, ZY or XY for walls.
  // The geometric normal's sign does not matter here (abs).
  const p = positionWorld
  const f = abs(normalize(cross(dFdx(p), dFdy(p))))
  const uv = select(f.y.greaterThan(0.6), p.xz, select(f.x.greaterThan(f.z), p.zy, p.xy))
  const large = texture(noise, uv.div(LARGE_SCALE))
  const small = texture(noise, uv.div(SMALL_SCALE).add(vec2(0.37, 0.71)))
  const c = Math.cos(DETAIL_ANGLE)
  const s = Math.sin(DETAIL_ANGLE)
  const rotated = vec2(uv.x.mul(c).sub(uv.y.mul(s)), uv.x.mul(s).add(uv.y.mul(c)))
  const detail = texture(detailTexture, rotated.div(DETAIL_SCALE))

  // Steep ground: weight moves to dirt on medium slopes, rock on steep ones
  // (less on sand, so beaches stay sandy).
  const n = abs(normalWorld)
  const raw: Node<'float'>[] = [wa.x, wa.y, wa.z, wa.w, wb.x, wb.y]
  const sandShare = raw[SAND] ?? float(0)
  const steep = smoothstep(0.86, 0.6, n.y).mul(float(1).sub(sandShare.mul(0.7)))
  const rocky = smoothstep(0.62, 0.35, n.y)
  const weights = raw.map((w, i) => {
    let out = w.mul(float(1).sub(steep))
    if (i === DIRT) out = out.add(steep.mul(float(1).sub(rocky)))
    if (i === ROCK) out = out.add(steep.mul(rocky))
    return out
  })

  // Random large-scale shift of each material's height (alternating signs),
  // so borders wander and patches vary in size.
  const wobble = mix(large.b, small.a, 0.4).sub(0.5)
  const heights = LOOKS.map((look) => detail[look.detail].sub(0.5))
  const blendHeights = LOOKS.map((look) => detail[look.blend ?? look.detail].sub(0.5))
  const scores = weights.map((w, i) => {
    const shift = i % 2 === 0 ? wobble : wobble.negate()
    const h = (blendHeights[i] ?? float(0)).add(shift.mul(0.6))
    return w.add(h.mul(HEIGHT_INFLUENCE).mul(smoothstep(0, 0.25, w)))
  })
  let top = scores[0] ?? float(0)
  for (let i = 1; i < scores.length; i++) top = max(top, scores[i] ?? 0)
  // Height blend: materials within BLEND_BAND of the top one mix; materials
  // absent at this vertex (zero weight) never appear.
  const blend = scores.map((score, i) =>
    max(score.sub(top).add(BLEND_BAND), 0).mul(smoothstep(0, 0.04, weights[i] ?? float(0))),
  )

  // Grass hue drift at two scales (a few cells and a few tens of cells),
  // from noise channels already fetched.
  const hue = smoothstep(0.3, 0.7, mix(large.a, small.b, 0.5))
  const albedo = LOOKS.map((look, i) => {
    let base = mix(color(look.dark), color(look.light), large.r)
    if (i === GRASS) base = base.mul(mix(GRASS_WARM, GRASS_COOL, hue))
    return base.mul((heights[i] ?? float(0)).mul(look.contrast).add(1))
  })
  let sum: Node<'float'> = blend[0] ?? float(0)
  let mixed = (albedo[0] ?? color(0xff00ff)).mul(blend[0] ?? 0)
  for (let i = 1; i < albedo.length; i++) {
    sum = sum.add(blend[i] ?? 0)
    mixed = mixed.add((albedo[i] ?? color(0)).mul(blend[i] ?? 0))
  }
  // Broad brightness variation at a few cells' scale.
  const variation = small.g.mul(0.2).add(0.9)
  const ground = mixed.div(max(sum, float(1e-5))).mul(variation)
  material.colorNode = applyGrid(ground, p, f.y, grid)
  return material
}
