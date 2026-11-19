/**
 * Simple wooden bridge (beam bridge on timber trestles).
 *
 * Layer: core (pure TypeScript). Gameplay: a walkable deck of WOOD voxels
 * over the whole span at `deckY`. Look (render side,
 * `render/structures/woodBeamBridgeMesher.ts`): plank deck on stringers,
 * trestle bents standing in the river, railings.
 */
import { Material } from '../../materials'
import { defineKind } from '../structure'
import { isBridgeSpan, spanBox, stampDeck, type BridgeSpan } from './bridgeSpan'

/** Kind id. */
export const WOOD_BEAM_BRIDGE = 'wood-beam-bridge'

/** Levels above the deck the railings reach (bounds). */
const RAILING_LEVELS = 2

/** The wooden beam bridge kind. */
export const woodBeamBridge = defineKind<BridgeSpan>({
  id: WOOD_BEAM_BRIDGE,
  isParams: isBridgeSpan,
  bounds: (span) => spanBox(span, span.bedLevel - 1, span.deckY + RAILING_LEVELS),
  stamp: (span, map) => stampDeck(span, map, Material.WOOD),
})
