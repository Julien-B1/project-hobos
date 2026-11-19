/**
 * Mesher of the stepping stones (`steppingStones` kind).
 *
 * Layer: render (no Three.js import). One rough flat stone per cell between
 * the banks, standing on the bed, its top just above the water surface
 * (the walking level), each slightly offset, turned and sized.
 */
import { isBridgeSpan } from '@/core/structures/bridges/bridgeSpan'
import { STEPPING_STONES } from '@/core/structures/bridges/steppingStones'
import { hash3, slabStone } from '../geometry/primitives'
import { stone } from './surfaces'
import { bridgeFrame } from './bridgeFrame'
import { defineMesher } from './structureMesher'

const TONES = [0x8d8a83, 0x7f7b74, 0x96928a, 0x85827c]

/** The stepping stones mesher. */
export const steppingStonesMesher = defineMesher(STEPPING_STONES, isBridgeSpan, (span, out) => {
  const f = bridgeFrame(span)
  for (let along = 1; along < f.length - 1; along++) {
    for (let across = 0; across < f.width; across++) {
      const seed = (span.from + along) * 131 + span.side + across
      const r = (k: number): number => hash3(seed, k, 11)
      const u = along + 0.5 + (r(1) - 0.5) * 0.2
      const v = across + 0.5 + (r(2) - 0.5) * 0.24
      const tone = TONES[Math.floor(r(3) * TONES.length)] ?? 0x8d8a83
      slabStone(
        out,
        f.at(u, f.water + 0.06 + r(4) * 0.03, v),
        0.34 + r(5) * 0.08,
        f.bed - 0.15,
        seed,
        stone(tone),
      )
    }
  }
})
