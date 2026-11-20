# Extending the engine

Recipes for the most common extensions. Each one lists every file to touch;
keep tests and docs in the same commit.

## Add a material

1. `src/core/materials.ts`: append an id to `Material`. Never renumber
   existing ids.
2. `src/render/materialPalette.ts`: give it an sRGB colour in `PALETTE`
   (TypeScript fails until you do).
3. Decide whether it is terrain (faceted) or blocky: add it to the
   `TERRAIN` set in `src/core/materials.ts` if it is ground.
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
   `HybridMesher` combines the faceted terrain mesher and the blocky mesher with
   `mergeMeshData`).
3. Check watertightness with `openStretches()` (`render/meshing/watertight.ts`,
   tolerant to T-junctions), as `terrainMesher.test.ts` does on a full map,
   or `unmatchedEdges()` for displaced meshes (crags, structures), whose
   T-junction pieces are collinear only up to rounding. Closed shells
   matter: the cut section's stencil count needs them.
4. If the mesher reads further than 2 voxels beyond its chunk, raise
   `DIRTY_MARGIN` in `src/core/voxelMap.ts`.

## Add a structure kind (a bridge, a building...)

See [[Structures]] (section "Adding a kind"): a core kind (`defineKind`:
parameter guard, bounds, stamp, optional `surfaceAt`) registered in
`defaultStructureKinds()`, and a render mesher (`defineMesher`, closed
primitives from `render/geometry/primitives.ts`) registered in
`defaultStructureMeshers()`. Test the stamp (walkable, inside the bounds)
and the mesh (closed with `unmatchedEdges`, deterministic). The registries
are the only lists to edit: the engine, the chunk meshers and the
generators do not change.

## Add a test map

1. Write a deterministic generator in `src/core/generators/` returning a
   `VoxelMap` (and a `StructureSet` if it places structures), with tests.
2. Register it in `src/core/generators/catalog.ts` (`TEST_MAP_IDS` and
   `createTestMap`: footprint, camera home, structures). The map picker
   lists it automatically.
3. Open it with `?map=<id>`; frame a view with `&cam=x,z,distance,yaw`
   and capture it with `make screenshots VIEWS=...`.

## Add a character model

1. Export a skinned glTF binary (Y up, facing +Z, feet at the origin,
   clips in place: no root motion).
2. Put it in `assets-src/models/name.glb` and run `make models`. First,
   when `tooling/blender/name.py` exists, headless Blender runs it on the
   model (see below). Then, on the
   host, `tooling/compress_glb.py --flat 12 --max-size 1024 --texture-only` turns the
   painted texture into 12 flat colours for the cel shading, at most
   1024 pixels wide, as WebP
   (needs Python 3, numpy, ffmpeg); in the container, `gltfpack -cc -vpf
-vtf` compresses geometry and animations (meshopt; positions and UVs
   stay floats: the outline offset and the shade tint read them raw). The
   result lands in `src/assets/models/name.glb`; the engine's loader has
   the meshopt decoder.
3. Import it with `?url` and pass the idle and walk clip names to
   `Engine.spawnCharacter` (see `GameCanvas.vue`). If the model is not
   about 1 unit tall, or its walk is faster or slower, adjust
   `MODEL_HEIGHT` and `CLIP_STRIDE_SPEED` in `render/actors/character.ts`
   (the stride speed is how fast a planted foot slides back in the walk
   clip, in model units per second). A `run` clip is optional (its
   stride is `RUN_CLIP_STRIDE_SPEED`); `arms` (`ArmStyle`) sets the arm
   spacing and swing for the body and outfit. Add its id to `CHARACTER_IDS`
   (`app/config.ts`) and `CHARACTERS` (`GameCanvas.vue`).
4. Cloth and hair that should swing: a Blender script
   (`tooling/blender/name.py`, run as
   `blender -b --python script.py -- in.glb out.glb`) adds chains of bones
   named `Spring_<Family><n>_<k>`, each ending with a `..._end` leaf bone,
   and weights the cloth vertices onto them (see `wizard.py`: skirt panels
   found as loose parts away from the legs, bell sleeves under the
   forearm, hair behind the neck). The family (`Skirt`, `Sleeve`, `Hair`)
   picks the stiffness, gravity and drag in
   `DEFAULT_SPRING_PROFILE` (`render/actors/springBones.ts`), which also
   lists the body colliders (capsules between leg and spine bones).
