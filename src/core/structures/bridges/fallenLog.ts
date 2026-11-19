/**
 * Fallen log: a tree trunk lying across a narrow stream.
 *
 * Layer: core (pure TypeScript). Gameplay: a one-cell-wide walk on top of
 * the log, one level above the banks (WOOD voxels at `deckY + 1`). Look
 * (`render/structures/fallenLogMesher.ts`): a tapered bark-covered trunk
 * resting on both banks, an adzed walking face, a root plate and branch
 * stubs.
 */
import type { VoxelCoord } from '../../coords'
import { Material } from '../../materials'
import { packVoxel } from '../../voxel'
import { defineKind } from '../structure'
import { isBridgeSpan, isOpen, spanBox, spanLength, spanVoxel, type BridgeSpan } from './bridgeSpan'

/** Kind id. */
export const FALLEN_LOG = 'fallen-log'

/** The fallen log kind. */
export const fallenLog = defineKind<BridgeSpan>({
  id: FALLEN_LOG,
  isParams: isBridgeSpan,
  // The root plate stands up to 3 levels above the banks.
  bounds: (span) => spanBox(span, span.bedLevel - 1, span.deckY + 4),
  stamp: (span, map) => {
    const owned: VoxelCoord[] = []
    for (let along = 0; along < spanLength(span); along++) {
      for (let across = 0; across < span.width; across++) {
        const v = spanVoxel(span, along, across, span.deckY + 1)
        if (!isOpen(map, v)) continue
        map.set(v.x, v.y, v.z, packVoxel(Material.WOOD))
        owned.push(v)
      }
    }
    return owned
  },
})
