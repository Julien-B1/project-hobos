/**
 * Structures: parametric objects placed on a map (bridges now, buildings
 * later).
 *
 * Layer: core (pure TypeScript). See ADR-007 in the wiki (Decisions).
 *
 * A structure is the truth for its **look**: its parameters describe what
 * voxels cannot (arches, ropes, beams), and a render-side mesher draws it.
 * It **stamps** voxels for **gameplay**: walkable decks, blocking piers,
 * raised river beds. Those voxels stay the truth for surfaces, picking and
 * (later) path finding; the voxels a structure owns are not drawn as
 * blocks, its mesh replaces them.
 *
 * Every kind of structure is a {@link StructureKind} registered by id (see
 * `registry.ts`): adding a kind (a house, a tower) never touches the
 * engine, the meshers or the generators.
 */
import type { VoxelCoord } from '../coords'
import type { VoxelMap } from '../voxelMap'

/** Inclusive voxel box. */
export interface VoxelBox {
  readonly min: VoxelCoord
  readonly max: VoxelCoord
}

/** One structure placed on a map. Immutable. */
export interface Structure<P = unknown> {
  /** Unique id on its map. */
  readonly id: string
  /** Id of its {@link StructureKind}. */
  readonly kind: string
  /** Kind-specific parameters (checked by the kind). */
  readonly params: P
}

/**
 * What a kind of structure does on the core side. Contract, for every kind:
 * - `stamp` writes only inside `bounds`;
 * - both are deterministic (same structure, same result);
 * - `stamp` returns exactly the voxels the structure's mesh replaces.
 */
export interface StructureKind {
  /** Unique id, also the key of its render-side mesher. */
  readonly id: string
  /** Voxel box holding everything the structure stamps or draws. */
  bounds(structure: Structure): VoxelBox
  /**
   * Write the gameplay voxels into `map`. Returns the voxels the structure
   * owns: drawn by its mesher, never as blocks.
   */
  stamp(structure: Structure, map: VoxelMap): VoxelCoord[]
  /**
   * World height of the structure's walking surface at world position
   * (x, z), when it differs from its voxels' tops (a sagging or curved
   * deck); undefined to use the voxels. Used to lay the hover cursor.
   */
  surfaceAt?(structure: Structure, x: number, z: number): number | undefined
  /**
   * True when its walking spots are apart (stepping stones): a character
   * hops from one to the next instead of walking the ground between them.
   */
  readonly hops?: boolean
}

/** The typed half of a kind: what it does with its own parameters. */
export interface KindDefinition<P> {
  readonly id: string
  /** Type guard of the parameters (structures come from generators or data). */
  readonly isParams: (value: unknown) => value is P
  readonly bounds: (params: P) => VoxelBox
  readonly stamp: (params: P, map: VoxelMap) => VoxelCoord[]
  /** See {@link StructureKind.surfaceAt}. */
  readonly surfaceAt?: (params: P, x: number, z: number) => number | undefined
  /** See {@link StructureKind.hops}. */
  readonly hops?: boolean
}

/**
 * Build a {@link StructureKind} from typed functions: parameters are checked
 * once here, so each kind works with its own parameter type.
 */
export function defineKind<P>(definition: KindDefinition<P>): StructureKind {
  const surfaceAt = definition.surfaceAt
  return {
    id: definition.id,
    ...(definition.hops ? { hops: true } : {}),
    bounds: (structure) => definition.bounds(paramsOf(definition, structure)),
    stamp: (structure, map) => definition.stamp(paramsOf(definition, structure), map),
    ...(surfaceAt
      ? {
          surfaceAt: (structure: Structure, x: number, z: number) =>
            surfaceAt(paramsOf(definition, structure), x, z),
        }
      : {}),
  }
}

/** Parameters of `structure`, checked against `definition`. Throws if they do not fit. */
export function paramsOf<P>(
  definition: { readonly id: string; readonly isParams: (value: unknown) => value is P },
  structure: Structure,
): P {
  if (structure.kind !== definition.id) {
    throw new Error(`structure ${structure.id} is a ${structure.kind}, not a ${definition.id}`)
  }
  if (!definition.isParams(structure.params)) {
    throw new Error(`structure ${structure.id}: invalid ${definition.id} parameters`)
  }
  return structure.params
}
