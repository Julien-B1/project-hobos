/**
 * Fine material detail texture, generated once on the CPU.
 *
 * Layer: render. Gives the terrain its small-scale definition (what a cell
 * looks like up close) at the cost of one texture fetch per pixel. Each
 * channel is a tileable greyscale pattern, also used as the material's
 * "height" for height-based blending (see `terrainMaterial.ts`): high values
 * poke through a neighbouring material first, which makes transitions
 * irregular and natural instead of smooth gradients.
 *
 * Channels:
 * - R: grass, fine clumpy speckle;
 * - G: dirt and path, pebbles (cellular dots) on a fine grain;
 * - B: rock and stone, cracks (cellular edges) over a fractal grain;
 * - A: sand, warped ripples with a fine grain.
 */
import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RGBAFormat,
  RepeatWrapping,
} from 'three/webgpu'
import { hash01 } from '@/core/noise'
import { periodicFbm, periodicNoise } from './noiseTexture'

/** Texture edge length, in texels. */
export const DETAIL_SIZE = 512

/**
 * Distances to the nearest and second nearest feature point of a periodic
 * cellular (Worley) noise with `period` cells over the texture, in cells.
 */
export function periodicCells(
  u: number,
  v: number,
  period: number,
  seed: number,
): { f1: number; f2: number; id: number } {
  const x = u * period
  const y = v * period
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  let f1 = Infinity
  let f2 = Infinity
  let id = 0
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx
      const cy = iy + dy
      const wx = ((cx % period) + period) % period
      const wy = ((cy % period) + period) % period
      const px = cx + hash01(wx, wy, seed)
      const py = cy + hash01(wx, wy, seed + 1)
      const d = Math.hypot(px - x, py - y)
      if (d < f1) {
        f2 = f1
        f1 = d
        id = hash01(wx, wy, seed + 2)
      } else if (d < f2) {
        f2 = d
      }
    }
  }
  return { f1, f2, id }
}

/** Smoothstep on numbers. */
function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/** RGBA bytes of the detail texture (`size` x `size`, tileable). */
export function detailPixels(size: number = DETAIL_SIZE): Uint8Array {
  const data = new Uint8Array(size * size * 4)
  const byte = (x: number): number => Math.round(Math.min(1, Math.max(0, x)) * 255)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size
      const v = y / size
      const i = (x + y * size) * 4

      const grass = 0.55 * periodicFbm(u, v, 48, 2, 71) + 0.45 * periodicNoise(u, v, 160, 73)

      const pebbles = periodicCells(u, v, 22, 79)
      const pebble = 1 - smooth(0.12 + 0.18 * pebbles.id, 0.3 + 0.18 * pebbles.id, pebbles.f1)
      const dirt = 0.45 * periodicFbm(u, v, 64, 2, 83) + 0.55 * pebble * (0.6 + 0.4 * pebbles.id)

      const cracks = periodicCells(u, v, 9, 89)
      const crack = smooth(0.0, 0.09, cracks.f2 - cracks.f1)
      const rock = (0.35 + 0.65 * periodicFbm(u, v, 16, 3, 97)) * (0.4 + 0.6 * crack)

      const warp = periodicFbm(u, v, 4, 2, 101)
      const ripple = 0.5 + 0.5 * Math.sin(2 * Math.PI * (18 * u + 6 * v + 2 * warp))
      const sand = 0.7 * ripple + 0.3 * periodicNoise(u, v, 128, 103)

      data[i] = byte(grass)
      data[i + 1] = byte(dirt)
      data[i + 2] = byte(rock)
      data[i + 3] = byte(sand)
    }
  }
  return data
}

/** Build the detail texture (about 0.2 s, once at start-up). */
export function createDetailTexture(): DataTexture {
  const texture = new DataTexture(detailPixels(), DETAIL_SIZE, DETAIL_SIZE, RGBAFormat)
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.magFilter = LinearFilter
  texture.minFilter = LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
  return texture
}
