/**
 * Mesher of the simple wooden bridge (`woodBeamBridge` kind).
 *
 * Layer: render (no Three.js import). Built like a real beam bridge:
 * - sill beams bedded in each bank, under the stringers (the deck is flush
 *   with the banks: no step, no ramp);
 * - trestle bents in the river, at most {@link MAX_BENT_SPACING} apart: two
 *   posts driven into the bed, a cap beam, X bracing;
 * - three stringers running the length of the span;
 * - transverse deck planks with small gaps, each slightly different;
 * - railings: posts on both edges and a handrail plus a mid rail.
 * Every piece is a closed box (see `primitives.ts`).
 */
import { isBridgeSpan } from '@/core/structures/bridges/bridgeSpan'
import { WOOD_BEAM_BRIDGE } from '@/core/structures/bridges/woodBeamBridge'
import { BlockLook } from '../meshing/mesher'
import { srgbHexToLinear, type MeshBuilder, type Vec3 } from '../meshing/meshBuilder'
import { beam, hash3, type Surface } from '../geometry/primitives'
import { bridgeFrame, type BridgeFrame } from './bridgeFrame'
import { defineMesher } from './structureMesher'

/** Largest distance between two supports (bank sill or bent), world units. */
const MAX_BENT_SPACING = 3.5
/** Plank thickness, width and gap; stringer and post sections (world units). */
const PLANK = { thickness: 0.07, width: 0.2, gap: 0.04 }
const STRINGER = { width: 0.12, height: 0.16 }
const POST = 0.15
/** Sills reach well into the bank (a low shore may sit a level under the deck). */
const SILL = { width: 0.22, height: 0.6 }
const CAP = { width: 0.17, height: 0.15 }
const BRACE = { width: 0.07, height: 0.1 }
/** Railing: height above the deck, post spacing and sections. */
const RAILING = { height: 0.62, spacing: 1, post: 0.09, rail: 0.07 }

/** Wood tones (sRGB): dark structure, lighter weathered planks. */
const TIMBER = 0x5e4126
const PLANK_TONES = [0x8a6440, 0x7d5a39, 0x957048, 0x846040]

/** Wood surface of a given sRGB tone. */
function wood(hex: number, k = 1): Surface {
  const c = srgbHexToLinear(hex)
  return { color: [c[0] * k, c[1] * k, c[2] * k], look: BlockLook.WOOD }
}

/** The wooden beam bridge mesher. */
export const woodBeamBridgeMesher = defineMesher(WOOD_BEAM_BRIDGE, isBridgeSpan, (span, out) => {
  const f = bridgeFrame(span)
  const plankBottom = f.deckTop - PLANK.thickness
  const stringerBottom = plankBottom - STRINGER.height
  const timber = wood(TIMBER)

  planks(out, f, plankBottom)
  stringers(out, f, plankBottom, timber)
  // Sills bedded in each bank, under the stringers' ends (the deck is
  // flush with the ground there).
  for (const u of [0.5, f.length - 0.5]) {
    const y = stringerBottom - SILL.height / 2
    beam(out, f.at(u, y, -0.1), f.at(u, y, f.width + 0.1), SILL.width, SILL.height, timber)
  }
  for (const u of bentPositions(f.length)) bent(out, f, u, stringerBottom, timber)
  railings(out, f, stringerBottom, timber)
})

/** Transverse deck planks, with small irregularities. */
function planks(out: MeshBuilder, f: BridgeFrame, bottom: number): void {
  const step = PLANK.width + PLANK.gap
  const count = Math.floor((f.length - PLANK.gap) / step)
  const start = (f.length - count * step + PLANK.gap) / 2
  for (let i = 0; i < count; i++) {
    const r = (k: number): number => hash3(f.at(i, 0, k)[0], f.at(i, 0, k)[2], 17)
    const u = start + i * step + PLANK.width / 2
    const lift = (r(1) - 0.5) * 0.012
    const skew = (r(2) - 0.5) * 0.04
    const y = bottom + PLANK.thickness / 2 + lift
    const tone = PLANK_TONES[Math.floor(r(3) * PLANK_TONES.length)] ?? PLANK_TONES[0] ?? TIMBER
    beam(
      out,
      f.at(u - skew, y, -0.04 - r(4) * 0.06),
      f.at(u + skew, y, f.width + 0.04 + r(5) * 0.06),
      PLANK.width,
      PLANK.thickness,
      wood(tone, 0.92 + r(6) * 0.16),
    )
  }
}

/** Stringers along the span, under the planks. */
function stringers(out: MeshBuilder, f: BridgeFrame, plankBottom: number, s: Surface): void {
  const y = plankBottom - STRINGER.height / 2
  for (const v of [0.22, f.width / 2, f.width - 0.22]) {
    beam(out, f.at(0.08, y, v), f.at(f.length - 0.08, y, v), STRINGER.width, STRINGER.height, s)
  }
}

/** Positions (u) of the river bents: evenly spaced, none closer than needed. */
export function bentPositions(length: number): number[] {
  // Supports at the bank sills (0.5 and length - 0.5); bents in between.
  const free = length - 1
  const bays = Math.max(1, Math.ceil(free / MAX_BENT_SPACING))
  const out: number[] = []
  for (let i = 1; i < bays; i++) out.push(0.5 + (free * i) / bays)
  return out
}

/** One trestle bent: two posts, a cap beam and X bracing. */
function bent(out: MeshBuilder, f: BridgeFrame, u: number, top: number, s: Surface): void {
  const capY = top - CAP.height / 2
  const foot = f.bed - 0.3 // driven into the bed
  beam(out, f.at(u, capY, -0.12), f.at(u, capY, f.width + 0.12), CAP.width, CAP.height, s)
  const posts = [0.3, f.width - 0.3]
  for (const v of posts) {
    beam(out, f.at(u, foot, v), f.at(u, top - CAP.height, v), POST, POST, s, alongAxis(f))
  }
  // X bracing on the downstream face, from above the water to under the cap.
  const low = Math.max(f.water + 0.05, foot + 0.2)
  const high = top - CAP.height - 0.08
  if (high - low > 0.25) {
    const du = POST / 2 + BRACE.width / 2
    const [v0, v1] = posts as [number, number]
    beam(
      out,
      f.at(u + du, low, v0),
      f.at(u + du, high, v1),
      BRACE.width,
      BRACE.height,
      s,
      alongAxis(f),
    )
    beam(
      out,
      f.at(u - du, high, v0),
      f.at(u - du, low, v1),
      BRACE.width,
      BRACE.height,
      s,
      alongAxis(f),
    )
  }
}

/** Up vector for vertical posts and braces: the span direction keeps them square to it. */
function alongAxis(f: BridgeFrame): Vec3 {
  return f.along
}

/** Railings on both edges: posts, handrail and mid rail. */
function railings(out: MeshBuilder, f: BridgeFrame, postFoot: number, s: Surface): void {
  const top = f.deckTop + RAILING.height
  const count = Math.max(2, Math.round((f.length - 0.4) / RAILING.spacing) + 1)
  for (const v of [-0.02, f.width + 0.02]) {
    for (let i = 0; i < count; i++) {
      const u = 0.2 + ((f.length - 0.4) * i) / (count - 1)
      beam(out, f.at(u, postFoot, v), f.at(u, top, v), RAILING.post, RAILING.post, s, f.along)
    }
    const rail = (y: number): void => {
      beam(out, f.at(0.12, y, v), f.at(f.length - 0.12, y, v), RAILING.rail, RAILING.rail, s)
    }
    rail(top - RAILING.rail / 2)
    rail(f.deckTop + RAILING.height * 0.48)
  }
}
