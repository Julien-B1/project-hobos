/**
 * Mesher of the ford (`ford` kind).
 *
 * Layer: render (no Three.js import). The raised gravel bed is terrain;
 * this draws what marks the crossing: boulders resting on the gravel along
 * both its edges, and a marker post at each corner on the banks.
 */
import { isBridgeSpan } from '@/core/structures/bridges/bridgeSpan'
import { FORD } from '@/core/structures/bridges/ford'
import { beam, boulder, hash3 } from '../geometry/primitives'
import { stone, wood } from './surfaces'
import { bridgeFrame } from './bridgeFrame'
import { defineMesher } from './structureMesher'

/** The ford mesher. */
export const fordMesher = defineMesher(FORD, isBridgeSpan, (span, out) => {
  const f = bridgeFrame(span)
  // Boulders along both edges of the gravel band, resting on it (the
  // gravel top is one level under the water surface).
  for (const [side, v] of [
    [0, 0.18],
    [1, f.width - 0.18],
  ] as const) {
    for (let u = 1.4; u < f.length - 1.3; u += 1.1) {
      const seed = Math.round((span.from + u) * 37) * 7 + side + span.side * 3
      const r = (k: number): number => hash3(seed, k, 23)
      // Rounded boulders bedded in the gravel, just breaking the surface.
      const radius = 0.24 + r(4) * 0.1
      const flatten = 0.65
      boulder(
        out,
        f.at(
          u + (r(1) - 0.5) * 0.3,
          f.water + 0.06 - radius * flatten + r(2) * 0.06,
          v + (r(3) - 0.5) * 0.15,
        ),
        radius,
        flatten,
        seed,
        stone(0x837f78, 0.9 + r(5) * 0.2),
      )
    }
  }
  // Marker posts on the banks, one at each corner of the crossing.
  const post = wood(0x6a4a2c)
  for (const u of [0.5, f.length - 0.5]) {
    for (const v of [-0.25, f.width + 0.25]) {
      beam(
        out,
        f.at(u, f.deckTop - 0.3, v),
        f.at(u, f.deckTop + 0.85, v),
        0.12,
        0.12,
        post,
        f.along,
      )
      beam(
        out,
        f.at(u, f.deckTop + 0.85, v),
        f.at(u, f.deckTop + 0.93, v),
        0.16,
        0.16,
        post,
        f.along,
      )
    }
  }
})
