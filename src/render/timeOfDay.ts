/**
 * Times of day: lighting presets for the scene.
 *
 * Layer: render (no Three.js import, unit-tested). Each preset sets the
 * main directional light (the sun by day, the moon at night: one light, so
 * one shadow map), the hemisphere ambient and the background. Directions
 * use compass angles on the map: azimuth 0 = north (-Z), 90 = east (+X),
 * 180 = south (+Z), 270 = west (-X); elevation above the horizon. The sun
 * rises in the east, peaks in the south and sets in the west.
 */
import type { Vec3Like } from './cameraMath'

/** Identifiers of the times of day, in chronological order. */
export const TIMES_OF_DAY = [
  'dawn',
  'morning',
  'noon',
  'afternoon',
  'dusk',
  'evening',
  'midnight',
  'late-night',
] as const

/** One of {@link TIMES_OF_DAY}. */
export type TimeOfDay = (typeof TIMES_OF_DAY)[number]

/** Time used when none is requested. */
export const DEFAULT_TIME_OF_DAY: TimeOfDay = 'afternoon'

/** Lighting of one time of day. Colours are sRGB hex. */
export interface LightingPreset {
  /** Label for the UI. */
  readonly label: string
  /** Main light: compass azimuth and elevation, in degrees. */
  readonly azimuthDeg: number
  readonly elevationDeg: number
  readonly lightColor: number
  readonly lightIntensity: number
  /** Hemisphere ambient: sky colour (from above), ground colour (from below), intensity. */
  readonly skyColor: number
  readonly groundColor: number
  readonly ambientIntensity: number
  /** Scene background around the map. */
  readonly background: number
}

/** Lighting presets, see the module comment. */
export const LIGHTING: Readonly<Record<TimeOfDay, LightingPreset>> = {
  dawn: {
    label: 'Dawn',
    azimuthDeg: 80,
    elevationDeg: 6,
    lightColor: 0xffa66b,
    lightIntensity: 1.6,
    skyColor: 0x8d9cc8,
    groundColor: 0x3b302c,
    ambientIntensity: 0.8,
    background: 0x2b3149,
  },
  morning: {
    label: 'Morning',
    azimuthDeg: 115,
    elevationDeg: 28,
    lightColor: 0xffe0b8,
    lightIntensity: 2.4,
    skyColor: 0xbfd3ee,
    groundColor: 0x3d3429,
    ambientIntensity: 0.95,
    background: 0x1f2c3a,
  },
  noon: {
    label: 'Noon',
    azimuthDeg: 180,
    elevationDeg: 62,
    lightColor: 0xfff7ea,
    lightIntensity: 2.9,
    skyColor: 0xd2e3f6,
    groundColor: 0x3f362b,
    ambientIntensity: 1.05,
    background: 0x1d2a38,
  },
  afternoon: {
    label: 'Afternoon',
    azimuthDeg: 245,
    elevationDeg: 40,
    lightColor: 0xfff1dc,
    lightIntensity: 2.6,
    skyColor: 0xcfdff2,
    groundColor: 0x3a3328,
    ambientIntensity: 1.0,
    background: 0x1b232c,
  },
  dusk: {
    label: 'Dusk',
    azimuthDeg: 285,
    elevationDeg: 6,
    lightColor: 0xff7f50,
    lightIntensity: 1.5,
    skyColor: 0x7d6e9e,
    groundColor: 0x31272a,
    ambientIntensity: 0.75,
    background: 0x2a2236,
  },
  evening: {
    label: 'Evening',
    azimuthDeg: 100,
    elevationDeg: 22,
    lightColor: 0xa9bde6,
    lightIntensity: 0.5,
    skyColor: 0x34446e,
    groundColor: 0x16151d,
    ambientIntensity: 0.6,
    background: 0x0e1322,
  },
  midnight: {
    label: 'Midnight',
    azimuthDeg: 170,
    elevationDeg: 55,
    lightColor: 0xbdcdf2,
    lightIntensity: 0.6,
    skyColor: 0x2a3a60,
    groundColor: 0x121219,
    ambientIntensity: 0.55,
    background: 0x080c16,
  },
  'late-night': {
    label: 'Late night',
    azimuthDeg: 250,
    elevationDeg: 18,
    lightColor: 0xa7b6dc,
    lightIntensity: 0.45,
    skyColor: 0x2e3550,
    groundColor: 0x17151b,
    ambientIntensity: 0.55,
    background: 0x0d1120,
  },
}

/** Type guard for time-of-day ids coming from untrusted input (URL). */
export function isTimeOfDay(value: string): value is TimeOfDay {
  return (TIMES_OF_DAY as readonly string[]).includes(value)
}

/**
 * Unit direction from the ground towards a light at compass `azimuthDeg`
 * and `elevationDeg` (see the module comment for the axes).
 */
export function lightDirection(azimuthDeg: number, elevationDeg: number): Vec3Like {
  const az = (azimuthDeg * Math.PI) / 180
  const el = (elevationDeg * Math.PI) / 180
  return {
    x: Math.cos(el) * Math.sin(az),
    y: Math.sin(el),
    z: -Math.cos(el) * Math.cos(az),
  }
}

/** Linear blend of two sRGB hex colours, channel by channel. */
function blendColor(a: number, b: number, t: number): number {
  let out = 0
  for (const shift of [16, 8, 0]) {
    const ca = (a >> shift) & 0xff
    const cb = (b >> shift) & 0xff
    out |= Math.round(ca + (cb - ca) * t) << shift
  }
  return out
}

/**
 * Share of the light dimmed half-way through a transition whose direction
 * turns by 180 degrees (sun to moon); less for smaller turns.
 */
const TURN_DIP = 0.8

/**
 * Lighting between presets `a` (t = 0) and `b` (t = 1), for smooth
 * transitions: colours and intensities blended linearly, the light's
 * azimuth along the shorter way round and its elevation linearly. When the
 * light turns a lot (from the setting sun to the moon), it dims half-way,
 * so the swing across the sky does not show.
 */
export function blendPresets(a: LightingPreset, b: LightingPreset, t: number): LightingPreset {
  const turn = ((((b.azimuthDeg - a.azimuthDeg) % 360) + 540) % 360) - 180
  const da = lightDirection(a.azimuthDeg, a.elevationDeg)
  const db = lightDirection(b.azimuthDeg, b.elevationDeg)
  const cos = Math.min(1, Math.max(-1, da.x * db.x + da.y * db.y + da.z * db.z))
  const dip = (TURN_DIP * Math.acos(cos)) / Math.PI
  const lerp = (x: number, y: number): number => x + (y - x) * t
  return {
    label: t < 0.5 ? a.label : b.label,
    azimuthDeg: (((a.azimuthDeg + turn * t) % 360) + 360) % 360,
    elevationDeg: lerp(a.elevationDeg, b.elevationDeg),
    lightColor: blendColor(a.lightColor, b.lightColor, t),
    lightIntensity: lerp(a.lightIntensity, b.lightIntensity) * (1 - dip * Math.sin(Math.PI * t)),
    skyColor: blendColor(a.skyColor, b.skyColor, t),
    groundColor: blendColor(a.groundColor, b.groundColor, t),
    ambientIntensity: lerp(a.ambientIntensity, b.ambientIntensity),
    background: blendColor(a.background, b.background, t),
  }
}

/**
 * Times of day a transition from `from` to `to` goes through, `to`
 * included, `from` excluded: the shorter way round the daily cycle,
 * forwards on a tie. Late night to morning goes through dawn (the night
 * ends) instead of back through the whole day.
 */
export function timePath(from: TimeOfDay, to: TimeOfDay): TimeOfDay[] {
  const n = TIMES_OF_DAY.length
  const a = TIMES_OF_DAY.indexOf(from)
  const b = TIMES_OF_DAY.indexOf(to)
  const forward = (b - a + n) % n
  const step = forward <= n - forward ? 1 : -1
  const count = step > 0 ? forward : n - forward
  const path: TimeOfDay[] = []
  for (let k = 1; k <= count; k++) {
    const time = TIMES_OF_DAY[(a + step * k + n * k) % n]
    if (time) path.push(time)
  }
  return path
}

/**
 * Lighting at `t` (0 to 1) along `keys` (at least one), each consecutive
 * pair taking an equal share of `t` and blended with {@link blendPresets}.
 */
export function blendAlong(keys: readonly LightingPreset[], t: number): LightingPreset {
  const last = keys.length - 1
  const first = keys[0]
  if (!first) throw new Error('blendAlong needs at least one preset')
  if (last <= 0) return first
  const x = Math.min(1, Math.max(0, t)) * last
  const i = Math.min(last - 1, Math.floor(x))
  const a = keys[i] ?? first
  const b = keys[i + 1] ?? a
  return blendPresets(a, b, x - i)
}
