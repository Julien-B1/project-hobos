/**
 * Mesher of the slab bridge (`slabBridge` kind): a clapper bridge.
 *
 * Layer: render (no Three.js import). Masonry abutments bedded in each bank;
 * masonry piers standing on the bed at most {@link MAX_BAY} apart, with a
 * pointed cutwater on both faces (the river flows across the span); one
 * thick stone slab per bay, laid from support to support, flush with the
 * banks.
 */
import { isBridgeSpan } from '@/core/structures/bridges/bridgeSpan'
import { SLAB_BRIDGE } from '@/core/structures/bridges/slabBridge'
import { aabb, add, box, hash3, scale, type Vec3 } from '../geometry/primitives'
import { normalize } from '../meshing/meshBuilder'
import { masonry, stone } from './surfaces'
import { bridgeFrame, type BridgeFrame } from './bridgeFrame'
import { defineMesher } from './structureMesher'
import type { MeshBuilder } from '../meshing/meshBuilder'

/** Longest slab between two supports, world units. */
const MAX_BAY = 2.6
const SLAB = 0.24
const PIER = { along: 0.56, overhang: 0.15 }
const STONE_TONES = [0x9c968b, 0x938d82, 0xa59f94]

/** Support positions (u): bank abutments and evenly spaced piers. */
export function slabSupports(length: number): number[] {
  const free = length - 1
  const bays = Math.max(1, Math.ceil(free / MAX_BAY))
  return Array.from({ length: bays + 1 }, (_, i) => 0.5 + (free * i) / bays)
}

/** The slab bridge mesher. */
export const slabBridgeMesher = defineMesher(SLAB_BRIDGE, isBridgeSpan, (span, out) => {
  const f = bridgeFrame(span)
  const slabBottom = f.deckTop - SLAB
  const supports = slabSupports(f.length)
  const wall = masonry(0x8e877b)
  supports.forEach((u, i) => {
    if (i === 0 || i === supports.length - 1) abutment(out, f, u, slabBottom, wall)
    else pier(out, f, u, slabBottom, wall)
  })
  // One slab per bay, from support to support (ends reach the span ends).
  for (let i = 0; i + 1 < supports.length; i++) {
    const a = i === 0 ? 0.02 : (supports[i] ?? 0) + 0.008
    const b = i + 2 === supports.length ? f.length - 0.02 : (supports[i + 1] ?? 0) - 0.008
    const r = (k: number): number => hash3(span.from + i, span.side, 31 + k)
    const tone = STONE_TONES[Math.floor(r(1) * STONE_TONES.length)] ?? 0x9c968b
    const lift = (r(2) - 0.5) * 0.015
    corners(
      out,
      f,
      a,
      b,
      slabBottom + lift,
      f.deckTop + lift,
      -0.06,
      f.width + 0.06,
      stone(tone, 0.95 + r(3) * 0.1),
    )
  }
})

/** Axis-aligned box in span coordinates (u, y, v ranges). */
function corners(
  out: MeshBuilder,
  f: BridgeFrame,
  u0: number,
  u1: number,
  y0: number,
  y1: number,
  v0: number,
  v1: number,
  s: Parameters<typeof aabb>[3],
): void {
  const a = f.at(u0, y0, v0)
  const b = f.at(u1, y1, v1)
  aabb(
    out,
    [Math.min(a[0], b[0]), y0, Math.min(a[2], b[2])],
    [Math.max(a[0], b[0]), y1, Math.max(a[2], b[2])],
    s,
  )
}

/** Abutment: a masonry block bedded in the bank under the slab's end. */
function abutment(
  out: MeshBuilder,
  f: BridgeFrame,
  u: number,
  top: number,
  s: Parameters<typeof aabb>[3],
): void {
  const u0 = u < f.length / 2 ? 0 : f.length - 1
  corners(out, f, u0, u0 + 1, top - 0.9, top, -0.1, f.width + 0.1, s)
}

/** Pier: a masonry block on the bed with a pointed cutwater on each face. */
function pier(
  out: MeshBuilder,
  f: BridgeFrame,
  u: number,
  top: number,
  s: Parameters<typeof aabb>[3],
): void {
  const bottom = f.bed - 0.3
  const half = PIER.along / 2
  corners(out, f, u - half, u + half, bottom, top, -PIER.overhang, f.width + PIER.overhang, s)
  // Cutwaters: square blocks turned 45 degrees, half sticking out of each face.
  const h = (top - 0.12 - bottom) / 2
  const diag: [Vec3, Vec3, Vec3] = [
    normalize(add(f.along, f.across)),
    [0, 1, 0],
    normalize(add(f.along, scale(f.across, -1))),
  ]
  for (const v of [-PIER.overhang, f.width + PIER.overhang]) {
    box(out, f.at(u, bottom + h, v), diag, [half * 0.7, h, half * 0.7], s)
  }
}
