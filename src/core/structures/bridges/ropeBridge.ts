/**
 * Rope bridge: planks hanging on ropes between posts on both banks.
 *
 * Layer: core (pure TypeScript). The deck sags as a hanging rope
 * ({@link ropeDeckHeight}, shared with the render side): its walk is
 * stamped as WOOD voxels at the sagging deck's level, rounded, in every
 * open cell. Look (`render/structures/ropeBridgeMesher.ts`): anchor posts
 * with guy ropes, foot ropes carrying the planks, hand ropes, suspenders.
 */
import { VOXEL_HEIGHT, type VoxelCoord } from '../../coords'
import { Material } from '../../materials'
import { packVoxel } from '../../voxel'
import { defineKind } from '../structure'
import {
  alongSpan,
  isBridgeSpan,
  isOpen,
  spanBox,
  spanLength,
  spanVoxel,
  type BridgeSpan,
} from './bridgeSpan'

/** Kind id. */
export const ROPE_BRIDGE = 'rope-bridge'

/** Sag of the deck at mid span, as a share of the span length. */
const SAG_RATIO = 1 / 12
/** Smallest clearance kept between the sagging deck and the water, world units. */
const MIN_CLEARANCE = 0.3

/** Sag of the deck at mid span (world units): about 1/12 of the span, above the water. */
export function ropeSag(span: BridgeSpan): number {
  const deckTop = (span.deckY + 1) * VOXEL_HEIGHT
  const room = deckTop - span.waterLevel * VOXEL_HEIGHT - MIN_CLEARANCE
  return Math.max(0, Math.min(spanLength(span) * SAG_RATIO, room))
}

/** World height of the deck's top at `u` (0..length) along the span. */
export function ropeDeckHeight(span: BridgeSpan, u: number): number {
  const length = spanLength(span)
  const t = Math.min(1, Math.max(0, u / length))
  return (span.deckY + 1) * VOXEL_HEIGHT - ropeSag(span) * 4 * t * (1 - t)
}

/** The rope bridge kind. */
export const ropeBridge = defineKind<BridgeSpan>({
  id: ROPE_BRIDGE,
  isParams: isBridgeSpan,
  bounds: (span) => spanBox(span, span.bedLevel - 1, span.deckY + 4),
  // The cursor follows the sagging planks, not the rounded voxels.
  surfaceAt: (span, x, z) => ropeDeckHeight(span, alongSpan(span, x, z)),
  stamp: (span, map) => {
    const owned: VoxelCoord[] = []
    for (let along = 0; along < spanLength(span); along++) {
      const level = Math.round(ropeDeckHeight(span, along + 0.5) / VOXEL_HEIGHT)
      for (let across = 0; across < span.width; across++) {
        const v = spanVoxel(span, along, across, level - 1)
        if (!isOpen(map, v)) continue
        map.set(v.x, v.y, v.z, packVoxel(Material.WOOD))
        owned.push(v)
      }
    }
    return owned
  },
})
