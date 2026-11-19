/**
 * Surfaces: the tops of voxels that something could stand on, and picking
 * maths that turn a ray hit into "which voxel, which surface".
 *
 * Layer: core (pure TypeScript, no Three.js: hit data comes in as plain
 * numbers so this is unit-testable).
 *
 * Definition used throughout the project: a *surface* is the top of a
 * non-air voxel whose voxel directly above is air. A column (x, z) can hold
 * several surfaces at different heights, e.g. a path under a bridge: this is
 * the multi-level case the map must support. Clearance (head room) is not
 * checked here; navigation will add that later.
 */
import { VOXEL_HEIGHT, type VoxelCoord } from './coords'
import { isAir, shapeOf, type Voxel } from './voxel'
import type { VoxelMap } from './voxelMap'

/**
 * Voxel levels `y` in column (x, z) whose top is a surface, scanning
 * `yMin..yMax` inclusive, from bottom to top.
 */
export function columnSurfaces(
  map: VoxelMap,
  x: number,
  z: number,
  yMin: number,
  yMax: number,
): number[] {
  const levels: number[] = []
  for (let y = yMin; y <= yMax; y++) {
    if (!isAir(map.get(x, y, z)) && isAir(map.get(x, y + 1, z))) levels.push(y)
  }
  return levels
}

/** Which way the hit face points. */
export type HitFacing = 'top' | 'side' | 'bottom'

/** Result of {@link resolveHit}. Coordinates are voxel coordinates. */
export interface SurfaceHit {
  /** Voxel the ray touched. */
  readonly voxel: VoxelCoord
  /** Packed value of the touched voxel. */
  readonly voxelValue: Voxel
  /** Orientation of the touched face. */
  readonly facing: HitFacing
  /**
   * Voxel whose top is the targeted surface (air above it). Same column
   * (x, z) as {@link SurfaceHit.voxel}.
   */
  readonly surface: VoxelCoord
  /** Packed value of the surface voxel (its shape gives the surface geometry). */
  readonly surfaceValue: Voxel
}

/**
 * Distance, in world units, by which the hit point is pushed into the
 * touched voxel along the face normal. A raycast hit lies exactly on a face,
 * i.e. on the boundary between two cells; flooring it directly would pick
 * either side depending on float noise.
 */
const INSIDE_EPSILON = 1e-3

/** Normal components below this (in absolute value) count as horizontal. */
const FACING_THRESHOLD = 0.5

/** Safety bound when walking a column up or down, in voxels. */
const MAX_COLUMN_WALK = 256

/**
 * Turn a ray hit on the terrain mesh into the touched voxel and the targeted
 * surface.
 *
 * Steps:
 * 1. Push the hit point slightly inside the mesh (against the normal) and
 *    floor it into voxel coordinates (y divided by the voxel height). This
 *    works for sloped faces too, whose normals are not axis-aligned.
 * 2. Choose the surface in the same column:
 *    - top face (normal mostly up, flat top or slope): the touched voxel;
 *    - side face: climb while the voxel above is solid, so aiming at a wall
 *      or cliff face targets the top of that stack;
 *    - bottom face (a ceiling, seen from below, e.g. inside a tunnel): the
 *      nearest surface below, i.e. the floor under that ceiling.
 *
 * @param point Hit point, world units.
 * @param normal Unit face normal at the hit, world space, pointing out of the mesh.
 * @returns null when the point does not resolve to a solid voxel (should
 *   not happen with meshes built from the same map) or no surface exists.
 */
export function resolveHit(
  map: VoxelMap,
  point: { x: number; y: number; z: number },
  normal: { x: number; y: number; z: number },
): SurfaceHit | null {
  const x = Math.floor(point.x - normal.x * INSIDE_EPSILON)
  const y = Math.floor((point.y - normal.y * INSIDE_EPSILON) / VOXEL_HEIGHT)
  const z = Math.floor(point.z - normal.z * INSIDE_EPSILON)
  const voxelValue = map.get(x, y, z)
  if (isAir(voxelValue)) return null

  const facing: HitFacing =
    normal.y > FACING_THRESHOLD ? 'top' : normal.y < -FACING_THRESHOLD ? 'bottom' : 'side'

  let surfaceY: number | null
  if (facing === 'bottom') {
    surfaceY = surfaceBelow(map, x, y - 1, z)
  } else {
    surfaceY = y
    for (let i = 0; i < MAX_COLUMN_WALK && !isAir(map.get(x, surfaceY + 1, z)); i++) surfaceY++
  }
  if (surfaceY === null) return null

  return {
    voxel: { x, y, z },
    voxelValue,
    facing,
    surface: { x, y: surfaceY, z },
    surfaceValue: map.get(x, surfaceY, z),
  }
}

/** First surface at or below level `fromY` in column (x, z), or null. */
function surfaceBelow(map: VoxelMap, x: number, fromY: number, z: number): number | null {
  for (let y = fromY, i = 0; i < MAX_COLUMN_WALK; y--, i++) {
    if (!isAir(map.get(x, y, z)) && isAir(map.get(x, y + 1, z))) return y
  }
  return null
}

/** Shape id of the surface voxel, for display. */
export function surfaceShape(hit: SurfaceHit): number {
  return shapeOf(hit.surfaceValue)
}
