/**
 * Sun shadows: one shadow map that follows the camera, rendered only when
 * needed.
 *
 * Layer: render. Cost model (budget in `docs/wiki/Architecture.md`, Rendering):
 * - shadow map pass: the scene's depth seen from the sun, re-rendered only
 *   when the framing changes (pan by at least one texel, zoom step) or the
 *   terrain was rebuilt; a still camera costs no extra pass;
 * - per lit pixel: 5 hardware-filtered depth comparisons (Three's PCF
 *   filter), i.e. 5 texture fetches.
 * Framing maths (size steps, texel snapping) live in `shadowMath.ts`.
 */
import type { DirectionalLight } from 'three/webgpu'
import type { Vec3Like } from './cameraMath'
import { shadowHalfExtent, snapToShadowTexels } from './shadowMath'

/** Shadow quality switch (`?shadows=`): map size, or no shadows at all. */
export type ShadowQuality = 'off' | 'low' | 'high'

/** Shadow map edge length (texels) per quality. */
const MAP_SIZE: Readonly<Record<Exclude<ShadowQuality, 'off'>, number>> = {
  low: 2048,
  high: 4096,
}

/**
 * Extra depth (world units) in front of and behind the covered square, so
 * hills and trees outside the view still cast into it.
 */
const DEPTH_MARGIN = 64

/** PCF filter radius, in texels: soft but still crisp edges. */
const FILTER_RADIUS = 2

/** Normal offset applied before the depth test, in shadow texels (prevents acne). */
const NORMAL_BIAS_TEXELS = 0.6

/** Drives the shadow of a directional light; see the module comment. */
export class SunShadow {
  /** Unit direction from the ground towards the sun. */
  private toSun: Vec3Like
  private readonly mapSize: number
  /** Framing of the last rendered shadow map, to skip identical frames. */
  private frameKey = ''
  /** Number of shadow map passes requested so far (debug HUD). */
  private passes = 0

  /**
   * @param sun The light; its current position relative to its target gives
   *   the sun direction. The light's target must be in the scene.
   */
  constructor(
    private readonly sun: DirectionalLight,
    readonly quality: ShadowQuality,
  ) {
    const d = sun.position.clone().sub(sun.target.position).normalize()
    this.toSun = { x: d.x, y: d.y, z: d.z }
    this.mapSize = quality === 'off' ? 0 : MAP_SIZE[quality]
    sun.castShadow = quality !== 'off'
    if (quality === 'off') return
    const shadow = sun.shadow
    shadow.mapSize.set(this.mapSize, this.mapSize)
    shadow.radius = FILTER_RADIUS
    // Small biases: larger ones detach shadows from the foot of objects.
    shadow.bias = -0.00005
    // Rendered on demand from `update()`.
    shadow.autoUpdate = false
  }

  /**
   * Change the light direction (unit vector from the ground towards the
   * light, e.g. a new time of day). The next `update()` reframes the map.
   */
  setDirection(toSun: Vec3Like): void {
    this.toSun = { x: toSun.x, y: toSun.y, z: toSun.z }
    this.frameKey = ''
  }

  /** Force a new shadow pass on the next `update()` (what casts shadows changed). */
  invalidate(): void {
    this.frameKey = ''
  }

  /** Number of shadow map passes requested since start (stays still with a still camera). */
  get passCount(): number {
    return this.passes
  }

  /**
   * Frame the shadow map around the camera target (world units) for a camera
   * at `cameraDistance`. Requests a new shadow pass only when the framing
   * changed or `sceneChanged` (chunks were rebuilt).
   */
  update(target: Vec3Like, cameraDistance: number, sceneChanged: boolean): void {
    if (this.quality === 'off') return
    const half = shadowHalfExtent(cameraDistance)
    const texel = (2 * half) / this.mapSize
    const c = snapToShadowTexels(target, this.toSun, texel)
    const key = `${half}|${c.x}|${c.y}|${c.z}`
    if (key === this.frameKey && !sceneChanged) return
    this.frameKey = key

    const reach = half + DEPTH_MARGIN
    const d = this.toSun
    this.sun.target.position.set(c.x, c.y, c.z)
    this.sun.position.set(c.x + d.x * reach, c.y + d.y * reach, c.z + d.z * reach)
    this.sun.target.updateMatrixWorld()
    this.sun.updateMatrixWorld()

    const shadow = this.sun.shadow
    const camera = shadow.camera
    camera.left = -half
    camera.right = half
    camera.top = half
    camera.bottom = -half
    camera.near = 0.5
    camera.far = 2 * reach
    camera.updateProjectionMatrix()
    shadow.normalBias = texel * NORMAL_BIAS_TEXELS
    shadow.needsUpdate = true
    this.passes++
  }
}
