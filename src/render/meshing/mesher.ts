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
export const MESH_LAYERS = ['terrain', 'blocks', 'water'] as const

/**
 * One render layer: `terrain` (faceted ground), `blocks` (wood, leaves, or
 * everything in blocky mode) and `water` (transparent surface).
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
