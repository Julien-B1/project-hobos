import { describe, expect, it } from 'vitest'
import {
  FACES,
  FACE_NORMALS,
  Face,
  FaceProfile,
  ORIENTATION_OFFSETS,
  Orientation,
  SHAPES,
  Shape,
  cornersFromMask,
  faceProfile,
  isPlanarTop,
  shapeForCornerMask,
  topDiagonal,
  oppositeFace,
  topHeightAt,
  voxelTopCorners,
} from './shapes'
import { AIR, packVoxel } from './voxel'

const full = packVoxel(3, Shape.FULL)
const slope = (o: number): number => packVoxel(3, Shape.SLOPE, o)

/** Face whose outward normal points towards an orientation's direction. */
const FACE_TOWARDS = {
  [Orientation.NORTH]: Face.NZ,
  [Orientation.EAST]: Face.PX,
  [Orientation.SOUTH]: Face.PZ,
  [Orientation.WEST]: Face.NX,
} as const

describe('shape registry', () => {
  it('indexes definitions by shape id', () => {
    expect(SHAPES[Shape.FULL]?.name).toBe('full')
    expect(SHAPES[Shape.SLOPE]?.name).toBe('slope')
  })
})

describe('faces', () => {
  it('pairs opposite faces with opposite normals', () => {
    for (const f of FACES) {
      const n = FACE_NORMALS[f]
      const o = FACE_NORMALS[oppositeFace(f)]
      expect(n && o && n.map((v, i) => v + (o[i] ?? 0))).toEqual([0, 0, 0])
    }
  })
})

describe('face profiles', () => {
  it('air has no faces', () => {
    for (const f of FACES) expect(faceProfile(AIR, f)).toBe(FaceProfile.NONE)
  })

  it('a full block has six full faces', () => {
    for (const f of FACES) expect(faceProfile(full, f)).toBe(FaceProfile.FULL)
  })

  it.each([Orientation.NORTH, Orientation.EAST, Orientation.SOUTH, Orientation.WEST])(
    'a slope oriented %i: full bottom and high side, no low side, partial sides and top',
    (o) => {
      const v = slope(o)
      const high = FACE_TOWARDS[o]
      const low = oppositeFace(high)
      expect(faceProfile(v, Face.NY)).toBe(FaceProfile.FULL)
      expect(faceProfile(v, Face.PY)).toBe(FaceProfile.PARTIAL)
      expect(faceProfile(v, high)).toBe(FaceProfile.FULL)
      expect(faceProfile(v, low)).toBe(FaceProfile.NONE)
      const sides = FACES.filter((f) => f !== high && f !== low && f !== Face.PY && f !== Face.NY)
      expect(sides).toHaveLength(2)
      for (const f of sides) expect(faceProfile(v, f)).toBe(FaceProfile.PARTIAL)
    },
  )
})

describe('top surface height', () => {
  it('is 1 everywhere on a full block', () => {
    expect(topHeightAt(voxelTopCorners(full), 0.3, 0.8)).toBe(1)
  })

  it('rises towards the high side of a slope', () => {
    const east = voxelTopCorners(slope(Orientation.EAST))
    expect(topHeightAt(east, 0, 0.5)).toBeCloseTo(0)
    expect(topHeightAt(east, 0.5, 0.5)).toBeCloseTo(0.5)
    expect(topHeightAt(east, 1, 0.5)).toBeCloseTo(1)

    const north = voxelTopCorners(slope(Orientation.NORTH))
    expect(topHeightAt(north, 0.5, 0)).toBeCloseTo(1)
    expect(topHeightAt(north, 0.5, 1)).toBeCloseTo(0)
  })
})

describe('orientation offsets', () => {
  it('point north to -Z, east to +X, south to +Z, west to -X', () => {
    expect(ORIENTATION_OFFSETS[Orientation.NORTH]).toEqual([0, -1])
    expect(ORIENTATION_OFFSETS[Orientation.EAST]).toEqual([1, 0])
    expect(ORIENTATION_OFFSETS[Orientation.SOUTH]).toEqual([0, 1])
    expect(ORIENTATION_OFFSETS[Orientation.WEST]).toEqual([-1, 0])
  })
})

describe('CORNERS shape', () => {
  const corners = (mask: number): number => packVoxel(3, Shape.CORNERS, mask)

  it('maps mask bits to corner heights', () => {
    expect(cornersFromMask(0b0101)).toEqual([1, 0, 1, 0])
    expect(voxelTopCorners(corners(0b1000))).toEqual([0, 0, 0, 1])
  })

  it('gives an outer corner two triangular sides and no other side', () => {
    const v = corners(0b0010) // only c10 (north-east) high
    expect(faceProfile(v, Face.PX)).toBe(FaceProfile.PARTIAL)
    expect(faceProfile(v, Face.NZ)).toBe(FaceProfile.PARTIAL)
    expect(faceProfile(v, Face.NX)).toBe(FaceProfile.NONE)
    expect(faceProfile(v, Face.PZ)).toBe(FaceProfile.NONE)
  })

  it('gives an inner corner two full sides and two triangles', () => {
    const v = corners(0b1011) // all but c11 (south-east)
    expect(faceProfile(v, Face.NX)).toBe(FaceProfile.FULL)
    expect(faceProfile(v, Face.NZ)).toBe(FaceProfile.FULL)
    expect(faceProfile(v, Face.PX)).toBe(FaceProfile.PARTIAL)
    expect(faceProfile(v, Face.PZ)).toBe(FaceProfile.PARTIAL)
  })
})

describe('shapeForCornerMask', () => {
  it('prefers named shapes', () => {
    expect(shapeForCornerMask(0)).toBeNull()
    expect(shapeForCornerMask(0b1111)).toEqual({ shape: Shape.FULL, orientation: 0 })
    expect(shapeForCornerMask(0b0011)).toEqual({
      shape: Shape.SLOPE,
      orientation: Orientation.NORTH,
    })
    expect(shapeForCornerMask(0b0110)).toEqual({
      shape: Shape.SLOPE,
      orientation: Orientation.EAST,
    })
    expect(shapeForCornerMask(0b1100)).toEqual({
      shape: Shape.SLOPE,
      orientation: Orientation.SOUTH,
    })
    expect(shapeForCornerMask(0b1001)).toEqual({
      shape: Shape.SLOPE,
      orientation: Orientation.WEST,
    })
    expect(shapeForCornerMask(0b0100)).toEqual({ shape: Shape.CORNERS, orientation: 0b0100 })
  })

  it('round-trips through the shape registry', () => {
    for (let mask = 1; mask < 16; mask++) {
      const s = shapeForCornerMask(mask)
      if (!s) throw new Error('unexpected null')
      const top = voxelTopCorners(packVoxel(3, s.shape, s.orientation))
      expect(top).toEqual(cornersFromMask(mask))
    }
  })
})

describe('top triangulation', () => {
  it('splits away from the odd corner', () => {
    expect(topDiagonal([1, 0, 0, 0])).toBe(1)
    expect(topDiagonal([0, 1, 0, 0])).toBe(0)
    expect(topDiagonal([1, 1, 0, 1])).toBe(1)
  })

  it('makes a ridge between high opposite corners', () => {
    expect(topDiagonal([1, 0, 1, 0])).toBe(0)
    expect(topDiagonal([0, 1, 0, 1])).toBe(1)
  })

  it('detects planar tops', () => {
    expect(isPlanarTop([1, 1, 1, 1])).toBe(true)
    expect(isPlanarTop([1, 1, 0, 0])).toBe(true)
    expect(isPlanarTop([1, 0, 0, 0])).toBe(false)
  })

  it('samples an outer corner: flat half and sloped half', () => {
    const c = cornersFromMask(0b0001) // c00 high, split on diagonal c10-c01
    expect(topHeightAt(c, 0, 0)).toBeCloseTo(1)
    expect(topHeightAt(c, 0.25, 0.25)).toBeCloseTo(0.5)
    expect(topHeightAt(c, 0.8, 0.8)).toBeCloseTo(0) // far triangle is flat
  })
})
