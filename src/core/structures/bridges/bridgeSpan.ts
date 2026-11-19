/**
 * Geometry shared by every bridge and river crossing: where it goes.
 *
 * Layer: core (pure TypeScript). A span is a straight band of cells along
 * one horizontal axis, from one bank to the other, at one deck height.
 * Bridge kinds stamp and draw from it; generators fill it from the terrain
 * (see `riverCrossing.ts`).
 */
import type { VoxelCoord } from '../../coords'
import { Material } from '../../materials'
import { isAir, materialOf, packVoxel } from '../../voxel'
import type { VoxelMap } from '../../voxelMap'
import type { VoxelBox } from '../structure'

/** Where a crossing goes. Cells and voxel levels. */
export interface BridgeSpan {
  /** Axis the crossing runs along. */
  readonly axis: 'x' | 'z'
  /** First and last cell along the axis (inclusive): bank cells the ends rest on. */
  readonly from: number
  readonly to: number
  /** First cell across the axis. */
  readonly side: number
  /** Width across the axis, in cells. */
  readonly width: number
  /**
   * Voxel y of the deck, flush with the banks: the banks' top voxel. The
   * walking surface is its top, level `deckY + 1`, the banks' own level, so
   * the deck meets the ground without a step or a ramp.
   */
  readonly deckY: number
  /** Level of the river bed (top of the lowest ground under the span). */
  readonly bedLevel: number
  /** Level of the water surface. */
  readonly waterLevel: number
}

/** Type guard for {@link BridgeSpan}. */
export function isBridgeSpan(value: unknown): value is BridgeSpan {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  const ints = ['from', 'to', 'side', 'width', 'deckY', 'bedLevel', 'waterLevel']
  return (
    (v.axis === 'x' || v.axis === 'z') &&
    ints.every((k) => typeof v[k] === 'number' && Number.isFinite(v[k])) &&
    (v.to as number) >= (v.from as number) &&
    (v.width as number) >= 1
  )
}

/** Position along the span (world units, 0 at its start) of world point (x, z). */
export function alongSpan(span: BridgeSpan, x: number, z: number): number {
  return (span.axis === 'x' ? x : z) - span.from
}

/** Length of the span along its axis, in cells (bank cells included). */
export function spanLength(span: BridgeSpan): number {
  return span.to - span.from + 1
}

/**
 * Voxel (x, y, z) of the span's cell `along` steps from its start and
 * `across` steps from its side, at voxel y `y`.
 */
export function spanVoxel(span: BridgeSpan, along: number, across: number, y: number): VoxelCoord {
  const u = span.from + along
  const v = span.side + across
  return span.axis === 'x' ? { x: u, y, z: v } : { x: v, y, z: u }
}

/** Voxel box of the span from voxel y `bottom` to `top` (inclusive). */
export function spanBox(span: BridgeSpan, bottom: number, top: number): VoxelBox {
  const a = spanVoxel(span, 0, 0, bottom)
  const b = spanVoxel(span, spanLength(span) - 1, span.width - 1, top)
  return {
    min: { x: Math.min(a.x, b.x), y: bottom, z: Math.min(a.z, b.z) },
    max: { x: Math.max(a.x, b.x), y: top, z: Math.max(a.z, b.z) },
  }
}

/**
 * Stamp a walkable deck of `material` where the span has no ground at deck
 * level (over water or air); on the banks the ground itself carries the
 * walk. Returns the deck voxels written.
 */
export function stampDeck(span: BridgeSpan, map: VoxelMap, material: number): VoxelCoord[] {
  const owned: VoxelCoord[] = []
  for (let along = 0; along < spanLength(span); along++) {
    for (let across = 0; across < span.width; across++) {
      const v = spanVoxel(span, along, across, span.deckY)
      if (!isOpen(map, v)) continue
      map.set(v.x, v.y, v.z, packVoxel(material))
      owned.push(v)
    }
  }
  return owned
}

/** Whether voxel `v` of `map` is open (air or water): no ground there. */
export function isOpen(map: VoxelMap, v: VoxelCoord): boolean {
  const here = map.get(v.x, v.y, v.z)
  return isAir(here) || materialOf(here) === Material.WATER
}
