/**
 * Wind for vegetation shaders (TSL helpers).
 *
 * Layer: render. A slow gust wave crosses the map; each plant sways around
 * it with its own phase (from its position), so neighbours do not move in
 * lockstep. Evaluated per vertex: a few sines, no texture fetch.
 */
import { float, sin, cos, time, vec3 } from 'three/tsl'
import type { Node } from 'three/webgpu'

/** Gust wave: speed (radians per second) and spatial frequency (per world unit). */
const GUST_SPEED = 0.6
const GUST_FREQUENCY = 0.11

/**
 * Horizontal sway offset (world units, before scaling) of a plant anchored
 * at `anchor`: unit-ish amplitude, stronger during gusts.
 */
export function windSway(anchor: Node<'vec3'>): Node<'vec3'> {
  const phase = anchor.x.mul(1.3).add(anchor.z.mul(0.9)).add(anchor.y.mul(2.1))
  const gust = sin(time.mul(GUST_SPEED).add(anchor.x.mul(GUST_FREQUENCY)).add(anchor.z.mul(0.07)))
    .mul(0.5)
    .add(0.5)
  const strength = float(0.35).add(gust.mul(0.65))
  return vec3(
    sin(time.mul(1.7).add(phase)),
    0,
    cos(time.mul(1.3).add(phase.mul(1.7))).mul(0.6),
  ).mul(strength)
}

/** Fast small flutter (leaves), in [-1, 1], with a phase from `anchor`. */
export function windFlutter(anchor: Node<'vec3'>): Node<'float'> {
  return sin(time.mul(4.3).add(anchor.x.mul(3.7)).add(anchor.z.mul(2.9)).add(anchor.y.mul(5.1)))
}
