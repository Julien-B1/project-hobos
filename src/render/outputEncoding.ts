/**
 * Output encoding done in the materials, so the frame is drawn straight
 * into the canvas.
 *
 * Layer: render. With tone mapping or an output colour space other than
 * the working one, `WebGPURenderer` draws the scene into an intermediate
 * target (RGBA half float, multisampled, with depth and stencil), resolves
 * it, then copies it to the canvas through a full-screen pass that applies
 * tone mapping and sRGB encoding. That costs a fixed amount per pixel,
 * whatever the scene: measured at about 11 ms per frame at 1906 x 1271
 * (WebGL 2), against 3.5 ms at half resolution, with every layer off or
 * on.
 *
 * Instead, the renderer is left without tone mapping and in the working
 * colour space (see `createRenderer.ts`), so it renders directly into the
 * canvas, and every visible material ends with the same conversion itself
 * ({@link encodeOutput}): Neutral tone mapping, then sRGB. Same image, no
 * intermediate target, no extra pass. Blending of transparent materials
 * (water, highlight) happens on encoded values: a slight difference only.
 */
import { float, neutralToneMapping, output, sRGBTransferOETF, vec4 } from 'three/tsl'
import { Color, LinearSRGBColorSpace, type Node, type NodeMaterial } from 'three/webgpu'

/**
 * End `material` with tone mapping (Neutral) and sRGB encoding, as the
 * renderer's output pass would.
 */
export function encodeOutput<M extends NodeMaterial>(material: M): M {
  // Same functions as the renderer's output pass (exposure 1).
  const mapped = neutralToneMapping(output.rgb, float(1))
  // The function declarations are untyped (plain `Node`): RGB in, RGB out.
  const encoded = sRGBTransferOETF(mapped) as Node<'vec3'>
  material.outputNode = vec4(encoded, output.a)
  return material
}

/**
 * A colour written to the canvas as it is (the scene background, cleared
 * without any material): the sRGB hex taken as the final, encoded value.
 */
export function canvasColor(hex: number): Color {
  return new Color().setHex(hex, LinearSRGBColorSpace)
}
