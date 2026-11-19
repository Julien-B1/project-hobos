/**
 * Chunk meshing contract.
 *
 * Layer: render, but deliberately free of Three.js imports: meshers produce
 * plain typed arrays, so they can be unit-tested in Node and swapped (the
 * current culled mesher can later be replaced by a greedy mesher behind the
 * same interface). `chunkRenderer.ts` turns `MeshData` into GPU buffers.
 */
import type { Chunk } from '@/core/chunk'
import type { VoxelMap } from '@/core/voxelMap'

/**
 * Indexed triangle mesh in world units. Vertex attributes are flat arrays of
 * 3 components per vertex; triangles are counter-clockwise seen from the
 * side their normal points to (Three.js front faces).
 */
export interface MeshData {
  /** Vertex positions (x, y, z), world units. */
  readonly positions: Float32Array
  /** Vertex normals, unit length. */
  readonly normals: Float32Array
  /** Vertex colours (r, g, b), linear colour space, 0..1. */
  readonly colors: Float32Array
  /** Triangle vertex indices, 3 per triangle. */
  readonly indices: Uint32Array
  /**
   * Optional per-vertex shader data, 8 per vertex, uploaded as two vec4
   * attributes (`weightsA`, `weightsB`). Terrain layer: material weights
   * (channels of `TERRAIN_CHANNELS`, zero-padded). Water layer: channel 0
   * is the water depth above the bed, in world units. Foliage layer:
   * card data for the billboard shader (texture coordinates, corner offset,
   * half size, canopy centre; see `treeMesher.ts`). Scatter layer: card data
   * for the scatter shader (see `scatterMesher.ts`).
   */
  readonly weights?: Float32Array
}

/** Builds the mesh of one chunk. Implementations must only read the map. */
export interface ChunkMesher {
  /**
   * Mesh `chunk`. `map` gives access to neighbour voxels across chunk
   * borders (for face culling).
   */
  mesh(map: VoxelMap, chunk: Chunk): MeshData
}

/** Material id -> linear RGB colour lookup, injected into meshers. */
export type ColorLookup = (materialId: number) => readonly [number, number, number]

/** True when the mesh has no triangle. */
export function isEmptyMesh(data: MeshData): boolean {
  return data.indices.length === 0
}

/** Render layers of a chunk, each drawn with its own material. */
export const MESH_LAYERS = ['terrain', 'blocks', 'water', 'foliage', 'scatter', 'props'] as const

/**
 * One render layer: `terrain` (faceted ground), `blocks` (wood structures,
 * tree trunks, or everything in blocky mode), `water` (transparent surface),
 * `foliage` (alpha-tested leaf cards), `scatter` (ground decoration cards:
 * grass tufts, reeds, fallen leaves...) and `props` (small low-poly rocks).
 * Scatter and props are decoration only: not pickable.
 */
export type MeshLayer = (typeof MESH_LAYERS)[number]

/** Meshes of one chunk, one per layer (possibly empty). */
export type LayeredMeshData = Readonly<Record<MeshLayer, MeshData>>

/** Builds every render layer of a chunk. Implementations must only read the map. */
export interface LayeredMesher {
  /** Mesh `chunk`; `map` gives access to neighbours across chunk borders. */
  mesh(map: VoxelMap, chunk: Chunk): LayeredMeshData
}

/** A mesh without any triangle. */
export const EMPTY_MESH: MeshData = {
  positions: new Float32Array(0),
  normals: new Float32Array(0),
  colors: new Float32Array(0),
  indices: new Uint32Array(0),
}

/**
 * Concatenate two meshes (indices of `b` are offset). Weights are kept when
 * either mesh has them; the other mesh's vertices get zero weights.
 */
export function mergeMeshData(a: MeshData, b: MeshData): MeshData {
  if (isEmptyMesh(b)) return a
  if (isEmptyMesh(a)) return b
  const offset = a.positions.length / 3
  const concat = (x: Float32Array, y: Float32Array): Float32Array => {
    const out = new Float32Array(x.length + y.length)
    out.set(x)
    out.set(y, x.length)
    return out
  }
  const indices = new Uint32Array(a.indices.length + b.indices.length)
  indices.set(a.indices)
  for (let i = 0; i < b.indices.length; i++)
    indices[a.indices.length + i] = (b.indices[i] ?? 0) + offset
  const weightsOf = (m: MeshData): Float32Array =>
    m.weights ?? new Float32Array((m.positions.length / 3) * 8)
  return {
    positions: concat(a.positions, b.positions),
    normals: concat(a.normals, b.normals),
    colors: concat(a.colors, b.colors),
    indices,
    ...(a.weights || b.weights ? { weights: concat(weightsOf(a), weightsOf(b)) } : {}),
  }
}

/**
 * Surface pattern of blocks-layer geometry, stored per vertex in weight
 * channel 0 and drawn by the blocks shader.
 */
export const BlockLook = {
  PLAIN: 0,
  /** Wooden planks with grain and seams. */
  PLANKS: 1,
  /** Stone bricks with mortar. */
  BRICKS: 2,
  /** Tree bark with vertical streaks. */
  BARK: 3,
  /** Plain wood: grain only, no seams (beams, single planks). */
  WOOD: 4,
  /** Rubble masonry: irregular courses of large dressed stones. */
  MASONRY: 5,
  /** Plain stone: mottled, no joints (slabs, stepping stones). */
  STONE: 6,
  /** Twisted rope: fine diagonal strands. */
  ROPE: 7,
} as const
