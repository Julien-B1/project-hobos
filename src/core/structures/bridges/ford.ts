/**
 * Ford: a shallow, gravelled stretch of river bed to wade across.
 *
 * Layer: core (pure TypeScript). Gameplay: the bed under the span is raised
 * with gravel (PATH, a terrain material: the terrain mesher draws it) to
 * one level under the water surface, so the ford is walkable through half
 * a level of water; the gravel spreads one cell further on each side, under
 * the boulders marking the edges. It owns no voxel. Look
 * (`render/structures/fordMesher.ts`): boulders lining both sides of the
 * crossing and a marker post at each corner on the banks.
 */
import { Material } from '../../materials'
import { packVoxel } from '../../voxel'
import { defineKind } from '../structure'
import { isBridgeSpan, isOpen, spanBox, spanLength, spanVoxel, type BridgeSpan } from './bridgeSpan'

/** Kind id. */
export const FORD = 'ford'

/** The ford kind. */
export const ford = defineKind<BridgeSpan>({
  id: FORD,
  isParams: isBridgeSpan,
  // One more cell of gravel on each side carries the marker boulders.
  bounds: (span) =>
    spanBox(
      { ...span, side: span.side - 1, width: span.width + 2 },
      span.bedLevel - 1,
      span.deckY + 3,
    ),
  stamp: (span, map) => {
    const gravel = packVoxel(Material.PATH)
    const top = span.waterLevel - 2 // gravel top voxel: walking level = water - 1
    for (let along = 0; along < spanLength(span); along++) {
      for (let across = -1; across <= span.width; across++) {
        for (let y = span.bedLevel - 1; y <= top; y++) {
          const v = spanVoxel(span, along, across, y)
          if (isOpen(map, v)) map.set(v.x, v.y, v.z, gravel)
        }
      }
    }
    return []
  },
})
