/**
 * Voxel shapes: registry and face profiles.
 *
 * Layer: core (pure TypeScript). Shared by meshing (which faces to emit, what
 * geometry to build), picking (where the top surface is) and, later,
 * navigation.
 *
 * Model: every shape so far is a *height-field column*. Inside its cell, the
 * solid part goes from the voxel bottom up to a top surface defined by four
 * corner heights (in voxel units, 0 = bottom, 1 = top of the voxel):
 *
 * ```
 *   z0 (north) c00 ---- c10
 *               |        |       corner order: [c00, c10, c11, c01]
 *   z1 (south) c01 ---- c11      x0 = west, x1 = east
 * ```
 *
 * - FULL: all corners at 1 (a cube).
 * - SLOPE: rises from 0 to 1 across the cell; `orientation` is the compass
 *   direction of the high side.
 *
 * Face profiles (what a face looks like from the neighbour's side) are
 * derived from the corner heights, so a new height-field shape (half slab,
 * corner slope...) only needs a new registry entry. A shape that is not a
 * height field (stairs, arches) would extend `ShapeDefinition` with its own
 * profile and geometry functions.
 */
import { isAir, orientationOf, shapeOf, type Voxel } from './voxel'

/** Shape ids (4-bit field of a voxel). */
export const Shape = {
  FULL: 0,
  SLOPE: 1,
} as const

/** A shape id from {@link Shape}. */
export type ShapeId = (typeof Shape)[keyof typeof Shape]

/**
 * Compass orientations (4-bit field of a voxel).
 * North = -Z, East = +X, South = +Z, West = -X.
 */
export const Orientation = {
  NORTH: 0,
  EAST: 1,
  SOUTH: 2,
  WEST: 3,
} as const

/** An orientation id from {@link Orientation}. */
export type OrientationId = (typeof Orientation)[keyof typeof Orientation]

/**
 * Horizontal unit offset (dx, dz) of each orientation, indexed by
 * orientation id: NORTH (0, -1), EAST (1, 0), SOUTH (0, 1), WEST (-1, 0).
 */
export const ORIENTATION_OFFSETS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
]

/**
 * Axis-aligned faces of a voxel cell. Opposite faces differ only by their
 * lowest bit, so `face ^ 1` is the opposite face.
 */
export const Face = {
  PX: 0,
  NX: 1,
  PY: 2,
  NY: 3,
  PZ: 4,
  NZ: 5,
} as const

/** A face id from {@link Face}. */
export type FaceId = (typeof Face)[keyof typeof Face]

/** All faces, in id order. */
export const FACES: readonly FaceId[] = [Face.PX, Face.NX, Face.PY, Face.NY, Face.PZ, Face.NZ]

/** Outward unit normal of each face, indexed by face id: [x, y, z]. */
export const FACE_NORMALS: readonly (readonly [number, number, number])[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
]

/** Opposite face (PX <-> NX, PY <-> NY, PZ <-> NZ). */
export function oppositeFace(face: FaceId): FaceId {
  return (face ^ 1) as FaceId
}

/**
 * How much of a cell face a shape covers.
 * - NONE: nothing (e.g. low side of a slope): neighbours must show their face.
 * - PARTIAL: some of it (triangle, sloped top): neighbours must still show theirs.
 * - FULL: the whole square: the neighbour's touching face is hidden.
 */
export const FaceProfile = {
  NONE: 0,
  PARTIAL: 1,
  FULL: 2,
} as const

/** A profile from {@link FaceProfile}. */
export type FaceProfileId = (typeof FaceProfile)[keyof typeof FaceProfile]

/** Top corner heights [c00, c10, c11, c01], in voxel units (0..1). */
export type CornerHeights = readonly [number, number, number, number]

/** Definition of a height-field shape. */
export interface ShapeDefinition {
  /** Debug name. */
  readonly name: string
  /** Top corner heights for an orientation (ignored by symmetric shapes). */
  topCorners(orientation: number): CornerHeights
}

const FULL_CORNERS: CornerHeights = [1, 1, 1, 1]

/**
 * Slope corners, indexed by orientation id (high side): NORTH, EAST, SOUTH,
 * WEST. An array (not a record) so out-of-range ids read as undefined.
 */
const SLOPE_CORNERS: readonly CornerHeights[] = [
  [1, 1, 0, 0],
  [0, 1, 1, 0],
  [0, 0, 1, 1],
  [1, 0, 0, 1],
]

/**
 * Registry of known shapes, indexed by shape id (array index = id). Keep the
 * order in sync with {@link Shape}.
 */
export const SHAPES: readonly ShapeDefinition[] = [
  { name: 'full', topCorners: () => FULL_CORNERS },
  {
    name: 'slope',
    // Orientation bits come from data: values 4..15 are invalid for slopes.
    topCorners: (o) => SLOPE_CORNERS[o] ?? SLOPE_CORNERS[Orientation.NORTH] ?? FULL_CORNERS,
  },
]

const FULL_DEFINITION: ShapeDefinition = { name: 'full', topCorners: () => FULL_CORNERS }

/** Shape definition for an id; unknown ids fall back to FULL so data errors stay visible. */
export function shapeDefinition(shape: number): ShapeDefinition {
  return SHAPES[shape] ?? FULL_DEFINITION
}

/** Top corner heights of a non-air voxel. */
export function voxelTopCorners(voxel: Voxel): CornerHeights {
  return shapeDefinition(shapeOf(voxel)).topCorners(orientationOf(voxel))
}

/** Index of a corner in {@link CornerHeights}. */
export type CornerIndex = 0 | 1 | 2 | 3

/**
 * The two top corners (indices into {@link CornerHeights}) bounding each
 * vertical face. Indexed by face id; PY/NY have no entry. Consumers must not
 * rely on the order for winding: the mesher orients triangles from the face
 * normal.
 */
export const SIDE_FACE_CORNERS: Readonly<
  Partial<Record<FaceId, readonly [CornerIndex, CornerIndex]>>
> = {
  [Face.PX]: [2, 1], // c11 -> c10
  [Face.NX]: [0, 3], // c00 -> c01
  [Face.PZ]: [3, 2], // c01 -> c11
  [Face.NZ]: [1, 0], // c10 -> c00
}

/** Profile of one face given the top corner heights. */
export function profileFromCorners(corners: CornerHeights, face: FaceId): FaceProfileId {
  if (face === Face.NY) return FaceProfile.FULL // height fields always have a flat bottom
  if (face === Face.PY) {
    if (corners.every((h) => h >= 1)) return FaceProfile.FULL
    return corners.every((h) => h <= 0) ? FaceProfile.NONE : FaceProfile.PARTIAL
  }
  const pair = SIDE_FACE_CORNERS[face]
  if (!pair) return FaceProfile.NONE
  const a = corners[pair[0]]
  const b = corners[pair[1]]
  if (a >= 1 && b >= 1) return FaceProfile.FULL
  if (a <= 0 && b <= 0) return FaceProfile.NONE
  return FaceProfile.PARTIAL
}

/** Profile of `face` of `voxel`; air has no faces. */
export function faceProfile(voxel: Voxel, face: FaceId): FaceProfileId {
  if (isAir(voxel)) return FaceProfile.NONE
  return profileFromCorners(voxelTopCorners(voxel), face)
}

/**
 * Height of the top surface at a point inside the cell, in voxel units (0..1).
 * Bilinear interpolation of the corners; exact for flat tops and slopes.
 *
 * @param fx Position across the cell along X, in [0, 1].
 * @param fz Position across the cell along Z, in [0, 1].
 */
export function topHeightAt(corners: CornerHeights, fx: number, fz: number): number {
  const [c00, c10, c11, c01] = corners
  const north = c00 + (c10 - c00) * fx
  const south = c01 + (c11 - c01) * fx
  return north + (south - north) * fz
}
