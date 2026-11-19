/**
 * Choosing a kind of crossing for a river site.
 *
 * Layer: core (pure TypeScript). Each kind states the sites it suits (river
 * width, depth, span length, height above the water): the width filters
 * first, then the seed picks among the fitting kinds, so a generated map
 * gets a believable and varied crossing.
 */
import { VOXEL_HEIGHT } from '../../coords'
import { hash01 } from '../../noise'
import { spanLength } from './bridgeSpan'
import { FALLEN_LOG } from './fallenLog'
import { FORD } from './ford'
import type { CrossingSite } from './riverCrossing'
import { ROPE_BRIDGE } from './ropeBridge'
import { SLAB_BRIDGE } from './slabBridge'
import { STEPPING_STONES } from './steppingStones'
import { STONE_ARCH_BRIDGE } from './stoneArchBridge'
import { WOOD_BEAM_BRIDGE } from './woodBeamBridge'

/** What a kind of crossing needs from its site. */
export interface CrossingRule {
  readonly kind: string
  /** Width of the crossing across its span, in cells. */
  readonly width: number
  /** Whether the site suits the kind. */
  readonly fits: (site: CrossingSite) => boolean
}

/** Height of the deck above the water, world units. */
function clearance(site: CrossingSite): number {
  return (site.span.deckY + 1 - site.span.waterLevel) * VOXEL_HEIGHT
}

/** Rules of the built-in crossing kinds. */
export const CROSSING_RULES: readonly CrossingRule[] = [
  { kind: FALLEN_LOG, width: 1, fits: (s) => s.waterWidth <= 4 && spanLength(s.span) <= 8 },
  { kind: STEPPING_STONES, width: 1, fits: (s) => s.waterWidth <= 6 && s.depth <= 2 },
  { kind: FORD, width: 3, fits: (s) => s.waterWidth <= 7 && s.depth <= 3 },
  // Trestle bents carry any length: the crossing that always fits.
  { kind: WOOD_BEAM_BRIDGE, width: 2, fits: () => true },
  { kind: SLAB_BRIDGE, width: 2, fits: (s) => spanLength(s.span) <= 12 && s.depth <= 4 },
  { kind: STONE_ARCH_BRIDGE, width: 3, fits: (s) => s.waterWidth >= 3 && spanLength(s.span) <= 16 },
  { kind: ROPE_BRIDGE, width: 1, fits: (s) => spanLength(s.span) >= 5 && clearance(s) >= 1 },
]

/**
 * Kinds fitting `site`, by priority of width (narrow rivers first get the
 * light crossings): every rule whose `fits` accepts the site.
 */
export function crossingCandidates(site: CrossingSite): CrossingRule[] {
  return CROSSING_RULES.filter((rule) => rule.fits(site))
}

/** Pick one fitting kind for `site` with `seed` (deterministic), or null. */
export function pickCrossing(site: CrossingSite, seed: number): CrossingRule | null {
  const candidates = crossingCandidates(site)
  if (candidates.length === 0) return null
  const i = Math.floor(hash01(site.span.from, site.span.side, seed) * candidates.length)
  return candidates[Math.min(i, candidates.length - 1)] ?? null
}
