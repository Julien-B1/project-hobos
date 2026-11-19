/**
 * Debug terrain edits driven by the mouse.
 *
 * Layer: app (the only layer allowed to mutate the map in response to
 * input). Uses the engine's latest hover hit and writes to the `VoxelMap`;
 * the map marks dirty chunks and the render layer rebuilds only those.
 *
 * - remove: clear the voxel under the cursor;
 * - place: put a full stone voxel on top of the targeted surface.
 */
import { Material } from '@/core/materials'
import type { SurfaceHit } from '@/core/surface'
import { AIR, packVoxel } from '@/core/voxel'
import type { VoxelMap } from '@/core/voxelMap'

/** Edit actions the input bindings can trigger. */
export interface EditActions {
  /** Remove the voxel under the cursor, if any. */
  remove(): void
  /** Place a voxel on top of the surface under the cursor, if any. */
  place(): void
}

/** Voxel placed by {@link EditActions.place}. */
const PLACED_VOXEL = packVoxel(Material.STONE)

/**
 * Create edit actions on `map`.
 *
 * @param currentHit Returns the latest hover hit (from the engine), or null.
 */
export function createDebugEdits(map: VoxelMap, currentHit: () => SurfaceHit | null): EditActions {
  return {
    remove: () => {
      const hit = currentHit()
      if (!hit) return
      map.set(hit.voxel.x, hit.voxel.y, hit.voxel.z, AIR)
    },
    place: () => {
      const hit = currentHit()
      if (!hit) return
      const { x, y, z } = hit.surface
      // The surface voxel has air above it by definition: this never overwrites.
      map.set(x, y + 1, z, PLACED_VOXEL)
    },
  }
}
