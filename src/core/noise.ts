/**
 * Deterministic hashing and 2D noise for procedural generation.
 *
 * Layer: core (pure TypeScript). Everything is a pure function of its inputs
 * and a numeric seed: the same seed always gives the same map, on every
 * platform (only 32-bit integer maths and IEEE doubles are involved).
 *
 * - `hash2` / `hash01`: integer lattice hashing (white noise).
 * - `valueNoise2`: smooth value noise in [0, 1] (random values on the integer
 *   lattice, quintic interpolation between them).
 * - `fbm2`: fractal sum of value noise octaves, normalised to [0, 1].
 */

/**
 * 32-bit hash of an integer lattice point and a seed.
 * Inputs are truncated to 32-bit integers.
 */
export function hash2(x: number, z: number, seed: number): number {
  let h =
    Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(z | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1)
  // Final avalanche (murmur3 fmix32): spreads every input bit over the output.
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/** Hash of a lattice point mapped to [0, 1). */
export function hash01(x: number, z: number, seed: number): number {
  return hash2(x, z, seed) / 4294967296
}

/** Quintic fade curve 6t^5 - 15t^4 + 10t^3: zero first and second derivatives at 0 and 1. */
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10)
}

/** Value noise at a real position, in [0, 1]. Continuous and smooth. */
export function valueNoise2(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x)
  const z0 = Math.floor(z)
  const tx = fade(x - x0)
  const tz = fade(z - z0)
  const a = hash01(x0, z0, seed)
  const b = hash01(x0 + 1, z0, seed)
  const c = hash01(x0, z0 + 1, seed)
  const d = hash01(x0 + 1, z0 + 1, seed)
  const top = a + (b - a) * tx
  const bottom = c + (d - c) * tx
  return top + (bottom - top) * tz
}

/**
 * Value noise at a real 3D position, in [0, 1]. Continuous and smooth
 * (trilinear interpolation of lattice hashes with the quintic fade).
 */
export function valueNoise3(x: number, y: number, z: number, seed: number): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const z0 = Math.floor(z)
  const tx = fade(x - x0)
  const ty = fade(y - y0)
  const tz = fade(z - z0)
  // Lattice hash of (i, j, k): the y layer is folded into the seed.
  const at = (i: number, j: number, k: number): number => hash01(i, k, hash2(j, seed, 0x51ed))
  const plane = (j: number): number => {
    const a = at(x0, j, z0)
    const b = at(x0 + 1, j, z0)
    const c = at(x0, j, z0 + 1)
    const d = at(x0 + 1, j, z0 + 1)
    const near = a + (b - a) * tx
    const far = c + (d - c) * tx
    return near + (far - near) * tz
  }
  const low = plane(y0)
  return low + (plane(y0 + 1) - low) * ty
}

/** Options for {@link fbm2}. */
export interface FbmOptions {
  /** Number of noise layers (default 5). */
  readonly octaves?: number
  /** Frequency multiplier between octaves (default 2). */
  readonly lacunarity?: number
  /** Amplitude multiplier between octaves (default 0.5). */
  readonly gain?: number
}

/**
 * Fractal Brownian motion: sum of value-noise octaves of increasing frequency
 * and decreasing amplitude, normalised to [0, 1]. Each octave uses a
 * different derived seed so layers are not correlated.
 */
export function fbm2(x: number, z: number, seed: number, options: FbmOptions = {}): number {
  const { octaves = 5, lacunarity = 2, gain = 0.5 } = options
  let sum = 0
  let amplitude = 1
  let total = 0
  let frequency = 1
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise2(x * frequency, z * frequency, seed + i * 1013) * amplitude
    total += amplitude
    amplitude *= gain
    frequency *= lacunarity
  }
  return sum / total
}

/** Hermite smoothstep of `x` between `edge0` and `edge1`, in [0, 1]. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}
