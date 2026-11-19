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
 * - CORNERS: generic wedge; `orientation` is a 4-bit mask of the corners at
 *   height 1 (bit i = corner i), the others at 0. Covers outer corners
 *   (1 bit), inner corners (3 bits), slopes and saddles (2 bits). Used by
 *   terrain smoothing to join slopes around corners and diagonals.
 *
 * Non-planar tops (corners, saddles) are made of two triangles; the split
 * diagonal is chosen by {@link topDiagonal} and shared by meshing, picking
 * and the highlight so they all agree on the surface.
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
  CORNERS: 2,
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
  {
    name: 'corners',
    topCorners: (mask) => cornersFromMask(mask),
  },
]

/** Corner heights for a CORNERS mask: bit i set = corner i at height 1. */
export function cornersFromMask(mask: number): CornerHeights {
  return [mask & 1 ? 1 : 0, mask & 2 ? 1 : 0, mask & 4 ? 1 : 0, mask & 8 ? 1 : 0]
}

/**
 * Best voxel (shape and orientation) for a set of 0/1 corner heights given
 * as a mask (bit i = corner i high): null for mask 0 (nothing to add), FULL
 * for 15, SLOPE when the mask is one straight slope, CORNERS otherwise.
 * Prefers named shapes so the debug HUD stays readable.
 */
export function shapeForCornerMask(mask: number): { shape: ShapeId; orientation: number } | null {
  const m = mask & 0xf
  if (m === 0) return null
  if (m === 0xf) return { shape: Shape.FULL, orientation: 0 }
  const slope = SLOPE_MASKS.indexOf(m)
  if (slope >= 0) return { shape: Shape.SLOPE, orientation: slope }
  return { shape: Shape.CORNERS, orientation: m }
}

/** Corner masks of the 4 slope orientations, indexed by orientation id. */
const SLOPE_MASKS: readonly number[] = [0b0011, 0b0110, 0b1100, 0b1001]

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
 * Diagonal used to split a top face into two triangles:
 * - 0: diagonal c00 - c11 (triangles [0, 1, 2] and [0, 2, 3]);
 * - 1: diagonal c10 - c01 (triangles [1, 2, 3] and [1, 3, 0]).
 *
 * When exactly one corner differs from the other three (outer or inner
 * corner), the diagonal avoiding that corner is used, so one triangle stays
 * flat and the other slopes. For a saddle (two opposite corners high), the
 * diagonal joins the high corners (a ridge). Otherwise 0.
 */
export function topDiagonal(corners: CornerHeights): 0 | 1 {
  const [c0, c1, c2, c3] = corners
  const values = [c0, c1, c2, c3]
  for (let i = 0; i < 4; i++) {
    const others = values.filter((_, j) => j !== i)
    const [first] = others
    if (others.every((v) => v === first) && values[i] !== first) return i % 2 === 0 ? 1 : 0
  }
  if (c0 === c2 && c1 === c3 && c0 !== c1) return c0 > c1 ? 0 : 1
  return 0
}

/** True when the 4 top corners lie on one plane (flat tops and slopes). */
export function isPlanarTop(corners: CornerHeights): boolean {
  return corners[0] + corners[2] === corners[1] + corners[3]
}

/**
 * Height of the top surface at a point inside the cell, in voxel units (0..1),
 * following the same two-triangle split as the mesh ({@link topDiagonal}).
 *
 * @param fx Position across the cell along X, in [0, 1].
 * @param fz Position across the cell along Z, in [0, 1].
 */
export function topHeightAt(corners: CornerHeights, fx: number, fz: number): number {
  const [h00, h10, h11, h01] = corners
  if (topDiagonal(corners) === 0) {
    // Triangles (c00, c10, c11) where fz <= fx, and (c00, c11, c01) elsewhere.
    if (fz <= fx) return h00 + (h10 - h00) * (fx - fz) + (h11 - h00) * fz
    return h00 + (h01 - h00) * (fz - fx) + (h11 - h00) * fx
  }
  // Triangles (c00, c10, c01) where fx + fz <= 1, and (c11, c01, c10) elsewhere.
  if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz
  return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz)
}
