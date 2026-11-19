/**
 * Stone arch bridge: a humpbacked masonry bridge on one segmental arch.
 *
 * Layer: core (pure TypeScript). Gameplay: the deck climbs one level per
 * cell from each bank up to {@link MAX_HUMP} levels, then runs flat
 * ({@link humpProfile}); rising and falling cells are SLOPE voxels, flat
 * ones FULL, all STONE_BRICK. The render side
 * (`render/structures/stoneArchBridgeMesher.ts`) draws the deck on the very
 * same profile, so surfaces and the hover cursor match the stones.
 */
import type { VoxelCoord } from '../../coords'
import { Material } from '../../materials'
import { Orientation, Shape } from '../../shapes'
import { packVoxel } from '../../voxel'
import { defineKind } from '../structure'
import { isBridgeSpan, isOpen, spanBox, spanLength, spanVoxel, type BridgeSpan } from './bridgeSpan'

/** Kind id. */
export const STONE_ARCH_BRIDGE = 'stone-arch-bridge'

/** Highest rise of the deck above the banks, in levels. */
export const MAX_HUMP = 3

/**
 * Deck profile: extra levels above the banks at each cell boundary along
 * the span (length + 1 values, 0 at both ends), rising one level per cell.
 */
export function humpProfile(span: BridgeSpan): number[] {
  const length = spanLength(span)
  const peak = Math.max(0, Math.min(MAX_HUMP, Math.floor(length / 2) - 1))
  return Array.from({ length: length + 1 }, (_, k) => Math.min(k, length - k, peak))
}

/** The stone arch bridge kind. */
export const stoneArchBridge = defineKind<BridgeSpan>({
  id: STONE_ARCH_BRIDGE,
  isParams: isBridgeSpan,
  bounds: (span) => spanBox(span, span.bedLevel - 1, span.deckY + MAX_HUMP + 2),
  stamp: (span, map) => {
    const owned: VoxelCoord[] = []
    const profile = humpProfile(span)
    const up = span.axis === 'x' ? Orientation.EAST : Orientation.SOUTH
    const down = span.axis === 'x' ? Orientation.WEST : Orientation.NORTH
    for (let along = 0; along < spanLength(span); along++) {
      const a = profile[along] ?? 0
      const b = profile[along + 1] ?? 0
      const low = Math.min(a, b)
      const y = a === b ? span.deckY + a : span.deckY + low + 1
      const voxel =
        a === b
          ? packVoxel(Material.STONE_BRICK)
          : packVoxel(Material.STONE_BRICK, Shape.SLOPE, b > a ? up : down)
      for (let across = 0; across < span.width; across++) {
        const v = spanVoxel(span, along, across, y)
        if (!isOpen(map, v)) continue
        map.set(v.x, v.y, v.z, voxel)
        owned.push(v)
      }
    }
    return owned
  },
})
