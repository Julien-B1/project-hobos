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
    /** Start (and reset) view: close on the character, not the closest zoom. */
    initialDistance: 20,
    minDistance: 10,
    /** Until the map is known: then the farthest zoom shows the whole map (`setFitRadius`). */
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
 * - `?map=<id>` picks a test map (`river` by default, `flat`,
 *   `kitchen-sink`, `bridges`).
 * - `?seed=<integer>` sets the seed of procedural maps (`river`); without
 *   it, each launch rolls a random seed (`random`, for tests).
 * - `?size=<cells>` changes the edge length of procedural maps (8 to 128;
 *   default 40, a large battle map).
 * - `?mesher=blocky` renders every voxel as its exact block shape instead of
 *   the default faceted terrain.
 * - `?time=<id>` sets the starting time of day (`dawn`, `morning`, `noon`,
 *   `afternoon` (default), `dusk`, `evening`, `midnight`, `late-night`).
 * - `?hud=on` starts with the debug HUD shown (the bug button toggles it).
 * - `?grid=off` starts with the battle-map grid hidden (toggle with G).
 * - `?shadows=off|low|high` sets the sun shadow quality (`high` by default:
 *   4096² map; `low`: 2048²; `off`: no shadow pass, no lookups).
 * - `?cam=x,z[,distance[,yaw]]` starts the camera on cell (x, z), at that
 *   distance (world units) and yaw (degrees): reproducible views,
 *   screenshots.
 * - `?spawn=x,z` puts the character near cell (x, z) instead of near the
 *   map's home point (screenshots, debugging a spot).
 */
export function readUrlFlags(
  search: string = window.location.search,
  random: () => number = Math.random,
): {
  forceWebGL: boolean
  map: TestMapId
  seed: number
  size: number | undefined
  mesher: TerrainMesherKind
  shadows: ShadowQuality
  grid: boolean
  hud: boolean
  timeOfDay: TimeOfDay
  camera: CameraView | undefined
  spawn: { readonly x: number; readonly z: number } | undefined
} {
  const params = new URLSearchParams(search)
  const map = params.get('map') ?? DEFAULT_MAP
  const seed = Number.parseInt(params.get('seed') ?? '', 10)
  const size = Number.parseInt(params.get('size') ?? '', 10)
  return {
    forceWebGL: params.get('forceWebGL') === '1',
    map: isTestMapId(map) ? map : DEFAULT_MAP,
    seed: Number.isFinite(seed) ? seed : randomSeed(random),
    size: Number.isFinite(size) ? clampMapSize(size) : undefined,
    mesher: params.get('mesher') === 'blocky' ? 'blocky' : 'faceted',
    shadows: parseShadowQuality(params.get('shadows')),
    grid: params.get('grid') !== 'off',
    hud: params.get('hud') === 'on',
    timeOfDay: parseTimeOfDay(params.get('time')),
    camera: parseCameraView(params.get('cam')),
    spawn: parseCameraView(params.get('spawn')),
  }
}

/** Map shown at launch when the URL names none (or an unknown one). */
export const DEFAULT_MAP: TestMapId = 'river'

/**
 * A random seed for procedural maps: a non-negative 31-bit integer (fits
 * the signed 32-bit range the noise expects).
 *
 * @param random Uniform source in [0, 1) (`Math.random` by default).
 */
export function randomSeed(random: () => number = Math.random): number {
  return Math.floor(random() * 2 ** 31)
}

/** Start-up camera view (`?cam=x,z[,distance[,yaw]]`): target cell, distance, yaw in degrees. */
export interface CameraView {
  readonly x: number
  readonly z: number
  readonly distance?: number
  readonly yawDeg?: number
}

/** Parse `?cam=x,z[,distance[,yaw]]`; undefined when absent or malformed. */
export function parseCameraView(value: string | null): CameraView | undefined {
  if (!value) return undefined
  const parts = value.split(',').map((p) => Number.parseFloat(p))
  const [x, z, distance, yawDeg] = parts
  if (x === undefined || z === undefined || !Number.isFinite(x) || !Number.isFinite(z)) {
    return undefined
  }
  return {
    x,
    z,
    ...(distance !== undefined && Number.isFinite(distance) ? { distance } : {}),
    ...(yawDeg !== undefined && Number.isFinite(yawDeg) ? { yawDeg } : {}),
  }
}

/** Bounds of the procedural map edge length (`?size=`), in cells. */
export const MAP_SIZE_RANGE = { min: 8, max: 128 } as const

/** Clamp a procedural map edge length (cells) into {@link MAP_SIZE_RANGE}; rounds to an integer. */
export function clampMapSize(size: number): number {
  return Math.min(MAP_SIZE_RANGE.max, Math.max(MAP_SIZE_RANGE.min, Math.round(size)))
}

/**
 * Which test map to generate. Held by `App.vue` so the map picker can switch
 * it at run time; `undefined` seed or size means "generator default".
 */
export interface MapSettings {
  readonly map: TestMapId
  /** Seed of procedural maps (any 32-bit integer). */
  readonly seed: number | undefined
  /** Edge length of procedural maps, in cells, within {@link MAP_SIZE_RANGE}. */
  readonly size: number | undefined
}

/**
 * Query string reproducing `settings`: writes `map`, `seed` and `size` into
 * `search` and keeps every other parameter (time, shadows, mesher...). Seed
 * and size are dropped when undefined so the generator defaults apply on
 * reload. Returns the string with its leading `?` (or an empty string).
 */
export function withMapParams(search: string, settings: MapSettings): string {
  const params = new URLSearchParams(search)
  params.set('map', settings.map)
  if (settings.seed === undefined) params.delete('seed')
  else params.set('seed', String(settings.seed))
  if (settings.size === undefined) params.delete('size')
  else params.set('size', String(settings.size))
  const query = params.toString()
  return query === '' ? '' : `?${query}`
}

/** Shadow quality from a URL value; unknown or missing values give `high`. */
function parseShadowQuality(value: string | null): ShadowQuality {
  return value === 'off' || value === 'low' ? value : 'high'
}

/** Time of day from a URL value; unknown or missing values give the default. */
function parseTimeOfDay(value: string | null): TimeOfDay {
  return value !== null && isTimeOfDay(value) ? value : DEFAULT_TIME_OF_DAY
}
