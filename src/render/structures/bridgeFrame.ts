/**
 * Local frame of a bridge span, for its meshers.
 *
 * Layer: render (no Three.js import). Meshers work in span coordinates:
 * `u` along the crossing (0 at the start of the first bank cell, `length`
 * at the end of the last), `v` across (0 to `width`), `y` in world units.
 * The frame turns them into world positions and directions.
 */
import { VOXEL_HEIGHT } from '@/core/coords'
import { spanLength, type BridgeSpan } from '@/core/structures/bridges/bridgeSpan'
import type { Vec3 } from '../meshing/meshBuilder'

/** World mapping of a span's local coordinates. */
export interface BridgeFrame {
  /** Span length (cells, world units). */
  readonly length: number
  /** Span width (cells, world units). */
  readonly width: number
  /** World height of the deck's walking surface. */
  readonly deckTop: number

  /** World height of the river bed. */
  readonly bed: number
  /** World height of the water surface. */
  readonly water: number
  /** World position of local (u, y, v). */
  at(u: number, y: number, v: number): Vec3
  /** World direction along the span. */
  readonly along: Vec3
  /** World direction across the span. */
  readonly across: Vec3
}

/** Frame of `span`. */
export function bridgeFrame(span: BridgeSpan): BridgeFrame {
  const alongX = span.axis === 'x'
  return {
    length: spanLength(span),
    width: span.width,
    deckTop: (span.deckY + 1) * VOXEL_HEIGHT,
    bed: span.bedLevel * VOXEL_HEIGHT,
    water: span.waterLevel * VOXEL_HEIGHT,
    at: (u, y, v) =>
      alongX ? [span.from + u, y, span.side + v] : [span.side + v, y, span.from + u],
    along: alongX ? [1, 0, 0] : [0, 0, 1],
    across: alongX ? [0, 0, 1] : [1, 0, 0],
  }
}
