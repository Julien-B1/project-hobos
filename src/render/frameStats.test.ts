import { describe, expect, it } from 'vitest'
import { FrameStats, STATS_WINDOW_MS, estimateVram } from './frameStats'

describe('FrameStats', () => {
  it('reports fps once per window', () => {
    const stats = new FrameStats()
    expect(stats.frame(0)).toBeNull() // starts the window
    let result = null
    for (let t = 16; t <= STATS_WINDOW_MS + 16; t += 16) result = stats.frame(t) ?? result
    expect(result?.fps).toBeGreaterThanOrEqual(60)
    expect(result?.fps).toBeLessThanOrEqual(63)
  })

  it('derives the GPU load from the mean GPU time and the frame interval', () => {
    const stats = new FrameStats()
    stats.frame(0)
    let result = null
    for (let t = 20; t <= STATS_WINDOW_MS; t += 20) {
      stats.gpuSample(5)
      result = stats.frame(t) ?? result
    }
    // 50 fps (20 ms per frame), 5 ms of GPU work per frame: 25 %.
    expect(result?.gpuMs).toBeCloseTo(5)
    expect(result?.gpuLoad).toBeCloseTo(0.25)
  })

  it('reports no GPU figures without valid samples', () => {
    const stats = new FrameStats()
    stats.frame(0)
    stats.gpuSample(undefined)
    stats.gpuSample(0)
    const result = stats.frame(STATS_WINDOW_MS)
    expect(result?.gpuMs).toBeNull()
    expect(result?.gpuLoad).toBeNull()
  })
})

describe('estimateVram', () => {
  it('adds untracked MSAA samples and the canvas to the tracked allocations', () => {
    const v = estimateVram({ total: 3000, texturesSize: 1000 }, 10, 10, 4)
    expect(v.textures).toBe(1000)
    expect(v.buffers).toBe(2000)
    // 100 px x (3 extra samples x 8 B + 4 B canvas).
    expect(v.framebuffer).toBe(100 * (3 * 8 + 4))
    expect(v.total).toBe(3000 + v.framebuffer)
  })

  it('counts only the canvas without MSAA', () => {
    expect(estimateVram({ total: 0, texturesSize: 0 }, 10, 10, 1).framebuffer).toBe(400)
  })
})
