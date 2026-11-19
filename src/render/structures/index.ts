/**
 * The structure meshers every renderer knows (one per core kind, see
 * `core/structures/kinds.ts`).
 *
 * Layer: render (no Three.js import).
 */
import { StructureRegistry } from '@/core/structures/registry'
import { fallenLogMesher } from './fallenLogMesher'
import { fordMesher } from './fordMesher'
import { ropeBridgeMesher } from './ropeBridgeMesher'
import { slabBridgeMesher } from './slabBridgeMesher'
import { steppingStonesMesher } from './steppingStonesMesher'
import { stoneArchBridgeMesher } from './stoneArchBridgeMesher'
import type { StructureMesher, StructureMesherRegistry } from './structureMesher'
import { woodBeamBridgeMesher } from './woodBeamBridgeMesher'

/** A registry holding every built-in mesher. */
export function defaultStructureMeshers(): StructureMesherRegistry {
  return new StructureRegistry<StructureMesher>([
    woodBeamBridgeMesher,
    fallenLogMesher,
    steppingStonesMesher,
    fordMesher,
    slabBridgeMesher,
    stoneArchBridgeMesher,
    ropeBridgeMesher,
  ])
}
