/**
 * Renderer creation and backend detection.
 *
 * Layer: render. Creates a Three.js `WebGPURenderer` on a given canvas. The
 * renderer picks WebGPU when the browser supports it and silently falls back
 * to WebGL 2 otherwise; this module reports which backend was really chosen,
 * so the HUD can display it.
 */
import { NeutralToneMapping, PCFShadowMap, WebGPURenderer } from 'three/webgpu'
import { STENCIL_BASE } from './sectionCap'

/** Graphics backend actually used by the renderer after initialisation. */
export type RenderBackend = 'WebGPU' | 'WebGL 2'

/** Options for {@link createRenderer}. */
export interface CreateRendererOptions {
  /** Skip WebGPU and use the WebGL 2 backend (debug, `?forceWebGL=1`). */
  readonly forceWebGL: boolean
  /** Enable the shadow map system (PCF filtering). */
  readonly shadows: boolean
}

/** An initialised renderer and the backend it runs on. */
export interface RendererHandle {
  readonly renderer: WebGPURenderer
  readonly backend: RenderBackend
  /**
   * Whether GPU timestamp queries are available (WebGPU `timestamp-query`
   * feature, or `EXT_disjoint_timer_query_webgl2` on WebGL 2). When true,
   * `renderer.resolveTimestampsAsync()` yields the GPU time of a frame.
   */
  readonly gpuTiming: boolean
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
    // GPU timing for the debug HUD; a few queries per frame, negligible cost.
    trackTimestamp: true,
    // Stencil buffer for the cut section (`sectionCap.ts`).
    stencil: true,
  })
  renderer.setClearStencil(STENCIL_BASE)
  // Neutral tone mapping (Khronos PBR Neutral): leaves mid-tones and the
  // material palette almost untouched and only rolls off highlights (sun
  // glints on water), instead of clipping them to white. A few ALU per pixel.
  renderer.toneMapping = NeutralToneMapping
  renderer.shadowMap.enabled = options.shadows
  renderer.shadowMap.type = PCFShadowMap
  await renderer.init()
  return { renderer, backend: detectBackend(renderer), gpuTiming: hasGpuTiming(renderer) }
}

/**
 * Whether the backend kept timestamp tracking after initialisation: WebGPU
 * turns it off without the `timestamp-query` feature, WebGL 2 needs the
 * disjoint timer extension. Both flags are internal backend fields.
 */
function hasGpuTiming(renderer: WebGPURenderer): boolean {
  const backend = renderer.backend as { trackTimestamp?: boolean; disjoint?: unknown }
  if (backend.trackTimestamp !== true) return false
  return detectBackend(renderer) === 'WebGPU' || Boolean(backend.disjoint)
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
