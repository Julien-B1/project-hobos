/**
 * Slab bridge: thick stone slabs laid on masonry piers (a clapper bridge).
 *
 * Layer: core (pure TypeScript). Gameplay: a stone deck (STONE_BRICK) flush
 * with the banks over the open cells of the span. Look
 * (`render/structures/slabBridgeMesher.ts`): abutments in the banks,
 * piers with cutwaters on both faces, one slab per bay.
 */
import { Material } from '../../materials'
import { defineKind } from '../structure'
import { isBridgeSpan, spanBox, stampDeck, type BridgeSpan } from './bridgeSpan'

/** Kind id. */
export const SLAB_BRIDGE = 'slab-bridge'

/** The slab bridge kind. */
export const slabBridge = defineKind<BridgeSpan>({
  id: SLAB_BRIDGE,
  isParams: isBridgeSpan,
  bounds: (span) => spanBox(span, span.bedLevel - 1, span.deckY + 1),
  stamp: (span, map) => stampDeck(span, map, Material.STONE_BRICK),
})
