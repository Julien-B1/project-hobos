# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Server deployment behind Traefik (`deploy/`): production image built on
  the server (Node build with relative URLs, then Alpine nginx with the
  Brotli module serving the precompressed files, assets cached for a
  year), Compose file with the Traefik labels for
  `labo.taverne-des-rolistes.fr/kratos/hobos/` (prefix stripped, trailing
  slash redirect, HTTPS redirect), `make deploy`, wiki page _Deployment_.
- Desktop demo: `make release` packages the production build with
  Neutralino (`@neutralinojs/neu` 11.8.0, runtime 6.10.0,
  `neutralino.config.json`) into `release/hobos/`: Windows executable
  (about 4 MB, files embedded, WebView2 so WebGPU), Linux and macOS
  binaries, plus a Linux AppImage (`hobos-x86_64.AppImage`, about
  2.3 MB: `scripts/appimage.mjs`, appimagetool 1.9.1 and type2 runtime
  20251108 pinned by SHA-256, icon in `tooling/appimage/`; the dev image
  gains the `file` package it needs). `make screenshots` steps accept a
  key press (`{ "key": "h" }`). `pnpm-workspace.yaml` leaves the build scripts of neu's
  optional dependencies off. `make models` and `make release` are phony
  targets.
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

- A playable character (`src/assets/models/fighter.glb`, a Tripo /
  Mixamo rig with an idle and a walk clip): spawned on grass in the
  largest walkable region, near the map's home point; left click selects
  it (ring at its feet), right click sends it there along the shortest
  path, walking and turning with the walk clip matched to its speed, feet
  on the drawn ground (short downward raycast; bridges and rope decks
  included, water waded). HUD line `Character`.
- Character look: sun shadow (the shadow map is redrawn every frame while
  a character is on the map) and anime-style cel shading: flat-colour
  texture (`compress_glb.py --flat 12`), one sharp light / shade boundary,
  tinted shade, rim light, outline about 1 pixel wide at any zoom in a
  darker shade of the texture (inverted hull of the skinned mesh).
  Character height 1.6 units (stands need 4 free levels).
- `?spawn=x,z` puts the character near a cell (screenshots, debugging).
- `H` shows or hides all the overlays (HUD, pickers, cut slider).
- Walk area (`core/navigation/walkArea.ts`): stands (solid, not water or
  foliage, 4 free levels above, shallow water allowed), 8-way moves of at
  most 2 levels without corner cutting, A* paths, connected regions, spawn
  point.
- Model pipeline `make models`: sources in `assets-src/models/` (the
  original exports), texture flattened and turned to WebP on the host
  (`tooling/compress_glb.py --flat 12 --texture-only`: Python, numpy,
  ffmpeg), then meshopt compression by `gltfpack` 1.3.0 (new dev
  dependency) in the container (`-cc -vpf -vtf`: positions and UVs stay
  floats, which the outline and the shade tint rely on). The loader has
  Three's meshopt decoder. The fighter went from 1060 kB to 211 kB
  (159 kB downloaded; the dev server now gzips `model/gltf-binary`).
  `compress_glb.py` alone (without `--texture-only`) still shrinks a model
  without any decoder: 515 kB.
- Foot IK (`render/actors/footIk.ts`): each foot is planted on the ground
  under it (body lowered for the lowest foot, two-bone leg IK with a pole
  in front of the knee, planted feet turned along the slope); standing,
  the feet are locked on the idle clip's first-frame stance, so the idle
  clip's own foot shuffles no longer slide them.
- Screenshots: views take `steps` (mouse clicks before the capture);
  console warnings and errors of the page are printed, with the bytes
  the page transferred.

### Changed

- Time of day: lighter picker, one small sky swatch per time (sun or moon
  placed by its direction and height) and the current time's name; the
  lighting changes smoothly, the shorter way round the day through the
  times on the way (late night to morning goes through dawn; `timePath`,
  `blendAlong`, `blendPresets`), in 1.2 s plus 0.5 s per time passed,
  eased; the light dims half-way when it swings from the sun to the moon.
- Launch: the `river` map, 40 x 40 by default (`DEFAULT_RIVER_SIZE`), with
  a random seed unless `?seed=` gives one; the camera starts close on the
  character (`initialDistance` 20), and `C` / `Home` recentres on it
  (`Engine.resetView`). The farthest zoom follows the map size
  (`CameraRig.setFitRadius`, `cameraMath.fitDistance`) instead of a fixed 240.
- The debug HUD is hidden by default; a round bug button at the top left
  shows it, and a round `?` button next to it a summary of the controls
  (`ControlsHelp.vue`; one panel at a time) (`?hud=on` at start; screenshots turn it on).
- A loading screen covers the canvas at launch and at each map or seed
  change, until the map, the character and a first frame are ready
  (`LoadingScreen.vue`, `GameCanvas` `ready` event, `Engine.rendered`).
- The `organic` test map is renamed `river` (`?map=river`,
  `core/generators/riverMap.ts`, wiki page _River Map_).
- The cut no longer slices the character: it is shown whole, or hidden
  whole when the ground it stands on is cut away (ADR-011,
  `core/cutSupport.ts`, `render/actors/cutSupported.ts`), the rule every
  object on the scenery (furniture, spell effects, props) will follow.
- Dev and preview servers prefer Brotli over gzip (`tooling/compression.ts`,
  was `gzip.ts`; compressed bodies cached by content hash; gzip now level
  9); the production build writes `.br` and `.gz` next to each asset. The
  preview server caches hashed `/assets/` for a year (immutable: a new
  version has new file names) and revalidates `index.html` every load.
  Production download: 568 kB (gzip) -> about 422 kB (Brotli). Browsers
  only ask for Brotli over HTTPS or on localhost: a plain-HTTP remote dev
  server still gets gzip.
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

- No water on Firefox (WebGPU): its shader compiler (Naga) rejected the
  water shader, whose grid fade was a `smoothstep` of literals only
  (`smoothstep(0.12, 0.3, 1.0)`, abstract types outside a constant
  expression). `applyGrid` now resolves a constant facing on the CPU.
- Dark triangles on steep river banks and grassy slopes: weak crags were
  shaded with the flat normal of the undisplaced triangle. Crag pieces now
  keep the face's smooth shading normal, mixed with the facet normal in
  proportion to the local amplitude (`terrainMesher.ts`), so only real
  cliffs look faceted.
- River maps whose best crossing site was a one-row islet got no crossing
  at all: `placeCrossing` now tries the next sites by score.
- Character feet no longer sink into the ground: foot IK keeps the toe
  base above the ground too, and planted feet are turned along the slope
  (the planted test compared the ankle with the ground instead of its
  standing height). The selection ring is draped on the ground (16
  probes), across a slope and a step alike.
- Character on a bank cell under a deck's end: feet on the deck level,
  not on the ground drawn lower between the planks.
- Character on decks: its feet stand on the structure's walking surface
  (`surfaceAt` or the owned voxel's top), never between planks; on
  stepping stones it hops from stone to stone (`StructureKind.hops`).
- Hover on a bank under a bridge's end: the cursor lies on the deck (flat
  patch at the walking level) instead of the smoothed ground below it.
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

### Removed

- Right click no longer removes the voxel under the cursor (it orders the
  character); `Shift` + left click still places one.

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
