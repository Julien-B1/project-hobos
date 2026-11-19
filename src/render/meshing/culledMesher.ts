/**
 * Culled chunk mesher: one polygon per visible voxel face.
 *
 * Layer: render (no Three.js import, unit-tested).
 *
 * For every non-air voxel of the chunk and every face:
 * 1. skip the face if the shape has nothing there (profile NONE, e.g. the low
 *    side of a slope);
 * 2. skip it if the face-adjacent voxel (possibly in another chunk, read
 *    through the map) covers it completely, i.e. its touching face is FULL;
 *    sloped tops are never culled (they are not axis-aligned);
 * 3. otherwise emit the face polygon from the shape's top corner heights:
 *    quads for full faces, triangles for slope sides, a tilted quad for a
 *    sloped top.
 *
 * Winding is not hard-coded per face: each polygon is checked against its
 * expected outward direction and reversed when needed, which keeps new
 * shapes simple to add.
 */
import { CHUNK_SIZE, VOXEL_HEIGHT } from '@/core/coords'
import type { Chunk } from '@/core/chunk'
import {
  FACES,
  FACE_NORMALS,
  Face,
  FaceProfile,
  SIDE_FACE_CORNERS,
  faceProfile,
  isPlanarTop,
  topDiagonal,
  oppositeFace,
  profileFromCorners,
  voxelTopCorners,
  type CornerHeights,
  type CornerIndex,
  type FaceId,
} from '@/core/shapes'
import { isAir, materialOf, type Voxel } from '@/core/voxel'
import type { VoxelMap } from '@/core/voxelMap'
import { MeshBuilder, cellJitter, type Vec3 } from './meshBuilder'
import type { ChunkMesher, ColorLookup, MeshData } from './mesher'

/** Brightness factor per face, baked into vertex colours for readability. */
const FACE_SHADE: Readonly<Record<FaceId, number>> = {
  [Face.PY]: 1,
  [Face.PX]: 0.86,
  [Face.NX]: 0.86,
  [Face.PZ]: 0.78,
  [Face.NZ]: 0.78,
  [Face.NY]: 0.6,
}

/** Corner positions within a cell, (dx, dz), in {@link CornerHeights} order. */
const CORNER_XZ: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
]

/** Corner indices in polygon order around the cell. */
const ALL_CORNERS: readonly CornerIndex[] = [0, 1, 2, 3]

/** Filters that let the culled mesher handle only part of the voxels. */
export interface CulledMesherOptions {
  /** Voxels to mesh (default: every non-air voxel). */
  readonly include?: (voxel: Voxel) => boolean
  /**
   * Whether `neighbour` hides the touching face of `self` (default: the
   * neighbour's touching face is FULL). `face` is the face of `self`.
   */
  readonly occludes?: (self: Voxel, neighbour: Voxel, face: FaceId) => boolean
}

/** Default occlusion rule: the neighbour's touching face covers the whole square. */
const fullFaceOccludes = (_self: Voxel, neighbour: Voxel, face: FaceId): boolean =>
  faceProfile(neighbour, oppositeFace(face)) === FaceProfile.FULL

/** Mesher emitting every face not hidden by a full neighbour face. */
export class CulledMesher implements ChunkMesher {
  private readonly include: (voxel: Voxel) => boolean
  private readonly occludes: (self: Voxel, neighbour: Voxel, face: FaceId) => boolean

  /**
   * @param colorOf Linear RGB colour of a material id.
   * @param options Optional filters (used by the hybrid smooth/blocky setup).
   */
  constructor(
    private readonly colorOf: ColorLookup,
    options: CulledMesherOptions = {},
  ) {
    this.include = options.include ?? ((): boolean => true)
    this.occludes = options.occludes ?? fullFaceOccludes
  }

  /** Mesh one chunk; see the module comment for the rules. */
  mesh(map: VoxelMap, chunk: Chunk): MeshData {
    const out = new MeshBuilder()
    const ox = chunk.cx * CHUNK_SIZE
    const oy = chunk.cy * CHUNK_SIZE
    const oz = chunk.cz * CHUNK_SIZE

    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          const voxel = chunk.get(lx, ly, lz)
          if (isAir(voxel) || !this.include(voxel)) continue
          // Neighbours inside the chunk are read directly (fast path); only
          // border voxels go through the map's chunk lookup.
          const neighbourAt = (dx: number, dy: number, dz: number): number => {
            const nx = lx + dx
            const ny = ly + dy
            const nz = lz + dz
            const inChunk =
              nx >= 0 && ny >= 0 && nz >= 0 && nx < CHUNK_SIZE && ny < CHUNK_SIZE && nz < CHUNK_SIZE
            return inChunk ? chunk.get(nx, ny, nz) : map.get(ox + nx, oy + ny, oz + nz)
          }
          this.meshVoxel(out, neighbourAt, ox + lx, oy + ly, oz + lz, voxel)
        }
      }
    }
    return out.toMeshData()
  }

  /** Emit the visible faces of the voxel at world voxel coordinates (x, y, z). */
  private meshVoxel(
    out: MeshBuilder,
    neighbourAt: (dx: number, dy: number, dz: number) => number,
    x: number,
    y: number,
    z: number,
    voxel: number,
  ): void {
    const corners = voxelTopCorners(voxel)
    const base = this.colorOf(materialOf(voxel))
    const jitter = cellJitter(x, y, z)

    for (const face of FACES) {
      const own = profileFromCorners(corners, face)
      if (own === FaceProfile.NONE) continue

      const isSlopedTop = face === Face.PY && own !== FaceProfile.FULL
      if (!isSlopedTop) {
        const n = FACE_NORMALS[face] ?? [0, 0, 0]
        const neighbour = neighbourAt(n[0], n[1], n[2])
        if (this.occludes(voxel, neighbour, face)) continue
      }

      const shade = FACE_SHADE[face] * jitter
      const color: Vec3 = [base[0] * shade, base[1] * shade, base[2] * shade]
      const outward = FACE_NORMALS[face] ?? [0, 1, 0]
      for (const polygon of facePolygons(face, corners, x, y, z))
        out.polygon(polygon, outward, color)
    }
  }
}

/**
 * Polygons of one face in world units. Vertical faces go from the voxel
 * bottom up to the corner heights; a corner at height 0 collapses, turning
 * the quad into a triangle (slope sides). A non-planar top (corner wedge,
 * saddle) is split into two triangles along `topDiagonal()`, the same split
 * used by picking and the highlight.
 */
function facePolygons(
  face: FaceId,
  corners: CornerHeights,
  x: number,
  y: number,
  z: number,
): Vec3[][] {
  const y0 = y * VOXEL_HEIGHT
  const corner = (i: number, h: number): Vec3 => {
    const [dx, dz] = CORNER_XZ[i] ?? [0, 0]
    return [x + dx, y0 + h * VOXEL_HEIGHT, z + dz]
  }

  if (face === Face.NY) return [ALL_CORNERS.map((i) => corner(i, 0))]
  if (face === Face.PY) {
    const top = (i: CornerIndex): Vec3 => corner(i, corners[i])
    if (isPlanarTop(corners)) return [ALL_CORNERS.map(top)]
    return topDiagonal(corners) === 0
      ? [
          [top(0), top(1), top(2)],
          [top(0), top(2), top(3)],
        ]
      : [
          [top(1), top(2), top(3)],
          [top(1), top(3), top(0)],
        ]
  }

  const pair = SIDE_FACE_CORNERS[face]
  if (!pair) return []
  const [a, b] = pair
  const vertices: Vec3[] = [corner(a, 0), corner(b, 0)]
  if (corners[b] > 0) vertices.push(corner(b, corners[b]))
  if (corners[a] > 0) vertices.push(corner(a, corners[a]))
  return [vertices]
}
