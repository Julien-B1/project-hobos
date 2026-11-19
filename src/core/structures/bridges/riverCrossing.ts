/**
 * Measuring where a crossing over water can go.
 *
 * Layer: core (pure TypeScript). Generic: works on any map with a water
 * surface, by reading the voxels. Generators choose rows to try; this
 * finds the dry banks on both sides of the water and measures the river
 * between them (see `crossings.ts` for the choice of a kind).
 */
import { Material } from '../../materials'
import { isAir, materialOf } from '../../voxel'
import type { VoxelMap } from '../../voxelMap'
import type { BridgeSpan } from './bridgeSpan'

/** A measured crossing site: its span and the river it spans. */
export interface CrossingSite {
  readonly span: BridgeSpan
  /** Number of flooded cells along the span. */
  readonly waterWidth: number
  /** Water depth: levels from the lowest bed under the span to the surface. */
  readonly depth: number
  /**
   * Whether the deck meets both banks at its level (false: the fallback, a
   * shore flat at water level where the deck steps down at its ends).
   */
  readonly flush: boolean
}

/** Crest height above the water (levels) from which steep banks make a canyon. */
const CANYON_DEPTH = 5
/** Smallest mean climb of a canyon bank, levels per cell, from the water to its crest. */
const CANYON_SLOPE = 0.75

/**
 * Deck level of a canyon crossing, or null when the river does not run in
 * a canyon: on each side, the bank climbs from the water to a crest (where
 * it stops rising for two cells); when both crests stand at least
 * {@link CANYON_DEPTH} above the water and were reached by a mean climb of
 * {@link CANYON_SLOPE} or more, the deck goes at the lower crest.
 */
function canyonDeck(
  centre: number,
  limit: number,
  wet: (along: number) => boolean,
  ground: (along: number) => number,
  waterLevel: number,
): number | null {
  const crest = (step: number): number | null => {
    let a = centre
    while (a >= 0 && a < limit && wet(a)) a += step
    if (a < 0 || a >= limit) return null
    const foot = a
    // Climb while the ground rises within the next two cells (a one-cell
    // landing, such as a sand strip by the water, does not stop it).
    const inside = (k: number): boolean => k >= 0 && k < limit
    for (;;) {
      const next = [a + step, a + 2 * step].filter(inside)
      const higher = next.find((k) => ground(k) > ground(a))
      if (higher === undefined) break
      a = higher
    }
    const rise = ground(a) - waterLevel
    const run = Math.abs(a - foot) + 1
    return rise >= CANYON_DEPTH && rise / run >= CANYON_SLOPE ? ground(a) : null
  }
  const a = crest(-1)
  const b = crest(1)
  return a === null || b === null ? null : Math.min(a, b)
}

/** Highest deck tried above the water, in levels. */
const MAX_DECK_RISE = 16

/** Highest scanned level for ground tops. */
const SCAN_TOP = 64

/** Level of the top of the ground in column (x, z): water and air skipped. */
export function groundLevel(map: VoxelMap, x: number, z: number): number {
  for (let y = SCAN_TOP; y >= 0; y--) {
    const v = map.get(x, y, z)
    if (!isAir(v) && materialOf(v) !== Material.WATER) return y + 1
  }
  return 0
}

/** Whether column (x, z) holds water just under the surface level. */
function flooded(map: VoxelMap, x: number, z: number, waterLevel: number): boolean {
  return materialOf(map.get(x, waterLevel - 1, z)) === Material.WATER
}

/**
 * Measure a crossing along `axis` through the band of `width` rows starting
 * at `side`, through the flooded cell at `centre` (along the axis).
 *
 * The deck level is chosen so that both ends meet the ground. In a canyon
 * (see `canyonDeck`) it is the lower crest: the bridge spans the valley
 * from plateau to plateau. Otherwise, for each level from `bankRise` above
 * the water up, the ends are the first dry cells outwards (across the
 * whole band) reaching that level, accepted when their ground is no more
 * than one level above it (flush); the level with the shortest span wins. Without any, the first dry cells on both
 * sides are the ends and the deck is flush with the lower one, at least a
 * level above the water. Null when `centre` is dry or no bank is found
 * within `limit` (along the axis, exclusive).
 */
export function measureCrossing(
  map: VoxelMap,
  axis: 'x' | 'z',
  side: number,
  width: number,
  centre: number,
  waterLevel: number,
  limit: number,
  bankRise = 1,
): CrossingSite | null {
  const at = (along: number, across: number): [number, number] =>
    axis === 'x' ? [along, side + across] : [side + across, along]
  const rows = Array.from({ length: width }, (_, k) => k)
  const ground = (along: number): number =>
    Math.min(...rows.map((k) => groundLevel(map, ...at(along, k))))
  const wet = (along: number): boolean =>
    rows.some((k) => flooded(map, ...at(along, k), waterLevel))
  if (!wet(centre)) return null
  const highest = (along: number): number =>
    Math.max(...rows.map((k) => groundLevel(map, ...at(along, k))))

  // Deck level: the one that finds, on both sides, ground flush with it
  // (at that level or one above) with the shortest span. Banks of
  // different heights then get a deck that meets both: the span reaches
  // further out on the low side, up its slope, instead of running into the
  // high bank.
  let best: { from: number; to: number; deck: number } | null = null
  const end = (start: number, step: number, deck: number): number | null => {
    let a = start
    while (a >= 0 && a < limit && (wet(a) || ground(a) < deck)) a += step
    if (a < 0 || a >= limit || highest(a) > deck + 1) return null
    return a
  }
  // A canyon (both banks climbing steeply to a high crest): the deck stays
  // at the plateau, the lower crest, and the bridge spans the whole valley.
  const canyon = canyonDeck(centre, limit, wet, ground, waterLevel)
  if (canyon !== null) {
    const from = end(centre, -1, canyon)
    const to = end(centre, 1, canyon)
    if (from !== null && to !== null) best = { from, to, deck: canyon }
  }
  // Otherwise: the level meeting both banks flush with the shortest span.
  for (let deck = waterLevel + bankRise; !canyon && deck <= waterLevel + MAX_DECK_RISE; deck++) {
    const from = end(centre, -1, deck)
    const to = end(centre, 1, deck)
    if (from === null || to === null) continue
    // Shortest span, ends preferably exactly at the deck's level (a bank a
    // level higher half buries the deck's end).
    const score = (k: { from: number; to: number; deck: number }): number =>
      k.to - k.from + 2 * (highest(k.from) - k.deck + highest(k.to) - k.deck)
    const candidate = { from, to, deck }
    if (!best || score(candidate) < score(best)) best = candidate
  }
  // Fallback: the first dry cells on both sides, deck flush with the lower
  // one but at least a level above the water.
  const flush = best !== null
  if (!best) {
    const dry = (along: number): boolean => !wet(along) && ground(along) >= waterLevel
    let a = centre
    while (a > 0 && !dry(a)) a--
    let b = centre
    while (b < limit - 1 && !dry(b)) b++
    if (!dry(a) || !dry(b)) return null
    best = { from: a, to: b, deck: Math.max(Math.min(ground(a), ground(b)), waterLevel + 1) }
  }
  // An end whose bank stands a level above the deck: stop the deck against
  // the bank (a half step up) rather than half bury its last planks.
  let { from, to } = best
  if (highest(from) > best.deck && from + 1 < centre) from++
  if (highest(to) > best.deck && to - 1 > centre) to--

  let waterWidth = 0
  let bed = Infinity
  for (let along = from; along <= to; along++) {
    if (wet(along)) waterWidth++
    bed = Math.min(bed, ground(along))
  }
  const deckLevel = best.deck
  return {
    span: {
      axis,
      from,
      to,
      side,
      width,
      deckY: deckLevel - 1,
      bedLevel: bed,
      waterLevel,
    },
    waterWidth,
    depth: waterLevel - bed,
    flush,
  }
}
