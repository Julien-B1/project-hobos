/**
 * Scene creation and lighting: background, main light, ambient.
 *
 * Layer: render. One directional light (the sun by day, the moon at night;
 * it may cast shadows, see `sunShadow.ts`) plus a hemisphere ambient. The
 * time of day (`timeOfDay.ts`) sets their direction, colours and
 * intensities and the background; the ambient is fairly strong so shadowed
 * ground stays readable, as in HD-2D scenes.
 */
import { DirectionalLight, HemisphereLight, Scene } from 'three/webgpu'
import { lightDirection, type LightingPreset } from './timeOfDay'
import { canvasColor } from './outputEncoding'

/** Share of the sky colour mixed into the ambient light coming from below. */
const GROUND_LIFT = 0.4

/** Distance of the light from its target, in world units (only the direction matters). */
const LIGHT_DISTANCE = 50

/** The scene and its lights. */
export interface SceneHandle {
  readonly scene: Scene
  /** Main light; its position relative to its target sets the light direction. */
  readonly sun: DirectionalLight
  /** Sky / ground ambient. */
  readonly ambient: HemisphereLight
}

/** Create the scene with its background and lights, lit by `preset`. */
export function createScene(preset: LightingPreset): SceneHandle {
  const scene = new Scene()
  const ambient = new HemisphereLight()
  scene.add(ambient)
  const sun = new DirectionalLight()
  scene.add(sun)
  // The shadow framing moves the target; it must be in the scene graph.
  scene.add(sun.target)
  const handle = { scene, sun, ambient }
  applyLighting(handle, preset)
  return handle
}

/**
 * Light the scene with `preset`. The light is placed relative to its
 * current target; callers that frame shadows (`SunShadow`) must be told the
 * new direction.
 */
export function applyLighting(handle: SceneHandle, preset: LightingPreset): void {
  const { scene, sun, ambient } = handle
  scene.background = canvasColor(preset.background)
  ambient.color.setHex(preset.skyColor)
  // Light from below is lifted towards the sky colour: with the preset's
  // dark ground colour alone, vertical faces away from the sun (walls,
  // rock sides) went almost black.
  ambient.groundColor.setHex(preset.groundColor).lerp(ambient.color, GROUND_LIFT)
  ambient.intensity = preset.ambientIntensity
  sun.color.setHex(preset.lightColor)
  sun.intensity = preset.lightIntensity
  const d = lightDirection(preset.azimuthDeg, preset.elevationDeg)
  const t = sun.target.position
  sun.position.set(
    t.x + d.x * LIGHT_DISTANCE,
    t.y + d.y * LIGHT_DISTANCE,
    t.z + d.z * LIGHT_DISTANCE,
  )
}
