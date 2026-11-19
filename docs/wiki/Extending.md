# Extending the engine

Recipes for the most common extensions. Each one lists every file to touch;
keep tests and docs in the same commit.

## Add a material

1. `src/core/materials.ts`: append an id to `Material`. Never renumber
   existing ids.
2. `src/render/materialPalette.ts`: give it an sRGB colour in `PALETTE`
   (TypeScript fails until you do).
3. Decide whether it is natural (smooth) or built (blocky): add it to the
   `NATURAL` set in `src/core/materials.ts` if it should be smoothed.
4. Use it in a generator if needed.

## Add a height-field shape (half slab, corner slope, ...)

A height-field shape is solid from the voxel bottom up to a top surface
defined by four corner heights (see the _Conventions_ page).

1. `src/core/shapes.ts`: add an id to `Shape` and an entry at the same index
   in `SHAPES` with its `topCorners(orientation)`.
2. Nothing else for culling and meshing: face profiles and polygons are
   derived from the corners (`profileFromCorners`, `facePolygon` in
   `src/render/meshing/culledMesher.ts`).
3. Tests: profiles in `shapes.test.ts`, triangle counts and winding in
   `culledMesher.test.ts`.

## Add a non-height-field shape (stairs, arches)

The corner model cannot describe overhangs. Extend `ShapeDefinition` with
explicit face profiles and geometry, then teach `CulledMesher` to use them
when present. Keep `profileFromCorners` for height-field shapes.

## Replace the mesher (e.g. greedy meshing)

1. Implement `ChunkMesher` (`src/render/meshing/mesher.ts`): input map +
   chunk, output `MeshData` typed arrays. No Three.js import, so it stays
   unit-testable.
2. Pass it to `ChunkRenderer` in `src/render/engine.ts` (see how
   `HybridMesher` combines a smooth and a blocky mesher with
   `mergeMeshData`).
3. Reuse the closedness test of `surfaceNetsMesher.test.ts` (every triangle
   edge shared by exactly two triangles, across chunk borders).
4. If the mesher reads further than 2 voxels beyond its chunk, raise
   `DIRTY_MARGIN` in `src/core/voxelMap.ts`.

## Add a test map

1. Write a deterministic generator in `src/core/generators/` returning a
   `VoxelMap`, with tests.
2. Register it in `src/core/generators/catalog.ts` (`TEST_MAP_IDS` and
   `createTestMap`: footprint and camera home).
3. Open it with `?map=<id>`.
