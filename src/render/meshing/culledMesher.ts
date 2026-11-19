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
import { isAir, materialOf } from '@/core/voxel'
import type { VoxelMap } from '@/core/voxelMap'
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

type Vec3 = readonly [number, number, number]

/** Corner indices in polygon order around the cell. */
const ALL_CORNERS: readonly CornerIndex[] = [0, 1, 2, 3]

/** Growable output buffers. */
class MeshBuilder {
  readonly positions: number[] = []
  readonly normals: number[] = []
  readonly colors: number[] = []
  readonly indices: number[] = []

  /**
   * Add a convex planar polygon (3 or 4 vertices) as a triangle fan.
   * Vertices are reordered if needed so the front face points along
   * `outward`; the stored normal is the polygon's true normal.
   */
  polygon(vertices: Vec3[], outward: Vec3, color: Vec3): void {
    if (vertices.length < 3) return
    const [a, b, c] = vertices as [Vec3, Vec3, Vec3]
    let n = cross(sub(b, a), sub(c, a))
    if (dot(n, outward) < 0) {
      vertices.reverse()
      n = [-n[0], -n[1], -n[2]]
    }
    const len = Math.hypot(n[0], n[1], n[2])
    if (len === 0) return // degenerate polygon
    const normal: Vec3 = [n[0] / len, n[1] / len, n[2] / len]

    const base = this.positions.length / 3
    for (const v of vertices) {
      this.positions.push(v[0], v[1], v[2])
      this.normals.push(normal[0], normal[1], normal[2])
      this.colors.push(color[0], color[1], color[2])
    }
    for (let i = 1; i < vertices.length - 1; i++) this.indices.push(base, base + i, base + i + 1)
  }

  toMeshData(): MeshData {
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      colors: new Float32Array(this.colors),
      indices: new Uint32Array(this.indices),
    }
  }
}

/** Mesher emitting every face not hidden by a full neighbour face. */
export class CulledMesher implements ChunkMesher {
  /** @param colorOf Linear RGB colour of a material id. */
  constructor(private readonly colorOf: ColorLookup) {}

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
          if (isAir(voxel)) continue
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
        if (faceProfile(neighbour, oppositeFace(face)) === FaceProfile.FULL) continue
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

/**
 * Small deterministic brightness variation per voxel (about +-4 %), so
 * neighbouring cells of the same material stay distinguishable.
 */
function cellJitter(x: number, y: number, z: number): number {
  // Integer hash (xorshift-multiply); only the low bits matter here.
  let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995)
  h ^= h >>> 15
  return 0.96 + ((h >>> 0) % 1000) / 12500
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
