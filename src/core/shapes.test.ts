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
  faceProfile,
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
