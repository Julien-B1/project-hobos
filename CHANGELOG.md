# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Structures (ADR-007): parametric map objects that stamp gameplay voxels
  and are drawn by a mesher per kind (`core/structures`, `StructureKind`,
  `StructureRegistry`, `StructureSet`; `render/structures`,
  `StructureMesher`), with closed geometric primitives
  (`render/geometry/primitives.ts`: box, beam, tube, catenary). First kind:
  the wooden beam bridge (trestle bents, stringers, planks, railings),
  replacing the voxel bridge of the kitchen-sink canal. `TestMap` carries
  its `structures`; new `WOOD` blocks look (grain without seams).
- Screenshots tooling: `make screenshots` captures the app in headless
  Chromium (Playwright 1.64.1, in the dev image) into `screenshots/`;
  `?cam=x,z,distance,yaw` frames the camera at start.
- `StructureKind.surfaceAt`: the walking surface of a structure when it
  differs from its voxels (sagging rope deck); the hover cursor follows it.
- Six more crossing kinds: stone arch bridge (humpbacked deck on SLOPE
  voxels, segmental voussoir arch, spandrels, parapets), slab bridge
  (piers with cutwaters, one slab per bay), rope bridge (sagging deck
  shared by voxels and mesh, posts, guy ropes, foot and hand ropes,
  suspenders), fallen log (root plate, branch stubs), stepping stones and
  ford (raised gravel bed, boulders, marker posts). New primitives
  (`hexahedron`, `slabStone`) and blocks looks (`MASONRY`, `STONE`,
  `ROPE`).
- River crossings on generated maps: `measureCrossing` picks the deck
  level meeting both banks flush (the span reaches up the lower bank's
  slope; in a canyon, the plateau: the bridge spans the valley) and
  measures the site, `CROSSING_RULES` and `pickCrossing` choose a fitting
  kind with the seed; the organic map always crosses its river once (unless
  it is a lake from edge to edge), at the best site (short span, away from
  the map's edges, level approaches rather than the foot of a slope or a
  cliff), trees keep clear of the crossing.
- Bridges showcase map (`?map=bridges`, 100 x 24): a river along the map
  crossed by every kind, each slot with the river width and depth that suit
  it (a gorge for the rope bridge) and a path across.
- Map picker (bottom right): switch the test map, seed (random seed
  button) and size of procedural maps without reloading. The canvas is
  remounted (old engine and input bindings disposed); time of day, cut and
  grid carry over, and the URL is updated with `history.replaceState` so a
  reload or shared link reproduces the map. Camera shortcuts ignore keys
  typed into form fields.
- Kitchen-sink map (`?map=kitchen-sink`, 40 x 32): hand-made sample board,
  one plot per element: ground swatches, wedge mound, one tree of each
  kind, brick arch, brick ramp and platform, rock mesa with a cave, pond
  with dock, canal with path and wooden bridge.
- `STONE_BRICK` material (built structures, drawn as blocks) and patterned
  blocks material: wood planks, stone bricks, bark (`BlockLook`,
  `render/blocksMaterial.ts`).
- Time of day: 8 lighting presets (dawn to late night; sun by day, moon at
  night) with a picker in the UI and `?time=<id>`; shadows and the water
  sheen follow the light.
- Tree kinds: oak, pine (needles, cone), birch (pale leaves, white bark
  with marks), bush; new `NEEDLES` and `BIRCH_LEAVES` materials,
  `isFoliageMaterial`, `treeKind`; the organic map grows all of them.
- Foliage wind: cards sway (gust wave, per-tree phase) and flutter; still
  cards in the shadow pass.
- Light ground scatter derived from the voxels (new `scatter` and `props`
  layers, not pickable): sparse grass tufts and flowers, fallen leaves only
  under tree canopies, smooth stones only on rocky ground, a few reeds and
  algae.
- Very light hue drift of the grass.
- Cut slider (vertical, left edge, continuous height): hides everything
  above a height (all layers and their shadows, picking included) to open
  caves and look under roofs. What the cut slices shows as an opaque,
  hatched section by stencil capping (`sectionCap.ts`): the solid layers
  (terrain, blocks and trunks, stones) count back and front faces below
  the cut into the stencil buffer, and a plane at the cut height is drawn
  where the count says "inside", so its outline is exactly the cut of the
  drawn meshes (crags, round trunks, stones); every layer tests the
  stencil, so nothing shows through the section. The terrain is closed by a floor face under the lowest
  run. Built voxels also get the section of their solid in their own
  colour, slopes included (`CapMesher`, `CutCap`, `Engine.setCutHeight`).
- Cave mouths and arches: the facade around the opening takes the earth
  look of the surrounding slopes (no bare grey rock framing the hole);
  vaults and walls inside are rock only, never earth (`FaceLook`,
  `LOOK_SHIFT`); stronger crags within 2 cells of an overhang, for an
  irregular outline.
- Openings in faceted terrain: runs around a corner touched by a covered
  run (cave or arch floor) only join when they agree on it, so cave mouths
  and natural arches stay open with a vertical face around them.
- Craggy rock: where the relief is marked (cliffs, cave mouths, arches),
  terrain faces are cut along the tetrahedra of the half-cell lattice and
  displaced by noise offsets interpolated linearly per tetrahedron, so the
  surface stays watertight; flat-shaded (`Crag`, `meshing/polygonSplit.ts`,
  test helper `unmatchedEdges`).
  Texture projection and the slope rule come from the undisplaced face
  (two extra weight channels, `PROJECTION_CHANNEL`, `UP_CHANNEL`), so
  the small facets keep one coherent texture.
- Dev and preview servers gzip their responses (`tooling/gzip.ts`, Node
  zlib, no dependency); pre-bundled dependencies are minified and served
  without their inline source maps: Three.js and Vue go from about 11 MB
  to about 0.4 MB on the wire.
- Vaulted undersides: cave and arch roofs drop towards their side walls
  with a small random offset (`TerrainField.cornerBottoms`), so openings
  are irregular arches instead of rectangles.
- Real trees: tree voxels (WOOD trunk topped by LEAVES, `core/trees.ts`)
  are drawn by `TreeMesher` as round tapered trunks with root flare and
  branches, and alpha-tested leaf cards (procedural leaf cluster atlas,
  alpha to coverage, canopy-volume normals, per-card tint and fake
  occlusion, dappled shadows). New `foliage` render layer;
  `mergeMeshData`; per-call filter on `CulledMesher.mesh`.
- Terrain detail: procedural 512² detail texture (grass clumps, pebbles,
  rock cracks, sand ripples) and height-based blending between materials
  for crisp, irregular, random-looking transitions (3 fetches per pixel).
- Battle-map grid on terrain, blocks and water, drawn in the shaders
  (anti-aliased, fades at far zoom and on steep faces); `G` toggles it,
  `?grid=off` starts hidden.
- Hover highlight on faceted terrain drawn by the terrain shader (cell
  square, height band, ground faces only): covers exactly the drawn
  ground, crags included, cut with it; light fill with a thin border.
  Block highlight cut like the scene, lighter.
- Performance probes (debug): keys `1` to `6` switch off shadows, foliage,
  scatter and stones, water, terrain, or halve the resolution, to read
  each part's cost in the HUD's GPU time; the HUD flags the WebGL 2 GPU
  timer as an upper bound.
- Debug HUD figures: map, resolved seed, mesher, shadow quality, drawing
  buffer size, GPU time per frame and GPU load (timestamp queries), estimated
  page VRAM, draw calls, triangles, shadow passes and camera pose
  (`render/frameStats.ts`). `TestMap.seed` exposes the seed actually used.
- Water material: translucent physical surface (IOR 1.33) whose colour and
  opacity follow the water depth carried by each vertex (soft shoreline
  fade, nearly clear shallows, dark deep water), a noisy foam band and
  gently scrolling ripples from the shared noise texture (2 fetches per
  water pixel, no refraction pass).
- Sun shadows (default `high`): one PCF shadow map framed on the camera target (size in
  discrete steps, snapped to texels, no shimmering), rendered only when the
  framing changes or chunks are rebuilt. `?shadows=off|low|high` (`low`:
  2048²; `high`: 4096², default).
- Neutral tone mapping (Khronos PBR Neutral).
- Smooth shading of faceted terrain tops: per-corner normals averaged over
  the connected facets (`TerrainField.cornerNormals`, `facetCornerNormal`),
  continuous across chunks; walls keep flat normals.

- Terrain material (TSL): per-vertex blended material weights averaged per
  lattice point (`TerrainField.cornerWeights`), shaded with 2 fetches of a
  small precomputed tileable noise texture projected in world space; noisy,
  sharpened material borders; dirt and rock on steep facets. No grid
  pattern, no per-pixel noise evaluation. Blocks get a light noise variation.

- Seeded noise utilities in core: lattice hash, smooth value noise, fBm,
  smoothstep. Deterministic across platforms.
- Organic test map (`?map=organic`, `?seed=<n>`): 128 x 128 procedural
  terrain with fractal hills and plains, a meandering river with blended
  banks and lakes, sand shores, rocky steep ground and peaks, automatic
  slopes on one-level steps, and trees (trunk + leaf canopy) denser in
  forest patches. New `LEAVES` material.
- `CORNERS` shape: wedge whose orientation bits select the raised corners
  (outer and inner corners, saddles), with a shared top triangulation rule
  (`topDiagonal`) for meshing, picking and the highlight;
  `shapeForCornerMask` picks FULL / SLOPE / CORNERS for a mask.
- Faceted low-poly terrain rendering (default): `TerrainMesher` draws terrain
  materials as flat-shaded facets whose corner heights are shared averages
  of connected neighbouring runs (`core/terrainSurface.ts`), with walls only
  where needed and overhang undersides; water drawn as a flat plane so
  shorelines follow the facets; wood and leaves stay blocks
  (`HybridMesher`); `?mesher=blocky` for exact blocks.
- `isTerrainMaterial()` classification; `resolveColumnHit()` for picking on
  facets; hover highlight draped on the terrain; organic map cliff zones
  with terraced plateaus and steep faces.

### Changed

- Maps are sized for one encounter (battle map, 1 cell = one 5 ft square):
  the reference map is 32 x 32 (was 64 x 64, same features), the organic
  map defaults to 32 x 32 (was 128 x 128) with features rescaled (hills,
  stream, cliffs, rock patches, forests); `?size=<cells>` (8 to 128) for
  other sizes; the HUD shows the map size.
- Water: no view-dependent specular (the sun spot moved with the camera);
  a view-independent sun sheen and ripple glints instead, identical from
  every side.
- Grid: thin translucent lines (box-filtered: anti-aliased at every zoom,
  no moiré, never hidden by the zoom), visible on all slopes except
  near-vertical faces, readable on dark ground.
- Trees: leaf cards always face the camera (and the sun in the shadow
  pass) for full, fluffy canopies; per-pixel canopy normals; denser leaf
  clusters; thicker trunks.

- Chunks are drawn in three render layers (terrain, blocks, water), each
  with its own shared material; maximum zoom-out distance raised to 240.

- Organic map smoothing: wider relief, blurred height field and wider river
  banks (no height step above 2 levels), and corner-aware wedges instead of
  single-axis slopes, so diagonals and corners no longer show notches.
- Organic map: height steps limited to one level between neighbours
  (distance transform), so the terrain is continuous; rock comes in noise
  patches on hills instead of following steepness; sand only on beds and
  beaches near water.
- Lighting: lower sun from the north-west, softer ambient, so gentle slopes
  read better.
- Dirty tracking marks the chunks above and below plus side neighbours
  within 2 voxels (diagonals included), as the faceted mesher reads whole
  column runs.
- `resolveHit` searches inwards along the normal when the hit point is in
  front of the voxel (faceted surfaces).
- `ChunkRenderer.update()` reports only chunks whose mesh actually changed.
- Organic map step limit raised to 2 levels (8 in cliff zones).

- Culled mesher reads in-chunk neighbours directly instead of through the
  map (about 3x fewer chunk lookups when meshing large maps).

### Fixed

- Ford: boulders rest on the gravel (no longer floating) in line with the
  marker posts, on one extra gravel cell each side, so the whole crossing
  width stays clear.
- Hover over shallow water (2 levels or less: fords, shallow banks)
  targets the bed, where one walks (`wadeThrough`); deep water keeps its
  surface.
- Ground decoration needs 4 free levels above the ground and its
  neighbours (water and canopies aside) and stays out of structures'
  bounds: reeds no longer poke through bridge decks.
- Water around stepping stones: columns whose water is replaced by a
  structure voxel take the surface from their neighbours.
- Fixed per-pixel cost of every frame: tone mapping and sRGB encoding are
  done at the end of each material (`outputEncoding.ts`), so the renderer
  draws straight into the canvas instead of a multisampled half-float
  target resolved and copied by a full-screen pass (measured: the whole
  11 ms per frame at 1906 x 1271 in WebGL 2 was that fixed cost).
- Water no longer receives shadows: they fell on the surface and on the
  bed seen through it, twice and offset; they now land on the bed only.
- No more lit strip between an object's foot and its shadow: blocks,
  trunks and stones cast shadows from their front faces (Three's default
  is the back faces, whose depth next to the foot is almost the ground's,
  within the shadow bias).
- Foliage no longer shows hard shadow edges (one shadow lookup per card);
  rocks and walls away from the sun no longer go black (upward-biased rock
  normals, lifted ambient from below); the hover highlight lies exactly on
  the rendered ground (computed from the terrain model, not rays).
- Shadows no longer detach from the foot of objects (smaller biases); block
  sides in shadow are no longer almost black (lighter baked face shade).
- Sand borders no longer comb into stripes (blend height from a neutral
  grain instead of the ripples); far grass tufts no longer blur into blobs.
- The map sides end on a flat bottom instead of following the terrain one
  chunk below its top.

## [0.2.0] - 2026-11-19

### Added

- Voxel map core: 16-bit voxel encoding (material / shape / orientation),
  material ids, 16^3 chunks, sparse `VoxelMap` with lazy chunk creation,
  removal of emptied chunks and dirty-chunk tracking including border
  neighbours. Fully unit-tested, negative coordinates included.
- Shape registry (`FULL`, `SLOPE` in 4 orientations) based on top corner
  heights, with derived face profiles for culling and top-height sampling.
- Surface detection per column (`columnSurfaces`), supporting several
  surfaces in one column.
- Deterministic reference map: base ground, river trench with low bank path,
  bridge over path and river with slope ramps, cliff with a slope ramp, hill
  crossed by a tunnel. Wiki page _Reference-Map_.
- Chunk meshing: `ChunkMesher` interface producing typed arrays, `CulledMesher`
  with face culling against neighbours (across chunks), dedicated slope
  geometry (triangular sides, sloped top), per-material vertex colours.
- `ChunkRenderer`: one mesh per chunk, rebuilt from the map's dirty set.
- Test map catalog with `?map=reference|flat`; flat voxel test map.
- Debug HUD shows the number of chunk meshes. Wiki page _Extending_.
- Surface picking: `core/surface.resolveHit()` turns a ray hit (point and
  normal) into the touched voxel and the targeted surface (top face, side
  face climbs to the stack top, ceiling maps to the floor below). The
  highlight follows the surface, tilted on slopes; the HUD shows voxel,
  material, shape, face and surface. Tests cover the bridge-over-path
  column, slopes, a cliff face and the tunnel.
- Debug edits: right click removes the voxel under the cursor, `Shift` +
  left click places a stone voxel on the surface. Only the edited chunk (and
  face neighbours for border voxels) is rebuilt; the HUD shows each rebuild
  batch with chunk keys and time.

### Changed

- The engine renders a voxel map instead of the step 1 flat grid; default
  camera distance raised to frame the 64 x 64 reference map.

- Branch model: `master` holds only the README, work happens on `dev`.

### Removed

- Step 1 flat grid (`core/generators/flatGrid`, `render/gridMesh`),
  superseded by the flat voxel test map.

### Fixed

- Organic map cliff terraces could sink below the water level, flooding
  them into one-cell channels along contour lines; terraces now start above
  the water.

- Faceted terrain walls are now exact when this cell's top and the
  neighbour's top cross along an edge (the edge is split at the crossing);
  before, such walls closed at the wrong place and left slits through which
  the water behind the banks showed. T-junction tolerant watertightness test
  on a full organic map.

- `make wiki-publish` failed when the git identity was configured only in the
  repository (not globally): the temporary wiki clone now reuses it.

## [0.1.0] - 2026-11-19

### Added

- Docker-based development environment: `docker/Dockerfile.dev`,
  `compose.yaml`, `Makefile` entry point, optional VS Code dev container.
- Project documentation skeleton: README, agent guide (`AGENTS.md`),
  wiki sources in `docs/wiki/` and `scripts/publish-wiki.sh`.
- Project scaffold: Vite 8, Vue 3, TypeScript 6 (strict), Vitest, ESLint flat
  config with layer import rules (`core` / `render` / `app`) and mandatory
  TSDoc on `core` and `render` exports, Prettier.
- Rendering foundation: `WebGPURenderer` with automatic WebGL 2 fallback,
  backend detection shown in the debug HUD, `?forceWebGL=1` URL switch,
  resize handling, render loop with FPS counter, sun + ambient lighting.
- RO-style orbit camera: locked pitch (40° by default), free rotation by
  left drag, animated 45° snaps (`A`/`E` on AZERTY), bounded animated zoom,
  target panning by middle drag or `ZQSD`/arrows (layout-independent key
  codes). Keyboard zoom (`R`/`F`, numpad `+`/`-`) and animated view reset
  (`C` or `Home`: home target, initial yaw without extra spins, initial
  zoom). Camera maths unit-tested.
- Flat 32 x 32 test grid (`core/generators/flatGrid.ts`) rendered as a
  checker mesh; hover picking by raycast highlights the targeted cell and the
  debug HUD shows its coordinates. Core coordinate helpers
  (`core/coords.ts`: cell and half-height voxel level conversions) with tests.

[Unreleased]: https://github.com/Julien-B1/project-hobos/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Julien-B1/project-hobos/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Julien-B1/project-hobos/releases/tag/v0.1.0
