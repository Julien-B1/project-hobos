# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Wizard character (`src/assets/models/wizard.glb`, Tripo rig with seven
  clips), the default: skirt panels, bell sleeves and long hair swing,
  lag behind and move aside for the legs. Spring bones
  (`render/actors/springBones.ts`): bone chains named `Spring_*`
  simulated root to tip at a fixed 60 Hz step (inertia, pull to rest,
  gravity, capsule colliders on the legs and spine).
- Character choice in the map picker and `?character=wizard|fighter`.
- Blender 5.2.3 LTS in the dev image (headless, pinned by SHA-256);
  `make models` runs `tooling/blender/<model>.py` first when present.
  `tooling/blender/wizard.py` adds the spring chains and their weights,
  keeps only the base colour texture.
- `compress_glb.py --max-size`: textures at most 1024 pixels wide in
  `make models` (wizard 2048² texture: 500 kB to 359 kB).

### Changed

- Foot IK finds VRM-style leg bones (`J_Bip_L_UpperLeg`) as well as
  Mixamo ones.

## [0.3.0] - 2026-11-20

Battle-map prototype: natural terrain, river crossings, one playable
character, desktop demo and web deployment. Pre-releases:
`v0.3.0-demo.1` (first desktop demo) and `v0.3.0-demo.2` (launch flow,
loading screens, controls panel); fixed since demo.2: water on Firefox,
plus the version badge.

### Added

#### Terrain and maps

- River map (`?map=river`, `core/generators/riverMap.ts`, the default):
  seeded procedural battle map, 40 x 40 by default (`?size=` 8 to 128),
  with hills and plains, a meandering river with banks and lakes, sand
  shores, rock patches, cliff zones with terraces, trees and exactly one
  river crossing (unless a lake runs from edge to edge). A random seed at
  each launch unless `?seed=` gives one. Seeded noise utilities in core
  (lattice hash, value noise, fBm, smoothstep).
- Kitchen-sink map (`?map=kitchen-sink`, 40 x 32): one hand-made plot per
  element (ground swatches, wedge mound, each tree kind, brick arch, ramp
  and platform, rock mesa with a cave, pond with a dock, canal with a
  path and a wooden bridge).
- Bridges showcase map (`?map=bridges`, 100 x 24): a river crossed by each
  crossing kind at the width and depth that suit it.
- `CORNERS` shape (wedges for outer and inner corners and saddles, shared
  top triangulation `topDiagonal`); `shapeForCornerMask`.
- Faceted low-poly terrain (default mesher, `TerrainMesher`,
  `core/terrainSurface.ts`): shared corner heights between neighbouring
  runs, smooth shading on tops, exact walls, overhangs, cave mouths and
  natural arches with irregular vaults; craggy rock on marked relief
  (cliffs, cave mouths, arches), watertight; water as flat planes along
  the facets. Wood and leaves stay blocks (`HybridMesher`);
  `?mesher=blocky` shows exact blocks.
- Materials: `LEAVES`, `NEEDLES`, `BIRCH_LEAVES`, `STONE_BRICK`;
  `isTerrainMaterial`, `isFoliageMaterial`.

#### Rendering

- Render layers per chunk (terrain, blocks, water, foliage, scatter,
  props), each with one shared TSL material.
- Terrain material: blended per-vertex material weights, a small
  precomputed noise texture and a procedural detail texture (grass clumps,
  pebbles, cracks, ripples), height-based transitions, dirt and rock on
  steep faces (3 texture fetches per pixel). Patterned blocks (`BlockLook`:
  planks, wood grain, bricks, masonry, stone, bark, rope).
- Water: translucent surface whose colour and opacity follow the depth,
  foam band, scrolling ripples, view-independent sun sheen (2 fetches per
  pixel, no refraction pass).
- Real trees (`core/trees.ts`, `TreeMesher`): oak, pine, birch and bush,
  round tapered trunks with branches, camera-facing leaf cards, dappled
  shadows, wind sway.
- Ground scatter derived from the voxels: grass tufts, flowers, fallen
  leaves under canopies, stones on rocky ground, reeds, algae.
- Sun shadows (`?shadows=off|low|high`, default `high`), stable framing,
  redrawn only when needed (every frame while a character is on the map).
- Time of day: 8 lighting presets (dawn to late night, sun or moon),
  `?time=<id>`, smooth transitions the shorter way round the day.
- Battle-map grid drawn in the shaders (anti-aliased, `G`, `?grid=off`);
  hover highlight drawn by the terrain shader on the exact ground.
- Cut slider (left edge): hides everything above a height, with an opaque
  hatched section by stencil capping (`sectionCap.ts`, ADR-008). Objects
  on the scenery are never sliced: shown whole, or hidden whole when the
  ground under them is cut (ADR-011, `core/cutSupport.ts`,
  `render/actors/cutSupported.ts`).
- Tone mapping and sRGB encoding inside the materials, drawing straight
  into the canvas (ADR-009).
- Debug figures: GPU time and load, VRAM estimate, draw calls, triangles,
  shadow passes, camera pose; performance probes on keys `1` to `6`.

#### Structures and crossings

- Structures (ADR-007, `core/structures`, `render/structures`): parametric
  map objects that stamp gameplay voxels and are drawn by one mesher per
  kind from closed primitives (`render/geometry/primitives.ts`).
- Seven river crossings: wooden beam bridge, stone arch bridge, slab
  bridge, rope bridge (sagging deck, `StructureKind.surfaceAt`), fallen
  log, stepping stones (`StructureKind.hops`) and ford.
- Crossing choice on generated maps: `measureCrossing`, `CROSSING_RULES`,
  `pickCrossing` (seeded); the best site by score, trees kept clear.

#### Character

- Playable character (`src/assets/models/fighter.glb`, idle and walk
  clips): spawned on grass in the largest walkable region (`?spawn=x,z`);
  left click selects it, right click sends it along the shortest path;
  feet on the drawn ground (decks, rope bridges, shallow water), foot IK
  with a locked standing stance; anime-style cel shading with an outline;
  1.6 units tall.
- Walk area (`core/navigation/walkArea.ts`): stands, 8-way moves of at
  most 2 levels without corner cutting, A*, connected regions, spawn
  point. Shallow water (2 levels or less) is waded (`wadeThrough`).
- Model pipeline `make models` (texture flattened to WebP, then `gltfpack`
  meshopt compression): the fighter went from 1060 kB to 211 kB.

#### App

- Launch on a random river map with the camera close on the character
  (`C` / `Home` recentres on it); the farthest zoom shows the whole map
  (`CameraRig.setFitRadius`).
- Loading screen at launch and at each map or seed change.
- Map picker (bottom right): map, seed (🎲) and size without reloading,
  mirrored in the URL.
- Round buttons at the top left: bug (debug HUD, hidden by default,
  `?hud=on`) and `?` (controls summary). `H` hides every overlay.
- Version badge in the bottom-left corner: last tag, `+N` commits after
  it and the commit hash (`tooling/buildInfo.ts`).

#### Distribution and tooling

- Desktop demo `make release` (Neutralino): Windows executable (WebView2,
  WebGPU), Linux binary and AppImage, macOS binary, all files embedded,
  offline.
- Web deployment behind Traefik (`deploy/`, `make deploy` and the other
  `deploy-*` targets): nginx image serving precompressed files.
- Brotli and gzip: precompressed production build, compressed dev and
  preview servers, hashed assets cached for a year.
- `make screenshots`: headless Chromium captures of views (`?cam=`,
  clicks and key presses), console messages and transferred bytes.

### Changed

- Maps are sized for one encounter (1 cell = one 5 ft square).
- Lighting: lower sun from the north-west, softer ambient.
- Dirty tracking also marks chunks above and below and neighbours within
  2 voxels, as the faceted mesher reads whole column runs; `resolveHit`
  searches inwards along the normal; `ChunkRenderer.update()` reports only
  chunks whose mesh changed; the culled mesher reads in-chunk neighbours
  directly.

### Removed

- The reference test map (`?map=reference`, wiki page _Reference-Map_):
  its picking cases now live in a fixture of `surface.test.ts`.
- `BOOTSTRAP.md`, the original specification of steps 1 and 2: the rules
  live in `AGENTS.md`, the roadmap in the wiki home page.
- Right click no longer removes the voxel under the cursor (it orders the
  character); `Shift` + left click still places one.

### Fixed

- No water on Firefox (WebGPU): its shader compiler (Naga) rejected a
  `smoothstep` of literals only; `applyGrid` resolves a constant facing on
  the CPU.

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

[Unreleased]: https://github.com/Julien-B1/project-hobos/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/Julien-B1/project-hobos/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Julien-B1/project-hobos/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Julien-B1/project-hobos/releases/tag/v0.1.0
