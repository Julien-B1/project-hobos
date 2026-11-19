/**
 * Main light values shared with shaders that fake light effects without
 * the lighting pipeline (the water's view-independent sheen).
 *
 * Layer: render. Updated by the engine when the time of day changes.
 */
import { uniform } from 'three/tsl'
import { Color, Vector3, type UniformNode } from 'three/webgpu'
import { lightDirection, type LightingPreset } from './timeOfDay'

/** Light intensity at which shader effects are at full strength (daylight). */
const REFERENCE_INTENSITY = 2.6

/** Uniforms describing the main light. */
export interface LightUniforms {
  /** Unit direction from the ground towards the light (world space). */
  readonly direction: UniformNode<'vec3', Vector3>
  /** Light colour (linear) scaled by its intensity relative to daylight. */
  readonly color: UniformNode<'color', Color>
}

/** Create the uniforms (overhead white light until set). */
export function createLightUniforms(): LightUniforms {
  return { direction: uniform(new Vector3(0, 1, 0)), color: uniform(new Color(1, 1, 1)) }
}

/** Copy a lighting preset's main light into the uniforms. */
export function setLightUniforms(uniforms: LightUniforms, preset: LightingPreset): void {
  const d = lightDirection(preset.azimuthDeg, preset.elevationDeg)
  uniforms.direction.value.set(d.x, d.y, d.z)
  uniforms.color.value
    .setHex(preset.lightColor)
    .multiplyScalar(preset.lightIntensity / REFERENCE_INTENSITY)
}
