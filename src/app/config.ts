/**
 * Tunable settings of the application shell.
 *
 * Layer: app. Values here are passed to the render layer at start-up; change
 * them to tweak the feel without touching engine code.
 */
import type { CameraRigSettings } from '@/render/cameraRig'

/** Settings consumed when the engine and input bindings are created. */
export const config = {
  /** Orbit camera. Angles in degrees, distances in world units (1 unit = 1 cell). */
  camera: {
    /**
     * Narrow vertical field of view: flattens perspective, which suits the
     * HD-2D "diorama" look.
     */
    fovDeg: 30,
    /** Locked downward tilt, RO-style. */
    pitchDeg: 40,
    initialYawDeg: 45,
    snapStepDeg: 45,
    initialDistance: 45,
    minDistance: 10,
    maxDistance: 110,
    /** Keyboard pan speed, as a fraction of the camera distance per second. */
    keyPanSpeed: 0.9,
    /** Animation sharpness for snaps and zoom, in 1/second. */
    smoothing: 12,
  } satisfies CameraRigSettings,

  /** Mouse and keyboard sensitivity. */
  input: {
    /** Free rotation speed, radians per dragged pixel. */
    rotateRadPerPixel: 0.006,
    /** Zoom factor per wheel delta unit (exponential). */
    zoomPerWheelUnit: 0.0015,
    /** Movement (px) before a left press becomes a drag instead of a click. */
    dragThresholdPx: 4,
  },
} as const

/**
 * Read debug switches from the page URL.
 *
 * `?forceWebGL=1` forces the WebGL 2 backend to test the fallback path.
 */
export function readUrlFlags(search: string = window.location.search): { forceWebGL: boolean } {
  const params = new URLSearchParams(search)
  return { forceWebGL: params.get('forceWebGL') === '1' }
}
