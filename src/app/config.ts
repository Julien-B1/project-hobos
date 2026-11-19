/**
 * Tunable settings of the application shell.
 *
 * Layer: app. Values here are passed to the render layer at start-up; change
 * them to tweak the feel without touching engine code.
 */
import type { CameraRigSettings } from '@/render/cameraRig'
import type { TerrainMesherKind } from '@/render/engine'
import type { ShadowQuality } from '@/render/sunShadow'
import { DEFAULT_TIME_OF_DAY, isTimeOfDay, type TimeOfDay } from '@/render/timeOfDay'
import { isTestMapId, type TestMapId } from '@/core/generators/catalog'

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
    initialDistance: 60,
    minDistance: 10,
    maxDistance: 240,
    /** Keyboard pan speed, as a fraction of the camera distance per second. */
    keyPanSpeed: 0.9,
    /** Keyboard zoom speed (distance multiplied by e^speed per second). */
    keyZoomSpeed: 1.6,
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
 * - `?forceWebGL=1` forces the WebGL 2 backend to test the fallback path.
 * - `?map=<id>` picks a test map (`reference` by default, `flat`, `organic`).
 * - `?seed=<integer>` changes the seed of procedural maps (`organic`).
 * - `?size=<cells>` changes the edge length of procedural maps (8 to 128;
 *   default 32, a battle-map sized encounter).
 * - `?mesher=blocky` renders every voxel as its exact block shape instead of
 *   the default faceted terrain.
 * - `?time=<id>` sets the starting time of day (`dawn`, `morning`, `noon`,
 *   `afternoon` (default), `dusk`, `evening`, `midnight`, `late-night`).
 * - `?grid=off` starts with the battle-map grid hidden (toggle with G).
 * - `?shadows=off|low|high` sets the sun shadow quality (`high` by default:
 *   4096² map; `low`: 2048²; `off`: no shadow pass, no lookups).
 */
export function readUrlFlags(search: string = window.location.search): {
  forceWebGL: boolean
  map: TestMapId
  seed: number | undefined
  size: number | undefined
  mesher: TerrainMesherKind
  shadows: ShadowQuality
  grid: boolean
  timeOfDay: TimeOfDay
} {
  const params = new URLSearchParams(search)
  const map = params.get('map') ?? 'reference'
  const seed = Number.parseInt(params.get('seed') ?? '', 10)
  const size = Number.parseInt(params.get('size') ?? '', 10)
  return {
    forceWebGL: params.get('forceWebGL') === '1',
    map: isTestMapId(map) ? map : 'reference',
    seed: Number.isFinite(seed) ? seed : undefined,
    size: Number.isFinite(size) ? Math.min(128, Math.max(8, size)) : undefined,
    mesher: params.get('mesher') === 'blocky' ? 'blocky' : 'faceted',
    shadows: parseShadowQuality(params.get('shadows')),
    grid: params.get('grid') !== 'off',
    timeOfDay: parseTimeOfDay(params.get('time')),
  }
}

/** Shadow quality from a URL value; unknown or missing values give `high`. */
function parseShadowQuality(value: string | null): ShadowQuality {
  return value === 'off' || value === 'low' ? value : 'high'
}

/** Time of day from a URL value; unknown or missing values give the default. */
function parseTimeOfDay(value: string | null): TimeOfDay {
  return value !== null && isTimeOfDay(value) ? value : DEFAULT_TIME_OF_DAY
}
