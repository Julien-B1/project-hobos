/**
 * Scene creation: background and lights.
 *
 * Layer: render. Lighting is deliberately simple (one directional "sun" plus
 * a hemisphere ambient) until the HD-2D look is tuned in a later step.
 */
import { Color, DirectionalLight, HemisphereLight, Scene } from 'three/webgpu'

/** Background colour of the scene (dark blue-grey). */
const BACKGROUND = 0x1b232c

/**
 * Create the scene with its background and lights.
 *
 * The sun shines from above and slightly from the side, so the vertical faces
 * of blocks get different shades and the relief stays readable.
 */
export function createScene(): Scene {
  const scene = new Scene()
  scene.background = new Color(BACKGROUND)

  // Ambient term: sky colour from above, ground colour from below.
  const ambient = new HemisphereLight(0xdfe8f2, 0x3a3328, 0.9)
  scene.add(ambient)

  const sun = new DirectionalLight(0xfff4e0, 2.2)
  sun.position.set(-20, 40, 12)
  scene.add(sun)

  return scene
}
