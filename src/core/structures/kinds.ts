/**
 * The structure kinds every map knows.
 *
 * Layer: core (pure TypeScript). One line per kind: adding a kind is adding
 * its module and its entry here (and its mesher on the render side).
 */
import { fallenLog } from './bridges/fallenLog'
import { ford } from './bridges/ford'
import { ropeBridge } from './bridges/ropeBridge'
import { slabBridge } from './bridges/slabBridge'
import { steppingStones } from './bridges/steppingStones'
import { stoneArchBridge } from './bridges/stoneArchBridge'
import { woodBeamBridge } from './bridges/woodBeamBridge'
import { StructureRegistry } from './registry'

/** A registry holding every built-in kind. */
export function defaultStructureKinds(): StructureRegistry {
  return new StructureRegistry([
    woodBeamBridge,
    fallenLog,
    steppingStones,
    ford,
    slabBridge,
    stoneArchBridge,
    ropeBridge,
  ])
}
