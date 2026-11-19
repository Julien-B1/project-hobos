/**
 * Smooth terrain mesher (naive surface nets on a blurred density field).
 *
 * Layer: render (no Three.js import, unit-tested).
 *
 * Why: per-voxel shapes can only rise one level per cell, so steep or
 * diagonal terrain shows stairs and every corner stays square. This mesher
 * derives a smooth surface from the voxels instead; the voxel grid stays the
 * source of truth for game logic (surfaces, picking resolution).
 *
 * Steps for one chunk:
 * 1. Density: read voxels with a 2-voxel margin around the chunk into a
 *    padded array. Included voxels get their solid volume fraction (full = 1,
 *    slope = 0.5, ... from the shape's corner heights); others count as empty.
 * 2. Blur: a separable 3 x 3 x 3 box blur rounds edges and corners while
 *    keeping flat ground exactly on voxel boundaries (the blur is symmetric).
 * 3. Vertices: one per *dual cell* (the cube between 8 voxel centres) that
 *    the iso-surface (density 0.5) crosses, placed at the average of the
 *    crossing points on its 12 edges. Normal = minus the density gradient.
 * 4. Quads: for each edge between two voxel centres whose densities straddle
 *    the iso value, one quad joins the 4 dual cells around that edge. An edge
 *    belongs to the chunk holding its lower voxel, so no quad is emitted
 *    twice; vertices computed by two chunks are identical (same field), so
 *    chunk meshes join without seams.
 *
 * Because of the blur, a voxel change affects meshes up to 2 voxels away
 * (see `DIRTY_MARGIN` in `core/voxelMap.ts`).
 */
import type { Chunk } from '@/core/chunk'
import { CHUNK_SIZE, VOXEL_HEIGHT } from '@/core/coords'
import { voxelTopCorners } from '@/core/shapes'
import { isAir, materialOf, type Voxel } from '@/core/voxel'
import type { VoxelMap } from '@/core/voxelMap'
import { MeshBuilder, cellJitter, type Vec3 } from './meshBuilder'
import type { ChunkMesher, ColorLookup, MeshData } from './mesher'

/** Voxels read beyond each side of the chunk. */
const PAD = 2
/** Padded edge length of the density arrays. */
const N = CHUNK_SIZE + 2 * PAD
/** Iso value of the surface. */
const ISO = 0.5
/** Dual cells handled per axis: local min corner from -1 to 15. */
const DUAL = CHUNK_SIZE + 1

/** Options for {@link SurfaceNetsMesher}. */
export interface SurfaceNetsOptions {
  /** Voxels that form the smooth terrain; everything else counts as empty. */
  readonly include: (voxel: Voxel) => boolean
  /** Linear RGB colour of a material id. */
  readonly colorOf: ColorLookup
}

/** The 12 edges of a dual cell as pairs of corner indices (corner = dx + 2*dy + 4*dz). */
const CELL_EDGES: readonly (readonly [number, number])[] = [
  [0, 1],
  [2, 3],
  [4, 5],
  [6, 7],
  [0, 2],
  [1, 3],
  [4, 6],
  [5, 7],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
]

/** Smooth mesher for natural terrain. */
export class SurfaceNetsMesher implements ChunkMesher {
  constructor(private readonly options: SurfaceNetsOptions) {}

  /** Mesh the smooth part of one chunk. */
  mesh(map: VoxelMap, chunk: Chunk): MeshData {
    const ox = chunk.cx * CHUNK_SIZE
    const oy = chunk.cy * CHUNK_SIZE
    const oz = chunk.cz * CHUNK_SIZE
    const { raw, materials } = this.sample(map, chunk, ox, oy, oz)
    const density = blur(raw)

    /** Padded array index of local voxel (lx, ly, lz), each in [-PAD, 16 + PAD). */
    const at = (lx: number, ly: number, lz: number): number =>
      lx + PAD + (ly + PAD) * N + (lz + PAD) * N * N

    // Step 3: one vertex per crossed dual cell.
    const vertexPos: (Vec3 | null)[] = new Array<Vec3 | null>(DUAL * DUAL * DUAL).fill(null)
    const vertexNormal: Vec3[] = new Array<Vec3>(DUAL * DUAL * DUAL)
    const vertexColor: Vec3[] = new Array<Vec3>(DUAL * DUAL * DUAL)
    const dualIndex = (i: number, j: number, k: number): number =>
      i + 1 + (j + 1) * DUAL + (k + 1) * DUAL * DUAL

    const corner = new Float64Array(8)
    for (let k = -1; k < CHUNK_SIZE; k++) {
      for (let j = -1; j < CHUNK_SIZE; j++) {
        for (let i = -1; i < CHUNK_SIZE; i++) {
          let inside = 0
          for (let c = 0; c < 8; c++) {
            const d = density[at(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1))] ?? 0
            corner[c] = d
            if (d >= ISO) inside++
          }
          if (inside === 0 || inside === 8) continue

          // Average of the iso crossings on the cell edges (local cell units).
          let sx = 0
          let sy = 0
          let sz = 0
          let count = 0
          for (const [a, b] of CELL_EDGES) {
            const da = corner[a] ?? 0
            const db = corner[b] ?? 0
            if (da >= ISO === db >= ISO) continue
            const t = (ISO - da) / (db - da)
            sx += (a & 1) + ((b & 1) - (a & 1)) * t
            sy += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t
            sz += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t
            count++
          }
          // Voxel centres sit at +0.5; world y is scaled by the voxel height.
          const wx = ox + i + 0.5 + sx / count
          const wy = (oy + j + 0.5 + sy / count) * VOXEL_HEIGHT
          const wz = oz + k + 0.5 + sz / count
          const index = dualIndex(i, j, k)
          vertexPos[index] = [wx, wy, wz]
          vertexNormal[index] = cellNormal(corner)
          vertexColor[index] = this.cellColor(materials, at, i, j, k, raw)
        }
      }
    }

    // Step 4: quads around crossed edges owned by this chunk.
    const out = new MeshBuilder()
    const axes: readonly Vec3[] = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let y = 0; y < CHUNK_SIZE; y++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          const d0 = density[at(x, y, z)] ?? 0
          axes.forEach((axis, a) => {
            const d1 = density[at(x + axis[0], y + axis[1], z + axis[2])] ?? 0
            if (d0 >= ISO === d1 >= ISO) return
            // The 4 dual cells sharing this edge, in a cycle around it.
            const cells = edgeCells(a, x, y, z)
            const positions: Vec3[] = []
            const normals: Vec3[] = []
            const colors: Vec3[] = []
            for (const [i, j, k] of cells) {
              const index = dualIndex(i, j, k)
              const p = vertexPos[index]
              if (!p) return // cannot happen: a crossed edge crosses its 4 cells
              positions.push(p)
              normals.push(vertexNormal[index] ?? [0, 1, 0])
              colors.push(vertexColor[index] ?? [1, 0, 1])
            }
            // Solid on the low side: the surface faces +axis, else -axis.
            const outward: Vec3 = d0 >= ISO ? axis : [-axis[0], -axis[1], -axis[2]]
            out.smoothQuad(positions, normals, colors, outward)
          })
        }
      }
    }
    return out.toMeshData()
  }

  /** Step 1: volume fractions and materials of the padded neighbourhood. */
  private sample(
    map: VoxelMap,
    chunk: Chunk,
    ox: number,
    oy: number,
    oz: number,
  ): { raw: Float64Array; materials: Uint8Array } {
    const raw = new Float64Array(N * N * N)
    const materials = new Uint8Array(N * N * N)
    let index = 0
    for (let lz = -PAD; lz < CHUNK_SIZE + PAD; lz++) {
      for (let ly = -PAD; ly < CHUNK_SIZE + PAD; ly++) {
        for (let lx = -PAD; lx < CHUNK_SIZE + PAD; lx++, index++) {
          const inChunk =
            lx >= 0 && ly >= 0 && lz >= 0 && lx < CHUNK_SIZE && ly < CHUNK_SIZE && lz < CHUNK_SIZE
          const voxel = inChunk ? chunk.get(lx, ly, lz) : map.get(ox + lx, oy + ly, oz + lz)
          if (isAir(voxel) || !this.options.include(voxel)) continue
          raw[index] = volumeFraction(voxel)
          materials[index] = materialOf(voxel)
        }
      }
    }
    return { raw, materials }
  }

  /**
   * Colour of a vertex: the material of the highest solid voxel among the 8
   * around the dual cell (so grass rims stay green and cliffs show the
   * layers below), with a small per-cell brightness variation.
   */
  private cellColor(
    materials: Uint8Array,
    at: (lx: number, ly: number, lz: number) => number,
    i: number,
    j: number,
    k: number,
    raw: Float64Array,
  ): Vec3 {
    let material = 0
    for (let dy = 1; dy >= 0 && material === 0; dy--) {
      for (let c = 0; c < 4; c++) {
        const index = at(i + (c & 1), j + dy, k + (c >> 1))
        if ((raw[index] ?? 0) > 0) {
          material = materials[index] ?? 0
          break
        }
      }
    }
    const base = this.options.colorOf(material)
    const shade = cellJitter(i, j, k)
    return [base[0] * shade, base[1] * shade, base[2] * shade]
  }
}

/** Solid volume fraction of a voxel from its top corner heights (1 for a block). */
function volumeFraction(voxel: Voxel): number {
  const c = voxelTopCorners(voxel)
  return (c[0] + c[1] + c[2] + c[3]) / 4
}

/** Separable 3-tap box blur along x, y and z. Borders keep their values. */
function blur(source: Float64Array): Float64Array {
  let current = source
  for (const stride of [1, N, N * N]) {
    const next = new Float64Array(current.length)
    for (let index = 0; index < current.length; index++) {
      const coord = Math.floor(index / stride) % N
      if (coord === 0 || coord === N - 1) {
        next[index] = current[index] ?? 0
        continue
      }
      next[index] =
        ((current[index - stride] ?? 0) + (current[index] ?? 0) + (current[index + stride] ?? 0)) /
        3
    }
    current = next
  }
  return current
}

/**
 * Surface normal from the density gradient inside a dual cell, in world
 * space: points from dense to empty. The y component is divided by the
 * voxel height because the grid is 1 x 0.5 x 1 world units.
 */
function cellNormal(c: Float64Array): Vec3 {
  const v = (n: number): number => c[n] ?? 0
  const gx = v(1) - v(0) + v(3) - v(2) + v(5) - v(4) + v(7) - v(6)
  const gy = (v(2) - v(0) + v(3) - v(1) + v(6) - v(4) + v(7) - v(5)) / VOXEL_HEIGHT
  const gz = v(4) - v(0) + v(5) - v(1) + v(6) - v(2) + v(7) - v(3)
  const len = Math.hypot(gx, gy, gz)
  if (len === 0) return [0, 1, 0]
  return [-gx / len, -gy / len, -gz / len]
}

/**
 * The 4 dual cells around the edge from voxel (x, y, z) along `axis`
 * (0 = x, 1 = y, 2 = z), ordered as a cycle.
 */
function edgeCells(axis: number, x: number, y: number, z: number): [number, number, number][] {
  if (axis === 0) {
    return [
      [x, y - 1, z - 1],
      [x, y, z - 1],
      [x, y, z],
      [x, y - 1, z],
    ]
  }
  if (axis === 1) {
    return [
      [x - 1, y, z - 1],
      [x, y, z - 1],
      [x, y, z],
      [x - 1, y, z],
    ]
  }
  return [
    [x - 1, y - 1, z],
    [x, y - 1, z],
    [x, y, z],
    [x - 1, y, z],
  ]
}
