/**
 * Catalog of test maps selectable at start-up.
 *
 * Layer: core (pure TypeScript). Gives each generated map the metadata the
 * app needs to frame it: footprint and a home point for the camera.
 */
import { VOXEL_HEIGHT } from '../coords'
import type { VoxelMap } from '../voxelMap'
import { createFlatMap } from './flatMap'
import { createOrganicMap } from './organicMap'
import { REFERENCE_LAYOUT, createReferenceMap } from './referenceMap'

/** Identifiers of the available test maps. */
export const TEST_MAP_IDS = ['reference', 'flat', 'organic'] as const

/** One of {@link TEST_MAP_IDS}. */
export type TestMapId = (typeof TEST_MAP_IDS)[number]

/** A generated map with framing metadata. */
export interface TestMap {
  readonly id: TestMapId
  readonly map: VoxelMap
  /** Footprint along X, in cells (map covers x in [0, width)). */
  readonly width: number
  /** Footprint along Z, in cells (map covers z in [0, depth)). */
  readonly depth: number
  /** Camera home target, in world units. */
  readonly home: { readonly x: number; readonly y: number; readonly z: number }
}

/** Type guard for map ids coming from untrusted input (URL). */
export function isTestMapId(value: string): value is TestMapId {
  return (TEST_MAP_IDS as readonly string[]).includes(value)
}

/** Options for {@link createTestMap}. */
export interface TestMapOptions {
  /** Seed for procedural maps (ignored by fixed maps). */
  readonly seed?: number
}

/** Generate a test map by id. */
export function createTestMap(id: TestMapId, options: TestMapOptions = {}): TestMap {
  switch (id) {
    case 'reference': {
      const { width, depth } = REFERENCE_LAYOUT.size
      return {
        id,
        map: createReferenceMap(),
        width,
        depth,
        home: { x: width / 2, y: REFERENCE_LAYOUT.groundTop * VOXEL_HEIGHT, z: depth / 2 },
      }
    }
    case 'organic': {
      const organic = createOrganicMap(options.seed === undefined ? {} : { seed: options.seed })
      const c = organic.size / 2
      return {
        id,
        map: organic.map,
        width: organic.size,
        depth: organic.size,
        home: { x: c, y: organic.heightAt(c, c) * VOXEL_HEIGHT, z: c },
      }
    }
    case 'flat':
      return {
        id,
        map: createFlatMap(32, 32),
        width: 32,
        depth: 32,
        home: { x: 16, y: VOXEL_HEIGHT, z: 16 },
      }
  }
}
