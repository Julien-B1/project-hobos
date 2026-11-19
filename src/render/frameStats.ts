/**
 * Frame statistics for the debug HUD: frame rate, GPU time and load, and an
 * estimate of the page's GPU memory.
 *
 * Layer: render (no Three.js import, unit-tested). The engine feeds it
 * timings; it averages them over fixed windows.
 *
 * Browsers expose neither the system GPU load nor the VRAM used by a page:
 * - **GPU load** is derived from GPU timestamp queries (time the GPU spends
 *   on this page's passes per frame) divided by the frame interval. It is the
 *   page's own share, comparable across settings, not the OS-wide figure.
 * - **VRAM** is estimated from the allocations Three.js tracks (buffers,
 *   textures, render targets at one sample) plus what it does not track:
 *   extra MSAA samples of the frame buffer target and the canvas itself.
 */

/** Length of the measurement window, in milliseconds. */
export const STATS_WINDOW_MS = 500

/** Averages of one measurement window. */
export interface WindowStats {
  /** Frames per second. */
  readonly fps: number
  /** Mean GPU time per frame (ms), or null when no GPU sample arrived. */
  readonly gpuMs: number | null
  /** Share of the frame interval the GPU spends on this page (0..1), or null. */
  readonly gpuLoad: number | null
}

/** Accumulates frame and GPU timings and yields per-window averages. */
export class FrameStats {
  private frames = 0
  private windowStart: number | null = null
  private gpuSum = 0
  private gpuCount = 0

  /**
   * Count one frame drawn at `time` (ms). Returns the window's averages when
   * the window is complete, null otherwise.
   */
  frame(time: number): WindowStats | null {
    if (this.windowStart === null) {
      this.windowStart = time
      return null
    }
    this.frames++
    const elapsed = time - this.windowStart
    if (elapsed < STATS_WINDOW_MS) return null
    const fps = (this.frames * 1000) / elapsed
    const gpuMs = this.gpuCount > 0 ? this.gpuSum / this.gpuCount : null
    const gpuLoad = gpuMs === null ? null : Math.min(1, (gpuMs * fps) / 1000)
    this.frames = 0
    this.windowStart = time
    this.gpuSum = 0
    this.gpuCount = 0
    return { fps: Math.round(fps), gpuMs, gpuLoad }
  }

  /** Record the GPU time (ms) of one frame. Ignores invalid samples. */
  gpuSample(ms: number | undefined): void {
    if (ms === undefined || !Number.isFinite(ms) || ms <= 0) return
    this.gpuSum += ms
    this.gpuCount++
  }
}

/** Memory figures tracked by Three.js (`renderer.info.memory`), in bytes. */
export interface TrackedMemory {
  readonly total: number
  readonly texturesSize: number
}

/** Estimated GPU memory of the page, in bytes. */
export interface VramEstimate {
  /** Sum of the parts below. */
  readonly total: number
  /** Textures and render targets tracked by Three.js (one sample each). */
  readonly textures: number
  /** Vertex, index, uniform and other buffers tracked by Three.js. */
  readonly buffers: number
  /** Untracked: extra MSAA samples (colour + depth) and the canvas buffer. */
  readonly framebuffer: number
}

/**
 * Bytes per pixel of one colour sample (RGBA8: the frame is drawn straight
 * into the canvas, see `outputEncoding.ts`) and of one depth-stencil sample.
 */
const COLOR_BYTES = 4
const DEPTH_BYTES = 4
/** Bytes per pixel of the canvas (swap chain) buffer. */
const CANVAS_BYTES = 4

/**
 * Estimate the page's GPU memory from Three.js' tracked allocations and the
 * drawing buffer size (device pixels) and MSAA sample count.
 */
export function estimateVram(
  memory: TrackedMemory,
  width: number,
  height: number,
  samples: number,
): VramEstimate {
  const pixels = width * height
  // Three.js counts the frame buffer target once; MSAA keeps `samples`
  // copies of colour and depth.
  const extraSamples = Math.max(0, samples - 1)
  const framebuffer = pixels * (extraSamples * (COLOR_BYTES + DEPTH_BYTES) + CANVAS_BYTES)
  const textures = memory.texturesSize
  const buffers = Math.max(0, memory.total - memory.texturesSize)
  return { total: textures + buffers + framebuffer, textures, buffers, framebuffer }
}
