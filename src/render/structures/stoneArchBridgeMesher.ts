/**
 * Mesher of the stone arch bridge (`stoneArchBridge` kind).
 *
 * Layer: render (no Three.js import). A humpbacked masonry bridge:
 * - one segmental arch of voussoirs springing just above the water;
 * - spandrel fill and abutments up to the deck, whose paved top follows the
 *   core's deck profile exactly (`humpProfile`: the walkable voxels);
 * - parapets on both edges with a coping.
 * The masonry is built from closed slices and wedges (`hexahedron`).
 */
import { VOXEL_HEIGHT } from '@/core/coords'
import { isBridgeSpan } from '@/core/structures/bridges/bridgeSpan'
import { STONE_ARCH_BRIDGE, humpProfile } from '@/core/structures/bridges/stoneArchBridge'
import { hexahedron, type Vec3 } from '../geometry/primitives'
import { masonry, stone } from './surfaces'
import { bridgeFrame } from './bridgeFrame'
import { defineMesher } from './structureMesher'

/** Arch ring thickness and masonry above the crown, world units. */
const RING = 0.36
const CROWN = 0.62
/** Parapet height above the deck, thickness, and coping. */
const PARAPET = { height: 0.45, thickness: 0.2, coping: 0.08, overhang: 0.04 }
/** Target voussoir length along the intrados, world units. */
const VOUSSOIR = 0.42
/** Step of the fill slices along the span, world units. */
const SLICE = 0.25

/** The stone arch bridge mesher. */
export const stoneArchBridgeMesher = defineMesher(STONE_ARCH_BRIDGE, isBridgeSpan, (span, out) => {
  const f = bridgeFrame(span)
  const profile = humpProfile(span)
  const deckAt = (u: number): number => {
    const k = Math.min(profile.length - 2, Math.max(0, Math.floor(u)))
    const a = profile[k] ?? 0
    const b = profile[k + 1] ?? 0
    return f.deckTop + (a + (b - a) * (u - k)) * VOXEL_HEIGHT
  }
  const peak = Math.max(...profile) * VOXEL_HEIGHT + f.deckTop

  // Arch geometry: springing points near the banks, crown under the deck.
  const u0 = Math.min(2, f.length * 0.2)
  const u1 = f.length - u0
  const spring = f.water - 0.15
  const crown = Math.max(spring + 0.4, peak - CROWN)
  const c = (u1 - u0) / 2
  const rise = crown - spring
  const R = (c * c + rise * rise) / (2 * rise)
  const uc = (u0 + u1) / 2
  const yc = crown - R
  const extrados = (u: number): number =>
    yc + Math.sqrt(Math.max(0, (R + RING) ** 2 - (u - uc) ** 2))

  // Voussoirs, from one springing to the other.
  const a0 = Math.atan2(spring - yc, u1 - uc)
  const a1 = Math.PI - a0
  const count = Math.max(5, Math.round(((a1 - a0) * R) / VOUSSOIR) | 1)
  const ring = masonry(0x857d70)
  const point = (angle: number, radius: number, v: number): Vec3 =>
    f.at(uc + Math.cos(angle) * radius, yc + Math.sin(angle) * radius, v)
  for (let i = 0; i < count; i++) {
    const gap = 0.004
    const s0 = a0 + ((a1 - a0) * i) / count + gap
    const s1 = a0 + ((a1 - a0) * (i + 1)) / count - gap
    const v0 = -0.05
    const v1 = f.width + 0.05
    hexahedron(
      out,
      [
        point(s0, R, v0),
        point(s1, R, v0),
        point(s1, R + RING, v0),
        point(s0, R + RING, v0),
        point(s0, R, v1),
        point(s1, R, v1),
        point(s1, R + RING, v1),
        point(s0, R + RING, v1),
      ],
      ring,
    )
  }

  // Fill: vertical slices from the extrados (or the bed beyond the arch)
  // up to the deck profile, over the full width.
  const fill = masonry(0x9a9184)
  const cuts = new Set<number>([0, f.length, u0, u1])
  for (let u = 0; u < f.length; u += SLICE) cuts.add(Math.round(u * 1000) / 1000)
  for (let k = 0; k <= f.length; k++) cuts.add(k)
  const us = [...cuts].sort((p, q) => p - q)
  const bottomAt = (u: number, inside: boolean): number =>
    inside ? extrados(u) - 0.03 : f.bed - 0.4
  for (let i = 0; i + 1 < us.length; i++) {
    const ua = us[i] ?? 0
    const ub = us[i + 1] ?? 0
    if (ub - ua < 1e-6) continue
    const inside = ua >= u0 - 1e-6 && ub <= u1 + 1e-6
    const ba = bottomAt(ua, inside)
    const bb = bottomAt(ub, inside)
    hexahedron(
      out,
      [
        f.at(ua, ba, 0),
        f.at(ub, bb, 0),
        f.at(ub, bb, f.width),
        f.at(ua, ba, f.width),
        f.at(ua, deckAt(ua), 0),
        f.at(ub, deckAt(ub), 0),
        f.at(ub, deckAt(ub), f.width),
        f.at(ua, deckAt(ua), f.width),
      ],
      fill,
    )
  }

  // Parapets and coping along both edges, one piece per deck segment.
  const wall = masonry(0x948b7e)
  const cap = stone(0xa8a197)
  for (let k = 0; k < f.length; k++) {
    const ya = deckAt(k)
    const yb = deckAt(k + 1)
    for (const [v0, v1] of [
      [0, PARAPET.thickness],
      [f.width - PARAPET.thickness, f.width],
    ] as const) {
      const slab = (
        y0a: number,
        y0b: number,
        y1a: number,
        y1b: number,
        w0: number,
        w1: number,
        s: typeof wall,
      ): void => {
        hexahedron(
          out,
          [
            f.at(k, y0a, w0),
            f.at(k + 1, y0b, w0),
            f.at(k + 1, y0b, w1),
            f.at(k, y0a, w1),
            f.at(k, y1a, w0),
            f.at(k + 1, y1b, w0),
            f.at(k + 1, y1b, w1),
            f.at(k, y1a, w1),
          ],
          s,
        )
      }
      slab(ya - 0.05, yb - 0.05, ya + PARAPET.height, yb + PARAPET.height, v0, v1, wall)
      slab(
        ya + PARAPET.height,
        yb + PARAPET.height,
        ya + PARAPET.height + PARAPET.coping,
        yb + PARAPET.height + PARAPET.coping,
        v0 - PARAPET.overhang,
        v1 + PARAPET.overhang,
        cap,
      )
    }
  }
})
