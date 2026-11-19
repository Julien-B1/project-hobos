/**
 * Renderer creation and backend detection.
 *
 * Layer: render. Creates a Three.js `WebGPURenderer` on a given canvas. The
 * renderer picks WebGPU when the browser supports it and silently falls back
 * to WebGL 2 otherwise; this module reports which backend was really chosen,
 * so the HUD can display it.
 */
import { WebGPURenderer } from 'three/webgpu'

/** Graphics backend actually used by the renderer after initialisation. */
export type RenderBackend = 'WebGPU' | 'WebGL 2'

/** Options for {@link createRenderer}. */
export interface CreateRendererOptions {
  /** Skip WebGPU and use the WebGL 2 backend (debug, `?forceWebGL=1`). */
  readonly forceWebGL: boolean
}

/** An initialised renderer and the backend it runs on. */
export interface RendererHandle {
  readonly renderer: WebGPURenderer
  readonly backend: RenderBackend
}

/**
 * Create and initialise a renderer bound to `canvas`.
 *
 * `init()` must be awaited before the first frame: it negotiates the WebGPU
 * adapter/device or sets up the WebGL 2 fallback. Only after that is the
 * backend known.
 */
export async function createRenderer(
  canvas: HTMLCanvasElement,
  options: CreateRendererOptions,
): Promise<RendererHandle> {
  const renderer = new WebGPURenderer({
    canvas,
    antialias: true,
    forceWebGL: options.forceWebGL,
  })
  await renderer.init()
  return { renderer, backend: detectBackend(renderer) }
}

/**
 * Identify the backend chosen by `WebGPURenderer`.
 *
 * The WebGPU backend class carries a readonly `isWebGPUBackend` flag; the
 * WebGL fallback does not. Checking the flag avoids importing backend classes.
 */
function detectBackend(renderer: WebGPURenderer): RenderBackend {
  return 'isWebGPUBackend' in renderer.backend ? 'WebGPU' : 'WebGL 2'
}
