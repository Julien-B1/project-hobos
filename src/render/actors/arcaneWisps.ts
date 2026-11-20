/**
 * Arcane effect of an incantation: a glow on the staff's head and wisps of
 * light spiralling around it.
 *
 * Layer: render. One instanced sprite object (a soft additive disc per
 * instance): instance 0 is the glow, the others are the points of
 * {@link WISPS} trails, each trail a spiral around the staff's head whose
 * older points are smaller and fainter. Positions and sizes are written on
 * the CPU each frame (a few dozen sprites, one draw call); the whole
 * effect fades with {@link ArcaneWisps.update}'s `strength` and costs
 * nothing (hidden) at 0.
 */
import { float, instancedBufferAttribute, uniform, uv, vec4 } from 'three/tsl'
import {
  AdditiveBlending,
  Color,
  InstancedBufferAttribute,
  Sprite,
  SpriteNodeMaterial,
  type Vector3,
} from 'three/webgpu'
import { encodeOutput } from '../outputEncoding'

/** Number of wisps around the head. */
const WISPS = 3

/** Points per wisp trail. */
const TRAIL = 14

/** Time between two trail points, in seconds. */
const TRAIL_STEP = 0.025

/** Glow size and wisp head size, in world units. */
const GLOW_SIZE = 0.45
const WISP_SIZE = 0.09

/** Radius of the wisps' orbit, in world units, and its vertical swing. */
const ORBIT = 0.28
const SWING = 0.18

/** Turns per second of the wisps. */
const SPIN = 0.9

const COUNT = 1 + WISPS * TRAIL

/** Glow and wisps around a staff's head. Add {@link ArcaneWisps.object} to the scene. */
export class ArcaneWisps {
  /** Scene object (positions are in world space). */
  readonly object: Sprite
  private readonly positions = new InstancedBufferAttribute(new Float32Array(COUNT * 3), 3)
  private readonly sizes = new InstancedBufferAttribute(new Float32Array(COUNT), 1)
  private readonly intensity = uniform(0)
  private readonly material: SpriteNodeMaterial
  private time = 0

  /** @param color Colour of the light (linear). */
  constructor(color = new Color(0.55, 0.3, 1.0)) {
    const material = new SpriteNodeMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    })
    material.positionNode = instancedBufferAttribute(this.positions)
    material.scaleNode = instancedBufferAttribute(this.sizes)
    // Soft disc: bright centre, nothing at the edge.
    const d = uv().sub(0.5).length().mul(2)
    const falloff = float(1).sub(d).clamp(0, 1).pow(2)
    material.colorNode = vec4(uniform(color).mul(this.intensity.mul(falloff)), falloff)
    this.material = encodeOutput(material)
    // The WebGPU renderer draws sprites with node materials; Three's typings
    // only know the classic SpriteMaterial.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-class-instance-assignment -- see above
    this.object = new Sprite(this.material)
    this.object.count = COUNT
    this.object.frustumCulled = false
    this.object.renderOrder = 10
    this.object.visible = false
  }

  /**
   * Advance by `dt` seconds around `head` (world units). `strength` 0 to 1
   * fades the whole effect (0: hidden).
   */
  update(dt: number, head: Vector3, strength: number): void {
    this.object.visible = strength > 0.01
    if (!this.object.visible) return
    this.time += dt
    this.intensity.value = 1.6 * strength
    const p = this.positions.array as Float32Array
    const s = this.sizes.array as Float32Array
    // Glow: pulsing a little.
    p.set([head.x, head.y, head.z], 0)
    s[0] = GLOW_SIZE * strength * (0.85 + 0.15 * Math.sin(this.time * 7))
    for (let w = 0; w < WISPS; w++) {
      for (let k = 0; k < TRAIL; k++) {
        const t = this.time - k * TRAIL_STEP
        const a = (t * SPIN + w / WISPS) * 2 * Math.PI
        const i = 1 + w * TRAIL + k
        // Spiral around the head, rising and falling, each wisp on its own tilt.
        const r = ORBIT * (0.8 + 0.2 * Math.sin(t * 1.7 + w))
        p[i * 3] = head.x + Math.cos(a) * r
        p[i * 3 + 1] = head.y + Math.sin(t * 2.1 + w * 2.1) * SWING
        p[i * 3 + 2] = head.z + Math.sin(a) * r
        s[i] = WISP_SIZE * strength * (1 - k / TRAIL)
      }
    }
    this.positions.needsUpdate = true
    this.sizes.needsUpdate = true
  }

  /** Release the material. */
  dispose(): void {
    this.material.dispose()
  }
}
