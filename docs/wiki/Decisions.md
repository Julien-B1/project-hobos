# Decisions

Short architecture decision records (ADR). Newest at the bottom. Each record
states the context, the decision and its consequences. Do not rewrite an
accepted record: add a new one that supersedes it.

## ADR-001: Three.js over Babylon.js

- **Status:** accepted (2026-11-19)
- **Context.** The game needs custom voxel meshing, a custom RO-style orbit
  camera and voxel-surface picking. These are the core of the project and
  will be written by us whatever the engine. The renderer must use WebGPU
  with a WebGL 2 fallback. Later needs: occlusion fading, tilt-shift and other
  HD-2D post effects, billboard sprites.
- **Decision.** Three.js with `WebGPURenderer` imported from `three/webgpu`.
- **Consequences.**
  - Small, unopinionated library: full control of the render pipeline and
    buffer layout.
  - WebGL 2 fallback is built into `WebGPURenderer`.
  - Shaders and post-processing are written with TSL (Three Shading
    Language), which compiles to both WGSL and GLSL.
  - We do not get Babylon's batteries (inspector, ready-made cameras and
    picking helpers); we accept that because we write those parts ourselves.

## ADR-002: Vue 3 for the app shell and HUD

- **Status:** accepted (2026-11-19)
- **Context.** The UI around the canvas starts as a debug HUD and will grow
  into game menus and panels. Alternatives considered: Svelte 5, SolidJS.
- **Decision.** Vue 3 (Composition API, single-file components) with
  `vue-tsc` for type-checking.
- **Consequences.**
  - Mature, actively maintained, first-class Vite and TypeScript support.
  - The HUD updates on state changes, not every frame, so the finer-grained
    reactivity of Svelte or Solid brings no decisive gain.
  - The engine (Three.js objects) must stay outside Vue reactivity
    (`markRaw`, plain objects) to avoid proxying scene graphs.

## ADR-003: Docker-only development environment

- **Status:** accepted (2026-11-19)
- **Context.** The project must be easy to pick up on any machine, by a human
  or an agent, without installing a specific Node/pnpm version on the host.
- **Decision.** All tooling runs in a Docker Compose service, driven by
  `make`. See [[Development Environment|Development-Environment]].
- **Consequences.**
  - Identical toolchain everywhere; the host needs only Docker, make, git and
    a browser.
  - Slight overhead per command (`docker compose run`).
  - `node_modules` is bind-mounted so host editors keep working on Linux/WSL.

## ADR-004: Smooth rendering for natural terrain

- **Status:** superseded by ADR-005 (2026-11-19)
- **Context.** Per-voxel shapes rise at most one half-height level per
  cell, so steep or diagonal terrain shows stairs and saw teeth, and every
  corner seen from above stays square. The project owner wants smooth hills,
  smooth steep slopes and cliffs, and rounded horizontal corners, while
  built structures and real stairs keep their edges.
- **Decision.** Render natural materials with a surface-nets mesher on a
  blurred density field derived from the voxels; render built and fluid
  materials (wood, water) with the existing culled block mesher
  (`HybridMesher`). The voxel grid stays the single source of truth for
  logic: surfaces, picking resolution and edits are unchanged.
  `?mesher=blocky` keeps the exact block rendering for debugging.
- **Consequences.**
  - Terrain looks smooth whatever the slope; cliffs become steep rounded
    faces; tunnels stay open.
  - The rendered surface no longer matches voxel faces exactly: picking
    searches inwards for the voxel, and the highlight is draped on the mesh.
  - A voxel edit can change meshes up to 2 voxels away: dirty tracking
    marks neighbour chunks within that margin, diagonals included.
  - Slopes and corner wedges still matter for logic (walkable ramps) and
    feed the density as partial volume.

## ADR-005: Faceted low-poly terrain

- **Status:** accepted (2026-11-19), supersedes ADR-004
- **Context.** The surface-nets rendering of ADR-004 looked like modelling
  clay: blobby shapes, soft shading, merged tree canopies, jagged shores and
  material colours bleeding across cells. The project owner chose a
  faceted low-poly look instead.
- **Decision.** Terrain materials are drawn by `TerrainMesher`: per column
  run, a top made of two flat-shaded triangles whose corners are shared,
  averaged heights of connected neighbouring runs (`core/terrainSurface.ts`);
  vertical walls only where neighbours do not cover; flat undersides for
  overhangs; water as a flat plane crossing the facets (smooth shorelines).
  Wood and leaves stay blocks (`CulledMesher`). `?mesher=blocky` keeps exact blocks.
- **Consequences.**
  - Steps of any height become facets; corners seen from above are cut
    diagonally; crisp low-poly look with flat shading and clear colours.
  - Tunnels and overhangs keep flat roofs and vertical inner walls.
  - Rendered tops differ from voxel tops: upward hits are resolved by column
    (`resolveColumnHit`) and the highlight is draped on the mesh.
  - Meshing reads whole column runs: dirty tracking always marks the chunks
    above and below.
  - Update: tops are now smooth-shaded (per-corner normals averaged over
    connected facets); the geometry stays faceted.
  - Update: leaves and tree trunks are no longer blocks, see ADR-006.

## ADR-006: Trees are voxels in data, procedural meshes in rendering

- **Status:** accepted (2026-11-19)
- **Context.** Trees drawn as wood and leaf blocks looked like a PS1-era
  game; the project owner asked for real trees, possibly procedural with
  masked pseudo-foliage.
- **Decision.** Keep trees as voxels (a WOOD trunk column topped by LEAVES)
  so game logic, picking and edits keep one source of truth, and let the
  renderer recognise them (`core/trees.ts`) and draw them as round tapered
  trunks with branches plus alpha-tested leaf cards placed from the leaf
  voxels (`TreeMesher`). Every voxel is meshed by its own chunk.
  WOOD without LEAVES on top stays blocky (bridges, structures).
- **Consequences.**
  - Editing a trunk or leaf voxel rebuilds the tree like any voxel edit.
  - The canopy's silhouette follows the leaf voxels, softened by the cards.
  - Foliage costs overdraw (cards overlap): one texture fetch per layer of
    cards, alpha to coverage on the existing MSAA, no sorting.
  - A block touching a trunk still has its touching face culled (the
    occlusion rule only sees voxel values); acceptable for now.
  - Tree kinds are data too: the foliage material on top of the trunk
    (leaves, needles, birch leaves) and the trunk height (one voxel: bush).

## ADR-007: Structures are parametric map objects that stamp gameplay voxels

- **Status:** accepted (2026-11-19)
- **Context.** Bridges built from voxel blocks looked like toy bricks, and
  buildings and other set pieces are coming. Recognising them from voxel
  patterns (as trees are, ADR-006) does not scale: an arch, a rope, a
  roof truss cannot be told from voxels.
- **Decision.** A structure is an object on the map (`core/structures`):
  `{ id, kind, params }`. Its kind (`StructureKind`, registered by id in a
  `StructureRegistry`) stamps the voxels gameplay needs (walkable decks,
  blocking piers, raised beds) and returns the voxels it owns. A
  render-side mesher per kind (`render/structures`, `StructureMesher`)
  draws it from its parameters with shared closed primitives
  (`render/geometry/primitives.ts`) into the blocks layer; owned voxels are
  not drawn as blocks. `StructureSet` indexes the structures of a map
  (owner of a voxel, home chunk of each structure's mesh).
- **Consequences.**
  - Voxels stay the truth for surfaces, picking and future path finding;
    the structure's parameters are the truth for its look.
  - New kinds (houses, towers...) plug in by registering a kind and a
    mesher: no change to the engine, the chunk meshers or the generators
    (open/closed).
  - Structure meshes must be closed volumes (the cut section counts faces).
  - A structure is meshed once, with the chunk of its first owned voxel;
    editing voxels does not move or rebuild structures yet.

## ADR-008: The cut section is drawn by stencil capping

- **Status:** accepted (2026-11-19)
- **Context.** The cut slider hides everything above a height; chunk meshes
  are hollow shells, so the cut must be filled. A CPU cap computed from the
  terrain model did not match the displaced crags; drawing the shells' back
  faces as the section let anything poking into the ground show through.
- **Decision.** Classic stencil capping (`render/sectionCap.ts`): while
  cutting, the solid layers are drawn a second time into the stencil only
  (back faces increment, front faces decrement, below the cut, depth test
  off; the buffer is cleared to 128), then a plane at the cut height is
  drawn where the count is above 128, and every layer material tests the
  stencil so nothing shows through. Built voxels add their own coloured
  cap on top.
- **Consequences.**
  - The section's outline is exactly the cut of the drawn meshes, whatever
    their shape (crags, round trunks, arches).
  - Every solid mesh must be a closed shell (terrain floor faces, closed
    primitives, watertight crags); tests check it.
  - No cost while the cut is off; while cutting, the solid layers' vertices
    twice more and a few fragment writes.

## ADR-009: Tone mapping and sRGB encoding are done in the materials

- **Status:** accepted (2026-11-19)
- **Context.** With tone mapping or an output colour space set on the
  renderer, `WebGPURenderer` draws into a multisampled half-float target,
  resolves it and copies it to the canvas with a full-screen pass. Measured
  on the owner's RTX 5080 (WebGL 2): 11 ms per frame whatever the scene,
  3.5 ms at half resolution.
- **Decision.** The renderer has no tone mapping and stays in the working
  colour space, so it draws straight into the canvas; every visible
  material ends with Neutral tone mapping and the sRGB transfer
  (`render/outputEncoding.ts`); the background is given as an encoded
  colour.
- **Consequences.**
  - That fixed per-pixel cost is gone.
  - New visible materials must call `encodeOutput`, or they render too dark.
  - Transparent materials blend encoded values: a slight difference only.
  - Post-processing would bring an intermediate target back; revisit then.

## ADR-010: Screenshots in headless Chromium for visual checks

- **Status:** accepted (2026-11-19, asked by the project owner)
- **Context.** Rendering work needs visual checks; asking the owner for
  every screenshot is slow, and the agent cannot see a browser otherwise.
- **Decision.** Playwright (pinned in `package.json` and the Dockerfile)
  with its Chromium in the dev image; `make screenshots` starts a Vite
  server in the container and saves PNGs of chosen views
  (`?cam=x,z,distance,yaw` frames them) into `screenshots/` (git-ignored).
- **Consequences.**
  - Headless Chromium has no GPU: the page runs on WebGL 2 in software
    (SwiftShader), close to but not exactly a real GPU's image; GPU figures
    in those captures mean nothing.
  - The dev image grows by a few hundred MB.
