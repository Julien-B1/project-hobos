/**
 * Mesher of the rope bridge (`ropeBridge` kind).
 *
 * Layer: render (no Three.js import). Built like a real plank rope bridge:
 * - a pair of anchor posts on each bank, each held back by a guy rope to a
 *   stake;
 * - two foot ropes hanging from post to post with the core's sag
 *   (`ropeDeckHeight`, also the walkable voxels), carrying the planks;
 * - two hand ropes from the post tops, sagging less;
 * - thin suspenders tying hand ropes to foot ropes.
 */
import { isBridgeSpan } from '@/core/structures/bridges/bridgeSpan'
import { ROPE_BRIDGE, ropeDeckHeight, ropeSag } from '@/core/structures/bridges/ropeBridge'
import { beam, hash3, tube, type Vec3 } from '../geometry/primitives'
import { rope, wood } from './surfaces'
import { bridgeFrame } from './bridgeFrame'
import { defineMesher } from './structureMesher'

const POST = { radius: 0.08, height: 1.25, inset: 0.35 }
const PLANK = { width: 0.18, thickness: 0.06, step: 0.27 }
const ROPE_RADIUS = 0.035
const HAND_HEIGHT = 0.85
const SEGMENTS = 18
const PLANK_TONES = [0x8a6440, 0x7a5636, 0x93704a]

/** The rope bridge mesher. */
export const ropeBridgeMesher = defineMesher(ROPE_BRIDGE, isBridgeSpan, (span, out) => {
  const f = bridgeFrame(span)
  const deck = (u: number): number => ropeDeckHeight(span, u)
  const sag = ropeSag(span)
  const ends = [POST.inset, f.length - POST.inset]
  const sides = [-0.1, f.width + 0.1]
  const fibre = rope(0xb39a6b)
  const timber = wood(0x6a4a2c)
  const postTop = f.deckTop + POST.height

  // Posts and guy ropes to stakes behind them.
  for (const u of ends) {
    const outward = u < f.length / 2 ? -1 : 1
    for (const v of sides) {
      tube(
        out,
        [f.at(u, f.deckTop - 0.4, v), f.at(u, postTop, v)],
        [POST.radius, POST.radius * 0.85],
        7,
        timber,
      )
      const stake = f.at(u + outward * 0.9, f.deckTop, v)
      tube(out, [f.at(u, postTop - 0.08, v), stake], ROPE_RADIUS, 5, fibre)
      beam(
        out,
        [stake[0], stake[1] - 0.7, stake[2]],
        [stake[0], stake[1] + 0.12, stake[2]],
        0.07,
        0.07,
        timber,
        f.along,
      )
    }
  }

  // Foot ropes under the planks, hand ropes above.
  const [start = 0, end = f.length] = ends
  const foot = (v: number): Vec3[] =>
    Array.from({ length: SEGMENTS + 1 }, (_, i) => {
      const u = start + ((end - start) * i) / SEGMENTS
      return f.at(u, deck(u) - PLANK.thickness - ROPE_RADIUS, v)
    })
  const hand = (v: number): Vec3[] =>
    Array.from({ length: SEGMENTS + 1 }, (_, i) => {
      const t = i / SEGMENTS
      const u = start + (end - start) * t
      // Hand ropes sag a third as much as the deck.
      const y = postTop - 0.15 - (sag / 3) * 4 * t * (1 - t)
      return f.at(u, Math.max(y, deck(u) + HAND_HEIGHT * 0.8), v)
    })
  const footSides = [0.12, f.width - 0.12]
  for (const v of footSides) tube(out, foot(v), ROPE_RADIUS, 5, fibre)
  for (const v of sides) tube(out, hand(v), ROPE_RADIUS, 5, fibre)

  // Planks across the foot ropes.
  for (let u = start + 0.2; u <= end - 0.2; u += PLANK.step) {
    const r = (k: number): number => hash3(span.from + u, span.side, 41 + k)
    const tone = PLANK_TONES[Math.floor(r(1) * PLANK_TONES.length)] ?? 0x8a6440
    const y = deck(u) - PLANK.thickness / 2
    const skew = (r(2) - 0.5) * 0.05
    beam(
      out,
      f.at(u - skew, y, -0.02),
      f.at(u + skew, y, f.width + 0.02),
      PLANK.width,
      PLANK.thickness,
      wood(tone, 0.9 + r(3) * 0.2),
    )
  }

  // Suspenders: hand rope to foot rope, every few planks.
  const handLeft = hand(sides[0] ?? 0)
  const handRight = hand(sides[1] ?? 0)
  const footLeft = foot(footSides[0] ?? 0)
  const footRight = foot(footSides[1] ?? 0)
  for (let i = 2; i < SEGMENTS - 1; i += 2) {
    for (const [h, fo] of [
      [handLeft[i], footLeft[i]],
      [handRight[i], footRight[i]],
    ] as const) {
      if (h && fo) tube(out, [h, fo], ROPE_RADIUS * 0.5, 4, fibre)
    }
  }
})
