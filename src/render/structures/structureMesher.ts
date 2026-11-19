/**
 * Render side of structures: one mesher per structure kind.
 *
 * Layer: render (no Three.js import). A mesher draws one structure from its
 * parameters with the shared primitives (`render/geometry/primitives.ts`)
 * into the blocks layer: pickable, shadowed, cut like the rest. Meshers
 * are looked up by kind id in a {@link StructureMesherRegistry}, so new
 * kinds plug in without changing the chunk meshers.
 */
import { paramsOf, type Structure } from '@/core/structures/structure'
import { StructureRegistry } from '@/core/structures/registry'
import type { MeshBuilder } from '../meshing/meshBuilder'

/** Draws the structures of one kind. */
export interface StructureMesher {
  /** Id of the kind it draws. */
  readonly id: string
  /** Append the geometry of `structure` (closed volumes) to `out`. */
  mesh(structure: Structure, out: MeshBuilder): void
}

/** Meshers by kind id. */
export type StructureMesherRegistry = StructureRegistry<StructureMesher>

/** Build a mesher from a typed function: parameters are checked once here. */
export function defineMesher<P>(
  id: string,
  isParams: (value: unknown) => value is P,
  draw: (params: P, out: MeshBuilder, structure: Structure) => void,
): StructureMesher {
  return {
    id,
    mesh: (structure, out) => {
      draw(paramsOf({ id, isParams }, structure), out, structure)
    },
  }
}
