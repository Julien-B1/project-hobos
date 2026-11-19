/**
 * Start-up settings of the running session, shown by the debug HUD so a
 * screenshot carries everything needed to reproduce the view.
 *
 * Layer: app.
 */
import type { TestMapId } from '@/core/generators/catalog'
import type { TerrainMesherKind } from '@/render/engine'

/** Settings resolved at start-up (URL flags and generator defaults). */
export interface SessionInfo {
  /** Test map in use. */
  readonly map: TestMapId
  /** Seed actually used by a procedural map (defaults resolved), else null. */
  readonly seed: number | null
  /** Map footprint, in cells (battle-map squares). */
  readonly width: number
  readonly depth: number
  /** Terrain rendering mode. */
  readonly mesher: TerrainMesherKind
  /** Whether the WebGL 2 backend was forced. */
  readonly forceWebGL: boolean
}
