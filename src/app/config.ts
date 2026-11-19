/**
 * Tunable settings of the application shell.
 *
 * Layer: app. Values here are passed to the render layer at start-up; change
 * them to tweak the feel without touching engine code.
 */

/** Settings consumed when the engine is created. */
export const config = {
  camera: {
    /**
     * Vertical field of view, in degrees. A narrow FOV flattens perspective,
     * which suits the HD-2D "diorama" look.
     */
    fovDeg: 30,
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
