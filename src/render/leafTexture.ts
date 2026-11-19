/**
 * Foliage atlas for leaf cards and scatter cards, generated once on the CPU.
 *
 * Layer: render. A 4 x 4 atlas of 128 x 128 cells (row r covers v in
 * [r / 4, (r + 1) / 4), row 0 at the start of the data). Every cell is drawn
 * from pointed leaf shapes ("blades"), anti-aliased over about one texel,
 * with a margin so mipmaps do not bleed between cells:
 * - row 0: broad-leaf clusters (oaks, bushes, fallen leaves), greyscale;
 * - row 1: needle twigs (pines), greyscale;
 * - row 2: small round leaves (birches), greyscale;
 * - row 3, in colour (cards using it get a near-white vertex colour):
 *   grass tuft, grass tuft with flowers, reeds with cattails, algae.
 * Greyscale cells are a shade multiplied by the card's vertex colour; the
 * alpha channel is the mask.
 */
import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RGBAFormat,
} from 'three/webgpu'
import { hash01 } from '@/core/noise'

/** Texture edge length, in texels (4 x 4 cells). */
export const LEAF_TEXTURE_SIZE = 512

/** Cells per atlas row and column. */
export const ATLAS_CELLS = 4

/** Atlas rows, see the module comment. */
export const AtlasRow = {
  BROADLEAF: 0,
  NEEDLES: 1,
  BIRCH: 2,
  SCATTER: 3,
} as const

/** Cells of the scatter row. */
export const ScatterCell = {
  GRASS: 0,
  FLOWERS: 1,
  REEDS: 2,
  ALGAE: 3,
} as const

/** One pointed blade in cell units (0..1), with its colour (0..1 RGB). */
interface Blade {
  readonly x: number
  readonly y: number
  /** Unit direction from base to tip. */
  readonly dx: number
  readonly dy: number
  readonly length: number
  readonly width: number
  readonly color: readonly [number, number, number]
  /** Profile exponent: lower is rounder. */
  readonly roundness?: number
}

/** Paint a blade into a cell of the atlas (painter's order, anti-aliased). */
function paint(data: Uint8Array, size: number, cell: number, row: number, blade: Blade): void {
  const cellSize = size / ATLAS_CELLS
  const x0 = cell * cellSize
  const y0 = row * cellSize
  const tipX = blade.x + blade.dx * blade.length
  const tipY = blade.y + blade.dy * blade.length
  const pad = blade.width + 2 / cellSize
  // Rasterise the blade's bounding box only, kept inside the cell margin.
  const lo = 2
  const hi = cellSize - 3
  const minX = Math.max(lo, Math.floor((Math.min(blade.x, tipX) - pad) * cellSize))
  const maxX = Math.min(hi, Math.ceil((Math.max(blade.x, tipX) + pad) * cellSize))
  const minY = Math.max(lo, Math.floor((Math.min(blade.y, tipY) - pad) * cellSize))
  const maxY = Math.min(hi, Math.ceil((Math.max(blade.y, tipY) + pad) * cellSize))
  const exponent = blade.roundness ?? 0.8
  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      const rx = (px + 0.5) / cellSize - blade.x
      const ry = (py + 0.5) / cellSize - blade.y
      const s = rx * blade.dx + ry * blade.dy // along the blade
      const t = -rx * blade.dy + ry * blade.dx // across it
      if (s < 0 || s > blade.length) continue
      const profile = (blade.width / 2) * Math.pow(Math.sin((Math.PI * s) / blade.length), exponent)
      const coverage = Math.min(1, Math.max(0, (profile - Math.abs(t)) * cellSize + 0.5))
      if (coverage <= 0) continue
      // Lighter midrib, darker edges.
      const across = profile > 0 ? Math.abs(t) / profile : 1
      const shade = (1 - 0.25 * across * across) * (Math.abs(t) * cellSize < 0.8 ? 1.1 : 1)
      const i = (x0 + px + (y0 + py) * size) * 4
      for (let c = 0; c < 3; c++) {
        const old = (data[i + c] ?? 0) / 255
        const value = Math.min(1, (blade.color[c] ?? 0) * shade)
        data[i + c] = Math.round((old * (1 - coverage) + value * coverage) * 255)
      }
      const a = (data[i + 3] ?? 0) / 255
      data[i + 3] = Math.round((a + (1 - a) * coverage) * 255)
    }
  }
}

/** Deterministic random number for blade `i` of a cell. */
const rand = (cell: number, i: number, k: number): number => hash01(cell * 131 + i, k, 401)

/** Grey colour of a given shade. */
const grey = (v: number): readonly [number, number, number] => [v, v, v]

/** Blades of a broad-leaf cluster: leaves around the centre, pointing out. */
function broadleaf(cell: number): Blade[] {
  return Array.from({ length: 40 }, (_, i) => {
    const r = 0.2 * Math.sqrt(rand(cell, i, 0))
    const a = rand(cell, i, 1) * Math.PI * 2
    const turn = a + (rand(cell, i, 2) - 0.5) * 1.6
    const length = 0.18 + 0.09 * rand(cell, i, 3)
    return {
      x: 0.5 + r * Math.cos(a),
      y: 0.5 + r * Math.sin(a),
      dx: Math.cos(turn),
      dy: Math.sin(turn),
      length,
      width: length * (0.38 + 0.12 * rand(cell, i, 4)),
      color: grey(0.72 + 0.28 * rand(cell, i, 5)),
    }
  })
}

/**
 * Blades of a needle cluster: a dense bough, many twigs from the centre
 * with thick, overlapping needles, so a card reads as a full fir branch
 * rather than a thin star.
 */
function needles(cell: number): Blade[] {
  const blades: Blade[] = []
  const twigs = 11
  for (let k = 0; k < twigs; k++) {
    const a = ((k + rand(cell, k, 10) * 0.7) / twigs) * Math.PI * 2
    const dx = Math.cos(a)
    const dy = Math.sin(a)
    const length = 0.26 + 0.1 * rand(cell, k, 11)
    blades.push({ x: 0.5, y: 0.5, dx, dy, length, width: 0.03, color: grey(0.6) })
    for (let s = 0.02; s < length; s += 0.016) {
      for (const side of [-1, 1]) {
        const n = blades.length
        const spread = side * (0.6 + 0.35 * rand(cell, n, 12))
        const nx = dx * Math.cos(spread) - dy * Math.sin(spread)
        const ny = dx * Math.sin(spread) + dy * Math.cos(spread)
        const needle = (0.1 + 0.05 * rand(cell, n, 13)) * (1 - (s / length) * 0.35)
        blades.push({
          x: 0.5 + dx * s,
          y: 0.5 + dy * s,
          dx: nx,
          dy: ny,
          length: needle,
          width: 0.034,
          color: grey(0.7 + 0.3 * rand(cell, n, 14)),
        })
      }
    }
  }
  return blades
}

/** Blades of a birch cluster: many small, round leaves. */
function birch(cell: number): Blade[] {
  return Array.from({ length: 70 }, (_, i) => {
    const r = 0.3 * Math.sqrt(rand(cell, i, 20))
    const a = rand(cell, i, 21) * Math.PI * 2
    const turn = rand(cell, i, 22) * Math.PI * 2
    const length = 0.09 + 0.04 * rand(cell, i, 23)
    return {
      x: 0.5 + r * Math.cos(a),
      y: 0.5 + r * Math.sin(a),
      dx: Math.cos(turn),
      dy: Math.sin(turn),
      length,
      width: length * 0.65,
      roundness: 0.55,
      color: grey(0.75 + 0.25 * rand(cell, i, 24)),
    }
  })
}

/** Upright blades rooted along the bottom of a cell (grass, reeds). */
function tuft(
  cell: number,
  count: number,
  minLength: number,
  maxLength: number,
  width: number,
  lean: number,
  colorOf: (i: number) => readonly [number, number, number],
): Blade[] {
  return Array.from({ length: count }, (_, i) => {
    const a = (rand(cell, i, 30) - 0.5) * lean
    return {
      x: 0.32 + 0.36 * rand(cell, i, 31),
      y: 0.03,
      dx: Math.sin(a),
      dy: Math.cos(a),
      length: minLength + (maxLength - minLength) * rand(cell, i, 32),
      width,
      color: colorOf(i),
    }
  })
}

/** Green of a grass blade. */
function grassGreen(cell: number, i: number): readonly [number, number, number] {
  const k = 0.75 + 0.35 * rand(cell, i, 40)
  return [0.2 * k, 0.42 * k, 0.1 * k]
}

/** Blades of the scatter row's cell `cell` (see {@link ScatterCell}). */
function scatter(cell: number): Blade[] {
  const id = AtlasRow.SCATTER * ATLAS_CELLS + cell
  switch (cell) {
    case ScatterCell.GRASS:
      return tuft(id, 26, 0.35, 0.8, 0.055, 1.1, (i) => grassGreen(id, i))
    case ScatterCell.FLOWERS: {
      const blades = tuft(id, 18, 0.3, 0.65, 0.05, 1.1, (i) => grassGreen(id, i))
      // Small flowers: a ring of round petals, white or yellow.
      for (let f = 0; f < 4; f++) {
        const cx = 0.3 + 0.4 * rand(id, f, 50)
        const cy = 0.5 + 0.3 * rand(id, f, 51)
        const yellow = rand(id, f, 52) > 0.5
        const petal: readonly [number, number, number] = yellow
          ? [0.95, 0.8, 0.25]
          : [0.95, 0.93, 0.9]
        for (let p = 0; p < 5; p++) {
          const a = (p / 5) * Math.PI * 2 + rand(id, f, 53)
          blades.push({
            x: cx,
            y: cy,
            dx: Math.cos(a),
            dy: Math.sin(a),
            length: 0.06,
            width: 0.045,
            roundness: 0.5,
            color: petal,
          })
        }
      }
      return blades
    }
    case ScatterCell.REEDS: {
      const blades = tuft(id, 14, 0.7, 0.92, 0.035, 0.5, (i) => {
        const k = 0.8 + 0.3 * rand(id, i, 60)
        return [0.3 * k, 0.42 * k, 0.16 * k]
      })
      // Cattail heads near the top of a few stems.
      for (let c = 0; c < 3; c++) {
        const stem = blades[c]
        if (!stem) continue
        blades.push({
          x: stem.x + stem.dx * stem.length * 0.72,
          y: stem.y + stem.dy * stem.length * 0.72,
          dx: stem.dx,
          dy: stem.dy,
          length: 0.16,
          width: 0.07,
          roundness: 0.4,
          color: [0.35, 0.22, 0.12],
        })
      }
      return blades
    }
    default: {
      // Algae: wavy ribbons made of short segments along a sine path.
      const blades: Blade[] = []
      for (let r = 0; r < 9; r++) {
        let x = 0.3 + 0.4 * rand(id, r, 70)
        let y = 0.03
        const phase = rand(id, r, 71) * Math.PI * 2
        const k = 0.75 + 0.35 * rand(id, r, 72)
        for (let s = 0; s < 8; s++) {
          const a = Math.sin(phase + s * 0.9) * 0.45
          const length = 0.1
          blades.push({
            x,
            y,
            dx: Math.sin(a),
            dy: Math.cos(a),
            length: length * 1.4,
            width: 0.06,
            color: [0.16 * k, 0.3 * k, 0.12 * k],
          })
          x += Math.sin(a) * length
          y += Math.cos(a) * length
        }
      }
      return blades
    }
  }
}

/** RGBA bytes of the atlas (`size` x `size`), see the module comment. */
export function leafPixels(size: number = LEAF_TEXTURE_SIZE): Uint8Array {
  const data = new Uint8Array(size * size * 4)
  for (let cell = 0; cell < ATLAS_CELLS; cell++) {
    const rows: [number, Blade[]][] = [
      [AtlasRow.BROADLEAF, broadleaf(cell)],
      [AtlasRow.NEEDLES, needles(cell + 4)],
      [AtlasRow.BIRCH, birch(cell + 8)],
      [AtlasRow.SCATTER, scatter(cell)],
    ]
    for (const [row, blades] of rows) for (const b of blades) paint(data, size, cell, row, b)
  }
  return data
}

/** Build the atlas texture (a few tens of ms, once at start-up). */
export function createLeafTexture(): DataTexture {
  const texture = new DataTexture(leafPixels(), LEAF_TEXTURE_SIZE, LEAF_TEXTURE_SIZE, RGBAFormat)
  texture.wrapS = ClampToEdgeWrapping
  texture.wrapT = ClampToEdgeWrapping
  texture.magFilter = LinearFilter
  texture.minFilter = LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
  return texture
}
