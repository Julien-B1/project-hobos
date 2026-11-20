/**
 * RO-style orbit camera rig.
 *
 * Layer: render. Wraps a `PerspectiveCamera` orbiting a ground target with:
 * - a locked pitch (set once from config),
 * - free yaw rotation plus fixed-step snaps (e.g. 45 degrees), animated,
 * - bounded, animated zoom (distance to the target); the farthest zoom
 *   can follow the map size (`setFitRadius`),
 * - target panning, by drag (instant) or by held keys (velocity, per frame),
 * - keyboard zoom (held keys, per frame),
 * - an animated reset to the initial view (home target, initial yaw and zoom).
 *
 * The rig knows nothing about input devices: `src/app/input/bindings.ts`
 * translates mouse and keyboard events into calls on this API. Call
 * `update(dt)` once per frame before rendering.
 */
import { PerspectiveCamera } from 'three/webgpu'
import {
  clamp,
  dampTowards,
  fitDistance,
  groundAxes,
  nearestEquivalentAngle,
  nextSnapYaw,
  orbitPosition,
  worldPerPixel,
  type Vec3Like,
} from './cameraMath'

/** Static settings of the rig. Angles in degrees, distances in world units. */
export interface CameraRigSettings {
  /** Vertical field of view. */
  readonly fovDeg: number
  /** Locked downward tilt of the view. */
  readonly pitchDeg: number
  /** Initial yaw (see `cameraMath.ts` for the angle convention). */
  readonly initialYawDeg: number
  /** Size of one rotation snap. */
  readonly snapStepDeg: number
  /** Initial distance to the target. */
  readonly initialDistance: number
  /** Closest allowed distance to the target. */
  readonly minDistance: number
  /** Farthest allowed distance to the target (until `setFitRadius` sets one from the map). */
  readonly maxDistance: number
  /** Keyboard pan speed, as a fraction of the current distance per second. */
  readonly keyPanSpeed: number
  /**
   * Keyboard zoom speed: the distance is multiplied by `exp(keyZoomSpeed)`
   * per second of held key (exponential, so it feels uniform at any zoom).
   */
  readonly keyZoomSpeed: number
  /** Smoothing sharpness for yaw and zoom animations, in 1/second. */
  readonly smoothing: number
}

/** Axis-aligned bounds for the target on the ground plane, in world units. */
export interface TargetBounds {
  readonly minX: number
  readonly maxX: number
  readonly minZ: number
  readonly maxZ: number
}

/** Room left around the map at the farthest zoom (relief, screen edges). */
const FIT_MARGIN = 1.15

/** Orbit camera with a locked pitch, used for the whole game view. */
export class CameraRig {
  /** The Three.js camera driven by this rig. Add it to nothing; just render with it. */
  readonly camera: PerspectiveCamera

  private readonly target: Vec3Like
  private readonly pitch: number
  private readonly snapStep: number
  private yaw: number
  private yawGoal: number
  private distance: number
  private distanceGoal: number
  /** Keyboard pan intent in screen axes, each in [-1, 1]. */
  private moveForward = 0
  private moveRight = 0
  /** Keyboard zoom intent: -1 zooms in, +1 zooms out, 0 stops. */
  private zoomIntent = 0
  private bounds: TargetBounds | null = null
  /** Farthest allowed distance now (settings, or fitted to the map). */
  private maxDistance: number
  /** Radius of the area the farthest zoom shows whole, or null (settings bound). */
  private fitRadius: number | null = null
  /** Target restored by `reset()`. */
  private readonly home: Vec3Like = { x: 0, y: 0, z: 0 }
  /** Animated target destination during a reset; null when idle. */
  private targetGoal: Vec3Like | null = null

  constructor(private readonly settings: CameraRigSettings) {
    const toRad = Math.PI / 180
    this.camera = new PerspectiveCamera(settings.fovDeg, 1, 0.1, 1000)
    this.target = { x: 0, y: 0, z: 0 }
    this.pitch = settings.pitchDeg * toRad
    this.snapStep = settings.snapStepDeg * toRad
    this.maxDistance = settings.maxDistance
    this.yaw = this.yawGoal = settings.initialYawDeg * toRad
    this.distance = this.distanceGoal = clamp(
      settings.initialDistance,
      settings.minDistance,
      settings.maxDistance,
    )
    this.applyPose()
  }

  /** Current yaw in degrees (for debug display). */
  get yawDeg(): number {
    return (this.yaw * 180) / Math.PI
  }

  /** Current orbit target (world units). Read-only view, changes every frame. */
  get focus(): Readonly<Vec3Like> {
    return this.target
  }

  /** Farthest allowed distance to the target (world units), see {@link setFitRadius}. */
  get farthestDistance(): number {
    return this.maxDistance
  }

  /**
   * Bound the zoom by the map: the farthest distance shows a disc of
   * `radius` (world units) around the target whole, with a margin, for the
   * current aspect ratio (refitted on resize). Never below the closest
   * distance; the configured `maxDistance` no longer applies.
   */
  setFitRadius(radius: number): void {
    this.fitRadius = radius
    this.refit()
  }

  /** Current distance from the camera to its target (world units), animated. */
  get currentDistance(): number {
    return this.distance
  }

  /** Move the target instantly to a world position. */
  setTarget(x: number, y: number, z: number): void {
    this.targetGoal = null
    this.target.x = x
    this.target.y = y
    this.target.z = z
    this.clampTarget()
    this.applyPose()
  }

  /** Set the target restored by `reset()` and move there instantly. */
  setHome(x: number, y: number, z: number): void {
    this.setHomePoint(x, y, z)
    this.setTarget(x, y, z)
  }

  /** Set the target restored by `reset()`, without moving. */
  setHomePoint(x: number, y: number, z: number): void {
    this.home.x = x
    this.home.y = y
    this.home.z = z
  }

  /**
   * Animate back to the initial view: home target, initial yaw (nearest
   * equivalent angle, no extra spins) and initial distance.
   */
  reset(): void {
    const { initialYawDeg, initialDistance, minDistance } = this.settings
    const maxDistance = this.maxDistance
    this.yawGoal = nearestEquivalentAngle((initialYawDeg * Math.PI) / 180, this.yaw)
    this.distanceGoal = clamp(initialDistance, minDistance, maxDistance)
    this.targetGoal = { ...this.home }
  }

  /**
   * Keyboard zoom intent: -1 zooms in, +1 zooms out, 0 stops. Integrated in
   * `update()` so the speed does not depend on key repeat.
   */
  setZoomIntent(direction: number): void {
    this.zoomIntent = clamp(direction, -1, 1)
  }

  /** Restrict where the target can go (e.g. the map footprint). `null` removes limits. */
  setTargetBounds(bounds: TargetBounds | null): void {
    this.bounds = bounds
    this.clampTarget()
  }

  /** Free rotation: add `deltaRad` to the yaw immediately (no animation). */
  rotateBy(deltaRad: number): void {
    this.yaw += deltaRad
    this.yawGoal = this.yaw
  }

  /** Animated rotation to the next snap angle. `direction` +1 = counter-clockwise from above. */
  snapRotate(direction: 1 | -1): void {
    this.yawGoal = nextSnapYaw(this.yawGoal, this.snapStep, direction)
  }

  /**
   * Zoom by a multiplicative factor on the distance goal (> 1 zooms out).
   * The result is clamped to the configured bounds and animated.
   */
  zoomBy(factor: number): void {
    this.distanceGoal = clamp(
      this.distanceGoal * factor,
      this.settings.minDistance,
      this.maxDistance,
    )
  }

  /**
   * Drag-pan: move the target so the ground follows the cursor.
   *
   * @param dxPx Horizontal cursor movement, in CSS pixels (right = positive).
   * @param dyPx Vertical cursor movement, in CSS pixels (down = positive).
   * @param viewportHeight Height of the viewport, in CSS pixels.
   */
  panByPixels(dxPx: number, dyPx: number, viewportHeight: number): void {
    const wpp = worldPerPixel(this.distance, this.settings.fovDeg, viewportHeight)
    const { forward, right } = groundAxes(this.yaw)
    // The ground is seen at an angle: a vertical pixel covers more ground.
    const dForward = (dyPx * wpp) / Math.sin(this.pitch)
    const dRight = -dxPx * wpp
    this.targetGoal = null // manual pan cancels a running reset
    this.target.x += right.x * dRight + forward.x * dForward
    this.target.z += right.z * dRight + forward.z * dForward
    this.clampTarget()
  }

  /**
   * Keyboard pan intent, in screen axes. Each value in [-1, 1]; (0, 0) stops.
   * Movement is integrated in `update()` so speed does not depend on key repeat.
   */
  setMoveIntent(forward: number, right: number): void {
    this.moveForward = clamp(forward, -1, 1)
    this.moveRight = clamp(right, -1, 1)
  }

  /** Update the projection aspect ratio (width / height). */
  setAspect(aspect: number): void {
    this.camera.aspect = aspect
    this.camera.updateProjectionMatrix()
    this.refit()
  }

  /** Advance animations and keyboard panning by `dt` seconds, then pose the camera. */
  update(dt: number): void {
    const { smoothing, keyPanSpeed, keyZoomSpeed, minDistance } = this.settings
    const maxDistance = this.maxDistance

    if (this.zoomIntent !== 0) {
      this.distanceGoal = clamp(
        this.distanceGoal * Math.exp(this.zoomIntent * keyZoomSpeed * dt),
        minDistance,
        maxDistance,
      )
    }

    this.yaw = dampTowards(this.yaw, this.yawGoal, smoothing, dt)
    this.distance = dampTowards(this.distance, this.distanceGoal, smoothing, dt)

    if (this.targetGoal) {
      const goal = this.targetGoal
      this.target.x = dampTowards(this.target.x, goal.x, smoothing, dt)
      this.target.y = dampTowards(this.target.y, goal.y, smoothing, dt)
      this.target.z = dampTowards(this.target.z, goal.z, smoothing, dt)
      const remaining = Math.hypot(
        goal.x - this.target.x,
        goal.y - this.target.y,
        goal.z - this.target.z,
      )
      if (remaining < 1e-3) this.targetGoal = null
    }

    if (this.moveForward !== 0 || this.moveRight !== 0) {
      this.targetGoal = null // manual move cancels a running reset
      const { forward, right } = groundAxes(this.yaw)
      // Normalise diagonals so they are not faster than straight moves.
      const len = Math.hypot(this.moveForward, this.moveRight)
      const speed = (keyPanSpeed * this.distance * dt) / Math.max(1, len)
      this.target.x += (forward.x * this.moveForward + right.x * this.moveRight) * speed
      this.target.z += (forward.z * this.moveForward + right.z * this.moveRight) * speed
      this.clampTarget()
    }

    this.applyPose()
  }

  /** Recompute the farthest distance from the fit radius and aspect; clamp the zoom. */
  private refit(): void {
    if (this.fitRadius === null) return
    const { fovDeg, pitchDeg, minDistance } = this.settings
    const fitted = FIT_MARGIN * fitDistance(this.fitRadius, fovDeg, pitchDeg, this.camera.aspect)
    this.maxDistance = Math.max(minDistance, fitted)
    this.distanceGoal = clamp(this.distanceGoal, minDistance, this.maxDistance)
    this.distance = Math.min(this.distance, this.maxDistance)
  }

  /** Place and orient the Three.js camera from the rig state. */
  private applyPose(): void {
    const p = orbitPosition(this.target, this.yaw, this.pitch, this.distance)
    this.camera.position.set(p.x, p.y, p.z)
    this.camera.lookAt(this.target.x, this.target.y, this.target.z)
  }

  /** Keep the target inside the optional bounds. */
  private clampTarget(): void {
    if (!this.bounds) return
    this.target.x = clamp(this.target.x, this.bounds.minX, this.bounds.maxX)
    this.target.z = clamp(this.target.z, this.bounds.minZ, this.bounds.maxZ)
  }
}
