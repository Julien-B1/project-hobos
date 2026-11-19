/**
 * Pure maths for the orbit camera (no Three.js import, unit-tested).
 *
 * Layer: render. Kept separate from `cameraRig.ts` so the geometry of the
 * RO-style camera can be tested in Node without a GPU.
 *
 * Angle convention: `yaw` is measured around the world Y axis. With yaw = 0
 * the camera sits on the +Z side of its target and looks towards -Z. A
 * positive yaw moves the camera counter-clockwise when seen from above.
 */

/** Minimal 3D vector shape, in world units. */
export interface Vec3Like {
  x: number
  y: number
  z: number
}

/** Minimal 2D vector on the ground plane (x, z), in world units. */
export interface GroundVec {
  x: number
  z: number
}

/**
 * Camera position for an orbit around `target`.
 *
 * @param target Point the camera looks at (world units).
 * @param yaw Rotation around the Y axis, in radians.
 * @param pitch Downward tilt of the view, in radians (0 = horizontal).
 * @param distance Distance from camera to target, in world units.
 */
export function orbitPosition(
  target: Vec3Like,
  yaw: number,
  pitch: number,
  distance: number,
): Vec3Like {
  const horizontal = distance * Math.cos(pitch)
  return {
    x: target.x + Math.sin(yaw) * horizontal,
    y: target.y + distance * Math.sin(pitch),
    z: target.z + Math.cos(yaw) * horizontal,
  }
}

/**
 * Unit vectors on the ground plane matching the screen axes for a given yaw.
 *
 * `forward` points "up the screen" (away from the camera), `right` points to
 * the right of the screen. Used for keyboard and drag panning.
 */
export function groundAxes(yaw: number): { forward: GroundVec; right: GroundVec } {
  const sin = Math.sin(yaw)
  const cos = Math.cos(yaw)
  return {
    forward: { x: -sin, z: -cos },
    right: { x: cos, z: -sin },
  }
}

/**
 * Next yaw goal when rotating by fixed steps (e.g. 45 degrees).
 *
 * The goal is first aligned on the step grid, so a free rotation followed by
 * a snap lands on a clean multiple of the step. `direction` is +1 or -1.
 * Uses the current goal (not the animated yaw) so repeated key presses stack.
 */
export function nextSnapYaw(goal: number, step: number, direction: 1 | -1): number {
  const index = Math.round(goal / step)
  const aligned = index * step
  // Already on the grid (within float noise): move one full step.
  if (Math.abs(aligned - goal) < 1e-6) return aligned + direction * step
  // Off-grid: snap to the nearest grid line in the requested direction.
  const lower = Math.floor(goal / step) * step
  return direction > 0 ? lower + step : lower
}

/**
 * Frame-rate independent exponential smoothing from `current` to `goal`.
 *
 * @param sharpness Convergence rate, in 1/second (higher = snappier).
 * @param dt Elapsed time, in seconds.
 */
export function dampTowards(current: number, goal: number, sharpness: number, dt: number): number {
  const t = 1 - Math.exp(-sharpness * dt)
  return current + (goal - current) * t
}

/** Clamp `value` into `[min, max]`. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * World distance on the ground covered by one screen pixel at the target.
 *
 * Derived from the perspective frustum height at `distance`. The vertical
 * screen axis maps to a ground distance stretched by `1 / sin(pitch)` because
 * the ground is seen at an angle; callers apply that factor for vertical drags.
 *
 * @param fovDeg Vertical field of view, in degrees.
 * @param viewportHeight Viewport height, in CSS pixels.
 */
export function worldPerPixel(distance: number, fovDeg: number, viewportHeight: number): number {
  const fovRad = (fovDeg * Math.PI) / 180
  return (2 * distance * Math.tan(fovRad / 2)) / Math.max(1, viewportHeight)
}
