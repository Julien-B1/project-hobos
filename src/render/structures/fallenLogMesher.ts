/**
 * Mesher of the fallen log (`fallenLog` kind).
 *
 * Layer: render (no Three.js import). A tapered trunk lying straight across
 * the stream, resting on both banks and slightly sunk into them, its top at
 * the walking level; at the thick end the trunk flares into thick roots
 * bending down into the ground; two broken-off limbs along the trunk.
 */
import { isBridgeSpan } from '@/core/structures/bridges/bridgeSpan'
import { FALLEN_LOG } from '@/core/structures/bridges/fallenLog'
import { VOXEL_HEIGHT } from '@/core/coords'
import { add, hash3, scale, tube, type Vec3 } from '../geometry/primitives'
import { normalize } from '../meshing/meshBuilder'
import { bark } from './surfaces'
import { bridgeFrame } from './bridgeFrame'
import { defineMesher } from './structureMesher'

/** Trunk radius at the root and at the tip, world units. */
const ROOT_RADIUS = 0.32
const TIP_RADIUS = 0.24
const BARK = 0x5b4532

/** The fallen log mesher. */
export const fallenLogMesher = defineMesher(FALLEN_LOG, isBridgeSpan, (span, out) => {
  const f = bridgeFrame(span)
  // Walking level: one level above the banks, on top of the log.
  const walk = f.deckTop + VOXEL_HEIGHT
  const v = f.width / 2
  const start = -0.15
  const end = f.length + 0.25
  const radiusAt = (u: number): number =>
    ROOT_RADIUS + ((TIP_RADIUS - ROOT_RADIUS) * (u - start)) / (end - start)
  const points: Vec3[] = []
  const radii: number[] = []
  const steps = 8
  for (let i = 0; i <= steps; i++) {
    const u = start + ((end - start) * i) / steps
    const r = radiusAt(u)
    const wobble = (hash3(span.from + i, span.side, 5) - 0.5) * 0.08
    points.push(f.at(u, walk - r, v + wobble))
    radii.push(r)
  }
  const s = bark(BARK)
  tube(out, points, radii, 10, s)

  // Root flare: the trunk widens at its thick end, and thick roots spread
  // from it, bending down into the ground.
  const flareBase = f.at(start + 0.35, walk - ROOT_RADIUS, v)
  const flareEnd = f.at(start - 0.12, walk - ROOT_RADIUS - 0.04, v)
  tube(out, [flareBase, flareEnd], [ROOT_RADIUS, ROOT_RADIUS * 1.55], 10, bark(BARK, 0.92))
  const ground = f.deckTop
  // Roots fan out to both sides and dive into the soil (none rising above
  // the trunk: seen from above they would read as fingers).
  for (let k = 0; k < 8; k++) {
    const side = k % 2 === 0 ? 1 : -1
    const spread = (Math.floor(k / 2) / 3) * 1.2 - 0.6 + (hash3(span.from, k, 9) - 0.5) * 0.3
    const drop: Vec3 = [0, -0.35 - Math.abs(Math.sin(spread)) * 0.4, 0]
    const radial = normalize(
      add(add(scale(f.across, side * Math.cos(spread)), drop), scale(f.along, -0.25)),
    )
    const root = add(flareEnd, scale(radial, ROOT_RADIUS * 1.1))
    const reach = 0.3 + hash3(span.from, k, 13) * 0.2
    const midXZ = add(root, scale(radial, reach * 0.5))
    const tipXZ = add(root, scale(radial, reach))
    const tip: Vec3 = [tipXZ[0], Math.min(tipXZ[1], ground - 0.1), tipXZ[2]]
    const mid: Vec3 = [midXZ[0], Math.max(ground + 0.02, midXZ[1]), midXZ[2]]
    tube(out, [root, mid, tip], [0.11, 0.08, 0.05], 6, bark(BARK, 0.85))
  }

  // Branch stubs, sticking out sideways and up.
  for (const [t, side] of [
    [0.5, 1],
    [0.74, -1],
  ] as const) {
    const u = start + (end - start) * t
    const r = radiusAt(u)
    const centre = f.at(u, walk - r, v)
    // Mostly sideways, slightly up: broken-off limbs, not spikes.
    const dir: Vec3 = add(scale(f.across, side * 0.9), [0, 0.35, 0])
    const base = add(centre, scale(dir, r * 0.8))
    tube(
      out,
      [base, add(base, scale(dir, 0.22)), add(base, add(scale(dir, 0.32), scale(f.along, 0.06)))],
      [0.07, 0.05, 0.03],
      5,
      bark(BARK, 0.9),
    )
  }
})
