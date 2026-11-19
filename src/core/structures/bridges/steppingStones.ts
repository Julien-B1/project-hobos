/**
 * Stepping stones: flat stones across shallow water, one per cell.
 *
 * Layer: core (pure TypeScript). Gameplay: a stone voxel (STONE_BRICK, so
 * the terrain mesher leaves it alone) at the water surface in every
 * flooded cell between the banks: walking level = water surface. Look
 * (`render/structures/steppingStonesMesher.ts`): rough flat stones,
 * slightly turned and offset, standing on the bed.
 */
import type { VoxelCoord } from '../../coords'
import { Material } from '../../materials'
import { packVoxel } from '../../voxel'
import { defineKind } from '../structure'
import { isBridgeSpan, isOpen, spanBox, spanLength, spanVoxel, type BridgeSpan } from './bridgeSpan'

/** Kind id. */
export const STEPPING_STONES = 'stepping-stones'

/** The stepping stones kind. */
export const steppingStones = defineKind<BridgeSpan>({
  id: STEPPING_STONES,
  isParams: isBridgeSpan,
  bounds: (span) => spanBox(span, span.bedLevel - 1, span.deckY + 1),
  stamp: (span, map) => {
    const owned: VoxelCoord[] = []
    // Bank end cells are ground: stones only in between.
    for (let along = 1; along < spanLength(span) - 1; along++) {
      for (let across = 0; across < span.width; across++) {
        const v = spanVoxel(span, along, across, span.waterLevel - 1)
        if (!isOpen(map, v)) continue
        map.set(v.x, v.y, v.z, packVoxel(Material.STONE_BRICK))
        owned.push(v)
      }
    }
    return owned
  },
})
