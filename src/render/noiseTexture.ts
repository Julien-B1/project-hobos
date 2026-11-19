/**
 * Small tileable noise texture, generated once on the CPU.
 *
 * Layer: render. Shaders sample this texture instead of evaluating noise
 * functions per pixel: one texture fetch replaces dozens of ALU operations,
 * which keeps the terrain shader cheap.
 *
 * Channels (each an independent periodic fractal value noise in [0, 1]):
 * - R: large colour variation;
 * - G: fine detail (speckles);
 * - B, A: blend wobble for material transitions.
 * The texture repeats; shaders sample it at two scales with unrelated
 * ratios, so the repetition is not visible.
 */
import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RGBAFormat,
  RepeatWrapping,
} from 'three/webgpu'
import { hash01 } from '@/core/noise'

/** Texture edge length, in texels. */
const SIZE = 256

/** Periodic value noise in [0, 1]: lattice of `period` cells over the unit square, wrapping. */
export function periodicNoise(u: number, v: number, period: number, seed: number): number {
  const x = u * period
  const y = v * period
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  const at = (i: number, j: number): number =>
    hash01(((i % period) + period) % period, ((j % period) + period) % period, seed)
  const a = at(x0, y0)
  const b = at(x0 + 1, y0)
  const c = at(x0, y0 + 1)
  const d = at(x0 + 1, y0 + 1)
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
}

/** Periodic fractal noise, normalised to [0, 1]. */
export function periodicFbm(
  u: number,
  v: number,
  basePeriod: number,
  octaves: number,
  seed: number,
): number {
  let sum = 0
  let amplitude = 1
  let total = 0
  for (let i = 0; i < octaves; i++) {
    sum += periodicNoise(u, v, basePeriod << i, seed + i * 101) * amplitude
    total += amplitude
    amplitude *= 0.5
  }
  return sum / total
}

/** Build the RGBA noise texture (about 0.1 s, once at start-up). */
export function createNoiseTexture(): DataTexture {
  const data = new Uint8Array(SIZE * SIZE * 4)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE
      const v = y / SIZE
      const i = (x + y * SIZE) * 4
      data[i] = Math.round(periodicFbm(u, v, 4, 4, 11) * 255)
      data[i + 1] = Math.round(periodicFbm(u, v, 32, 2, 23) * 255)
      data[i + 2] = Math.round(periodicFbm(u, v, 8, 3, 37) * 255)
      data[i + 3] = Math.round(periodicFbm(u, v, 8, 3, 53) * 255)
    }
  }
  const texture = new DataTexture(data, SIZE, SIZE, RGBAFormat)
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.magFilter = LinearFilter
  texture.minFilter = LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
  return texture
}
