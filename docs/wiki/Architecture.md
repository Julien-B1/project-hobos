# Architecture

## Layers

The source tree is split into three layers. Dependencies only point
downwards; ESLint (`no-restricted-imports` in `eslint.config.js`) fails the
build when a rule is broken.

```
src/app      Vue shell, HUD, input wiring       may import render, core
   │
src/render   Three.js: scene, camera, meshing,  may import core
   │         picking                            no vue, no app
src/core     Pure TypeScript: map data,         no three, no vue,
             coordinates, shapes, generators,   no render, no app
             pure geometry maths
```

| Layer         | Owns                                                                                                                                                                                                 | Must not                                                        |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `src/core/`   | Voxel encoding, chunked map, coordinates, shapes, map generators, hit-to-surface resolution, structures (`core/structures`: kinds, stamps, crossing choice), walk area and paths (`core/navigation`) | Import Three.js, Vue, render or app. Touch the DOM.             |
| `src/render/` | Renderer, scene, camera rig, chunk meshing, structure meshers (`render/structures`), geometric primitives (`render/geometry`), raycasting, highlight, characters (`render/actors`)                   | Import Vue or app. Mutate map data (it only reads `core`).      |
| `src/app/`    | Vue components, HUD state, input bindings, config                                                                                                                                                    | Hold rendering logic. Store Three.js objects in reactive state. |

Why `core` is strict: it is the part that will be reused by the native
builds, the future navigation graph and tests. Keeping it free of rendering
types also makes it fully unit-testable in Node.

## Runtime flow

```
App.vue
 ├─ GameCanvas.vue ── creates ──> Engine (src/render/engine.ts)
 │        ▲                         ├─ createRenderer(): WebGPURenderer, await init(),
 │        │ onHudChange(snapshot)   │   backend detection (WebGPU / WebGL 2)
 │        └─────────────────────────├─ createScene(): background, sun + hemisphere
 │                                  ├─ SunShadow: shadow map framed on the camera
 │                                  └─ render loop (setAnimationLoop), resize observer
 └─ DebugHud.vue <── snapshot (shallowRef in App.vue)
```

- The engine is created in `GameCanvas.vue` `onMounted` and disposed in
  `onBeforeUnmount`. It is kept in a plain variable, never in reactive state.
- The engine pushes immutable HUD snapshots (`EngineHudState`) through a
  callback, at most a few times per second. Vue only stores the latest one.
  `GameCanvas.vue` also emits a `SessionInfo` once per map (map, resolved
  seed, mesher), so screenshots of the HUD are self-describing. The HUD is
  hidden by default: the round bug button (`App.vue`) shows it, as does
  `?hud=on` (on for `make screenshots`). The `?` button next to it shows
  a summary of the controls instead (`ControlsHelp.vue`): one panel at a
  time.
- **Loading screen** (`LoadingScreen.vue`): covers the canvas from launch
  and from each map change until `GameCanvas` emits `ready`: it waits for
  the screen to paint (map generation blocks the main thread), generates
  the map, creates the engine, loads the character, then waits for a first
  drawn frame (`Engine.rendered`: chunks built, shaders compiled).
  `main[data-ready="true"]` marks the end (screenshots wait for it).
- **Start-up view**: the camera starts on the character
  (`Engine.spawnCharacter` resolves to its feet) at `initialDistance`;
  `C` / `Home` returns there (`Engine.resetView`, centred on where the
  character stands now). The farthest zoom fits the map
  (`CameraRig.setFitRadius`, `cameraMath.fitDistance`: a disc of half the
  map's diagonal seen whole at the locked pitch, for the current aspect
  ratio, with a margin).
- **Map switching** (`MapPicker.vue`, bottom right): `App.vue` holds the map
  settings (`MapSettings`: map id, seed, size). Loading a map replaces them
  and bumps the `key` of `GameCanvas`, so Vue unmounts it (engine disposed,
  input listeners removed, animation loop stopped) and mounts a fresh one on
  a new canvas. The engine needs no "swap map" API. Time of day, cut and
  grid visibility live in `App.vue` and carry over; the URL is rewritten
  with `history.replaceState` (other query parameters kept). Keyboard
  shortcuts ignore keys typed into form fields (`isTextEntryTarget`).
- **Debug figures** (`render/frameStats.ts`, averaged over 0.5 s): FPS; GPU
  time per frame from timestamp queries (`trackTimestamp`, one readback in
  flight) and the derived GPU load (GPU time / frame interval: the page's
  own share, not the OS-wide figure); estimated VRAM (Three.js tracked
  buffers and textures, plus untracked MSAA samples and the canvas; no
  browser API reports a page's real VRAM); draw calls, triangles, shadow
  passes; camera target, distance and yaw. GPU figures show `n/a` when the
  browser has no GPU timer.
- Input: `src/app/input/bindings.ts` turns DOM events into calls on the
  render-layer `CameraRig` (`rotateBy`, `snapRotate`, `zoomBy`,
  `panByPixels`, `setMoveIntent`). The rig knows nothing about devices.
  `Engine` calls `rig.update(dt)` every frame (dt capped at 0.1 s).
- Camera geometry lives in `src/render/cameraMath.ts` (no Three.js import)
  so it is unit-tested. Yaw convention: yaw 0 puts the camera on the +Z side
  of its target looking towards -Z; positive yaw turns counter-clockwise seen
  from above.
- Hover picking: bindings forward the cursor to `Engine.setPointer()` (CSS
  pixels, converted to NDC). Every frame the engine raycasts the chunk
  meshes and hands the hit point and triangle normal to
  `core/surface.resolveHit()`, which returns the touched voxel and the
  targeted surface (rules on the _Conventions_ page). The engine lays the
  `SurfaceHighlight` quad on that surface (tilted on slopes), keeps the hit
  for edit actions (`Engine.hoveredHit`) and publishes it in the HUD snapshot
  only when it changes. Picking runs every frame because the camera can move
  under a still cursor.
- Debug URL flags are read by the app layer (`src/app/config.ts`):
  `?forceWebGL=1` forces the WebGL 2 backend, `?map=<id>` selects a test map
  (`river` by default with a random seed unless `?seed=`,
  `flat`, `kitchen-sink`, `bridges`; all battle-map sized, `?size=<cells>`
  for procedural maps), `?time=<id>` sets the time of
  day, `?mesher=blocky` shows exact
  blocks, `?shadows=off|low|high` sets the sun shadow quality (`high` by
  default).

## Terrain pipeline

```
core/generators/catalog ── createTestMap(id) ──> VoxelMap (+ footprint, home)
                                                     │ set() marks dirty chunks
                                                     ▼
render/chunkRenderer.update()  ── drainDirty() ──> keys to rebuild
        │ for each key
        ▼
ChunkMesher.mesh(map, chunk) ──> MeshData (typed arrays, no Three.js)
        │   HybridMesher (default, faceted):
        │     terrain materials, water -> TerrainMesher (low-poly facets, water plane)
        │     trees (trunk + foliage)  -> TreeMesher (round trunks, leaf cards)
        │     ground decoration        -> ScatterMesher (cards, small rocks)
        │     other wood               -> CulledMesher (blocks, exact shapes)
        │   CulledMesher alone (`?mesher=blocky`)
        ▼
One Mesh per chunk and render layer (terrain, blocks, water, foliage,
scatter, props), each layer with its own shared material
(render/materials.ts)
```

- `ChunkRenderer.update()` runs every frame; after generation every chunk is
  dirty, so the first call builds the whole map.
- A dirty key whose chunk no longer exists, or whose mesh is empty, removes
  the chunk mesh.
- Colours come from `render/materialPalette.ts` (sRGB authored, converted to
  linear once), multiplied by a small per-cell jitter; the blocky mesher also
  bakes a per-face shade.
- **Faceted terrain** (`render/meshing/terrainMesher.ts`, heights from
  `core/terrainSurface.ts`): each column is cut into terrain runs; each run
  top becomes two triangles whose corners are the mean of the connected run
  tops around that lattice point (a tunnel floor never joins the roof above
  it). Tops are smooth-shaded: each corner normal averages the facets of the
  same connected group around the lattice point
  (`TerrainField.cornerNormals`), so neighbouring cells and chunks agree and
  the facets do not show in the lighting; walls keep flat normals. Vertical walls only where the neighbour column does
  not cover the run (exact even when the two tops cross along the edge:
  the edge is split at each crossing) and flat undersides for overhangs. Water is a flat
  plane drawn by the same mesher (a hair below its level) over every cell
  whose facet dips under a nearby water surface; beds blend with banks, so
  the shoreline is where the facets cross the plane. Water vertices carry
  their depth above the bed (split along the bed's diagonal). Steep
  triangles use the layer under the top (dirt, rock). The voxel grid is
  unchanged: game logic still works on voxels; only the look is faceted.
- **Terrain shading** (`render/terrainMaterial.ts`, `render/noiseTexture.ts`,
  `render/detailTexture.ts`): vertices carry 6 material weights (two vec4
  attributes), averaged per lattice point like the heights. Textures are
  projected in world space on the plane facing the facet (chosen from the
  geometric normal, from screen derivatives). A 256 x 256 noise texture
  (sampled twice) gives large-scale colour variation and random shifts; a
  512 x 512 detail texture (one channel per material family: grass clumps,
  pebbles, rock cracks, sand ripples; rotated against the cell grid) gives
  the fine definition and serves as each material's _height_: where
  materials meet, the highest within a narrow band wins (height blending),
  so borders are crisp, irregular and follow the patterns. Steep ground
  shifts weight to dirt and rock before the blend. Budget: 3 texture fetches
  and a few dozen ALU per pixel; no GPU noise functions. All textures are
  generated once on the CPU at start-up.
- **Trees** (`core/trees.ts`, `render/meshing/treeMesher.ts`): a WOOD column
  topped by foliage (`LEAVES`, `NEEDLES`, `BIRCH_LEAVES`) is a trunk;
  foliage belongs to the closest trunk within 4 cells. The kind (oak, pine,
  birch, bush) comes from the foliage material and the trunk height and
  sets the bark style (radius, taper, lean, branches, colour, birch marks)
  and the canopy centre; each foliage material picks its card size and
  atlas row. Generators grow them with `core/generators/treeGrowth.ts`
  (round oaks, pine cones, narrow birches, low bushes). Trunk voxels become
  segments of a round, tapered, leaning tube (root flare, branches into the
  canopy) in the blocks layer. Each foliage voxel with an exposed face
  becomes one alpha-tested leaf card (`render/leafTexture.ts` 4 x 4 atlas:
  broad leaves, needles, birch leaves, scatter; `render/foliageMaterial.ts`)
  in the foliage layer, jittered and mostly facing out of the canopy, with
  normals taken from the canopy ellipsoid (lit as one volume) and vertex
  colours carrying a per-card tint and fake occlusion. Cards face the
  camera: their 4 vertices sit at the card centre and the shader spreads
  them along the camera's right and up axes (in the shadow pass, the sun's),
  so canopies are full and never show cards edge-on; normals are computed
  per pixel from the canopy centre. Cards use alpha to coverage, an alpha
  boost per mip level (far canopies do not vanish) and cast alpha-tested
  shadows. Cards sway with the wind (`render/wind.ts`: gust wave plus
  per-tree phase, flutter of the corners); the shadow pass uses the still
  cards, so the shadow map is not re-rendered every frame. Foliage is not
  pickable. Data stays voxels:
  see ADR-006 on the _Decisions_ page.
- **Scatter** (`render/meshing/scatterMesher.ts`, `render/scatterMaterial.ts`):
  decoration only, derived deterministically from the voxels (cell hash),
  never seen by game logic or picking. Deliberately light: one candidate
  point per run top (not covered by a block), most left empty. Items come
  from the ground material there, the water depth and nearby trees: sparse
  grass tufts and flowers on grass, stones on rocky ground only, fallen
  leaves only under a tree canopy, a few reeds on shores and algae under
  deep water. Cards (scatter layer, foliage atlas row 3
  in colour) turn around the vertical to face the camera, sway at the top,
  lie flat for fallen leaves, and cast no shadow; rocks (props layer) are
  jittered, smooth-shaded icosahedra.
- **Blocks shading** (`render/blocksMaterial.ts`): a per-vertex look
  (`BlockLook`) picks a world-space pattern: wood planks (seams, joints,
  grain), stone bricks (staggered courses, mortar), bark streaks, or plain.
  1 noise fetch per pixel. Built structures use block materials (`WOOD`,
  `STONE_BRICK`); terrain materials are always faceted.
- **Cut** (`materials.ts` `cutHeight`, `Engine.setCutHeight`, `cutCap.ts`,
  `meshing/capMesher.ts`, `CutSlider.vue`): every layer material has a mask
  discarding what lies above a world height (any value, also in the shadow
  pass, re-rendered on change); picking skips hits above it and back
  faces. Chunk meshes are hollow shells, filled by stencil capping
  (`sectionCap.ts`): each solid layer mesh (terrain, blocks with trunks,
  props) has two companions sharing its geometry, drawn only while
  cutting, first, into the stencil buffer only (masked by the cut, depth
  test off): back faces increment, front faces decrement. The stencil is
  cleared to 128, so a count above it means the pixel's ray enters the cut
  plane inside matter (closed shells and their unions; a negative count
  from an open shell never reads as solid). Then a plane at the cut height
  is drawn where the count is above 128, opaque, depth-written, unlit, one
  earth colour with screen-space hatching (`sectionColor`): its outline is
  exactly the cut of the drawn meshes. Every layer material also tests the
  stencil (drawn only where it is at most 128), so nothing pokes through
  the section, whatever its depth. A floor face under the lowest terrain run closes the ground.
  Built voxels also get their own coloured cap over it (`CapMesher`: the
  section of each voxel's solid, slopes and wedges following their top).
  Display only, the map is untouched.
  Objects standing on the scenery (characters now; furniture, spell
  effects, props later) are never sliced (ADR-011): their materials have
  no cut mask, and the engine shows or hides each one whole every frame
  (`render/actors/cutSupported.ts`, `CutSupported`, `applyCut`), hidden if
  and only if the surface it rests on lies above the cut
  (`core/cutSupport.ts`, `shownUnderCut`). A hidden object casts no shadow
  and cannot be picked.
- **Openings** (`core/terrainSurface.ts`): around a corner touched by a
  covered run (cave or arch floor), runs only join when they agree on it,
  so the ground stays level in front of a mouth and the hill keeps a
  vertical face there; undersides are vaulted (`cornerBottoms`: corners
  against the side walls drop by half the opening's height, plus a random
  offset), so openings are irregular arches; the crags are stronger there
  (0.4 unit within 2 cells of an overhang) so the outline is irregular too.
  The mesher gives each face a look for the shader's slope rule
  (`FaceLook`, encoded as an offset of the up channel, `LOOK_SHIFT`):
  `rocky` inside (vaults, walls facing the roofed space: steep parts go
  straight to rock, never to earth), `earthy` on the facade around the
  opening (walls next to a roofed gap or belonging to its roof, facing
  open air: steep parts stop at earth, like the slopes around), `plain`
  elsewhere.
- **Crags** (`meshing/terrainMesher.ts` `Crag`, `meshing/polygonSplit.ts`):
  where the relief around a lattice point is marked (run tops differing by
  2.5 levels or more, full at 7), terrain faces are cut by the half-cell
  lattice planes (x, y, z and x - y, y - z, x - z = k / 2: the tetrahedra
  of the Freudenthal triangulation of the grid cubes), and displaced by
  offsets drawn from a 3D value noise at the lattice points (amplitude up
  to 0.3 unit, less vertically), interpolated linearly inside each
  tetrahedron. Every piece lies in one tetrahedron, where the displacement
  is linear: a vertex on another face's edge (T-junction) stays on the
  displaced edge, so the surface is watertight (the stencil section
  needs closed shells; checked by `unmatchedEdges` in the tests).
  Whether a face is cut is decided per cell (both triangles of a top share
  their diagonal). Pieces are faceted: irregular rock.
  Flat ground and gentle slopes are untouched. Each vertex also carries
  the undisplaced face's texture projection plane and upward facing (weight
  channels `PROJECTION_CHANNEL`, `UP_CHANNEL`): the terrain shader
  projects textures and applies the slope rule from them, so the small
  facets keep one coherent texture. Each piece vertex's normal mixes the
  facet normal with the undisplaced face's shading normal (smooth on
  tops; carried through the cut as three extra weight channels), the facet
  share growing with the square of the local amplitude: half and half on
  full crags (`CRAG_SOFTEN`), next to none where the relief barely starts
  (a steep river bank), which would otherwise show dark triangles. The
  noise is broad (0.6 per unit): faceted rock without crumpled-paper
  contrasts. The cut section and the hover
  highlight follow the drawn mesh (stencil capping, mesh pieces).
- **Battle-map grid** (`render/gridOverlay.ts`): the terrain, blocks and
  water shaders darken the cell borders (integer x, z) with thin,
  translucent lines. The line pattern is box-filtered over the pixel
  footprint (screen derivatives): anti-aliased at every zoom, no moiré,
  never hidden by the zoom. Only near-vertical faces drop it. Toggled with
  `G` (a uniform, no rebuild); `?grid=off` starts hidden.
- **Water shading** (`render/waterMaterial.ts`): transparent physical
  material (IOR 1.33, no transmission or other extension), no depth write.
  Colour and opacity follow the interpolated depth (nearly clear in the
  shallows, dark blue and nearly opaque when deep, faded out at the shore),
  with a thin noisy foam band. Two scrolling samples of the noise texture
  tilt the normal (ripples). The material's specular is off: a real
  highlight depends on the camera and showed as a spot moving with the
  view. Instead a view-independent sun sheen (sun half-vector with the
  vertical) and sparse ripple glints are added as emission, identical from
  every side. No refraction pass.
- **Lighting**: one directional light and a hemisphere ambient
  (`render/sceneSetup.ts`), set by the **time of day** (`render/timeOfDay.ts`:
  dawn, morning, noon, afternoon, dusk, evening, midnight, late night; sun
  by day, moon at night, with direction, colours, intensities and
  background). The picker in the app (`TimeOfDayPicker.vue`: one small
  sky swatch per time, sun or moon placed by direction and height, drawn
  from the preset) and `?time=<id>` choose it; the engine blends to the
  new lighting the shorter way round the day, through the times on the way
  (`timePath`, `blendAlong`: late night to morning goes through dawn), in
  1.2 s plus 0.5 s per time passed, eased (`blendPresets`: colours and intensities
  linear, azimuth the shorter way, the light dimmed half-way when it turns
  a lot, from sun to moon), reframing the shadow and updating the water
  sheen uniforms (`render/lightUniforms.ts`) each frame; Khronos PBR Neutral tone mapping (rolls off
  highlights, keeps the palette), applied with sRGB encoding at the end of
  every visible material (`render/outputEncoding.ts`): the renderer itself
  has no tone mapping and stays in the working colour space, so it draws
  straight into the canvas instead of a half-float intermediate target
  copied by a full-screen pass (a fixed per-pixel cost, measured at about
  11 ms of 11 ms per frame at 1906 x 1271 in WebGL 2). The background is
  given as an already encoded colour (`canvasColor`). Sun shadows (`render/sunShadow.ts`,
  framing maths in `render/shadowMath.ts`): one orthographic shadow map
  centred on the camera target, sized from the camera distance in
  2^(1/4) steps and snapped to its texel grid (no shimmering while
  panning). It is re-rendered only when that framing changes or chunks are
  rebuilt. Terrain, blocks and foliage cast and receive, water only
  receives. Default quality `high` (4096²).

### Rendering budget

Measured reference: Intel Arc integrated GPU (Core Ultra 7 165H), river
map at 1368 x 911: about 3.1 ms of GPU time per frame (19 % at 60 FPS, HUD
figure) with shadows and the depth-based water, before the detail texture,
trees and grid. Shadow quality barely changes GPU time; `high` costs about
95 MB of extra VRAM.

| Effect           | Per-pixel cost                        | Other cost                                 | Switch                    |
| ---------------- | ------------------------------------- | ------------------------------------------ | ------------------------- |
| Terrain material | 3 texture fetches, a few dozen ALU    | none                                       | always                    |
| Foliage material | 1 texture fetch, overdraw of cards    | alpha to coverage, a few vertex ALU (wind) | always                    |
| Scatter cards    | 1 texture fetch, small cards          | alpha to coverage, no shadow cast          | always                    |
| Grid             | a few ALU, derivatives                | none                                       | `G`, `?grid=off`          |
| Water material   | 2 texture fetches (water pixels only) | blending (transparent)                     | always                    |
| Tone mapping     | a few ALU                             | none                                       | always                    |
| Sun shadows      | 5 filtered depth fetches (PCF)        | depth pass, only on framing change         | `?shadows=off\|low\|high` |

- Picking on faceted terrain: hits on upward facets are resolved by column
  (`resolveColumnHit`: surface of that column closest in height), other
  hits by `resolveHit`. Over shallow water (2 levels or less: fords,
  shallow banks) the target is the bed, where one walks (`wadeThrough`);
  deeper water keeps its surface.
- Structures (see [[Structures]]): their meshes go into the blocks layer
  of their home chunk, so they are picked, shadowed and cut like blocks.
  The hover patch on a structure follows its walking surface
  (`StructureKind.surfaceAt`: the sagging rope deck); on ground inside a
  structure's footprint (a bank under a bridge's end) it is the flat patch
  at the walking level, not the terrain tint (the drawn ground there is
  smoothed lower, under the deck).
- **Performance probes** (debug, keys `1` to `6`, `Engine.toggleProbe`):
  switch off shadows, foliage, scatter and props, water or terrain, or
  halve the pixel ratio, to read each part's cost in the HUD's GPU time.
  On WebGL 2 the GPU timer includes idle gaps: the HUD flags it as an upper
  bound.
- Hover highlight. On faceted terrain the terrain shader tints the cell
  (`applyHover`, uniform `hover`): every pixel inside the cell square,
  within a height band (the base facet heights from `TerrainField`, plus
  0.45 unit for the crags: a cave ceiling or a ledge above stays out) and
  on ground (undisplaced face facing up, `UP_CHANNEL`: not walls). It
  covers exactly the drawn ground, crags included, is cut with it, and
  costs a few ALU: light fill (16 %), thin stronger border. On blocks, a
  translucent 3 x 3 patch on the voxel's top corners (20 % opacity, cut
  like the scene). On blocks, a 3 x 3 patch on the voxel's top corners. Rebuilt
  only when the target or the terrain changes.
- **Character** (`render/actors/character.ts`, `Engine.spawnCharacter`):
  a skinned glTF model loaded with Three's `GLTFLoader` (materials swapped
  for node materials with the output encoding and the cut mask), animated
  by an `AnimationMixer` (idle and walk, cross-faded). The engine puts it
  on `WalkArea.spawnPoint` (grass, largest walkable region, nearest to the
  map's home point). Left click (`Engine.select`) selects it when the ray
  passes through its body or the hovered cell is its cell; right click
  (`Engine.command`) runs `WalkArea.findPath` from its stand (or the cell
  it is heading to) to the stand nearest the hovered surface. Each frame
  it walks towards the next cell centre at the walk clip's ground speed
  and a short downward ray on the chunk meshes (water left out) puts its
  feet on the drawn ground. It casts a sun shadow: while a character is on
  the map the shadow map is redrawn every frame (one depth pass of the
  visible chunks; measure it with probe `1`). Toon shading
  (`actors/toonMaterial.ts`): `MeshToonNodeMaterial` with a 2-step
  gradient (sharp light / shade boundary), the shade tinted rather than
  grey (emissive: surface colour times a cool tint), a crisp rim light and
  an outline about 1 pixel wide at any zoom, in a darker shade of the
  texture, drawn as an inverted hull
  (a second skinned mesh on the same geometry and skeleton, pushed out
  along the skinned normals, back faces only). The selection ring is laid
  along the ground normal.
  After the mixer, `FootIk` plants the feet: each foot probes the ground
  under it (decks and stones through their structure surface, never
  between planks), the body is lowered by the largest drop needed, each leg
  is solved by a two-bone IK whose knee is placed on the front side (pole:
  the animated knee, backward part removed), and planted feet are turned
  along the slope. Standing, the feet are locked on the stance of the idle
  clip's first frame. A hop (stepping stones) fades the IK out. Leg bones
  are found by Mixamo (`LeftUpLeg`) or VRM-style (`J_Bip_L_UpperLeg`)
  names.
  Moves of more than `RUN_FROM_CELLS` (2) cells are run at 1.8 times the
  walking speed (run clip when the model has one, else the walk clip
  played faster), shorter ones walked; the run clip's playback speed
  matches its measured stride (`RUN_CLIP_STRIDE_SPEED`).
  Before the foot IK, `ArmPose` (`actors/armPose.ts`) adjusts the arms of
  the clip pose with the character's `ArmStyle`: upper arms turned out
  about the forward axis (clear of a wide outfit), extra elbow bend
  growing with the forward swing, and follow-through: a smoothed copy of
  the upper arm's swing angle lags behind it, and the difference turns
  the forearm (half of it the hand) the other way. What depends on the
  body stays out of the clips, so clips can be shared.
  Last, `SpringBones` (`actors/springBones.ts`) moves cloth and hair: the
  model's bones named `Spring_*` (added by a Blender script, see
  _Extending_) form chains simulated root to tip at a fixed 60 Hz step:
  each tip keeps its velocity (damped), is pulled back towards its rest
  direction and down, stays at the bone's length and is pushed out of
  capsules on the legs and the spine; the bone then turns towards it. The
  clips' tracks on these bones are dropped at load. Walking, turning and
  the legs' swing move the skirt, the sleeves and the hair. Models:
  `wizard` (default, spring bones on the skirt, sleeves and hair) and
  `fighter`, chosen with `?character=` or the map picker.
- **Walk area** (`core/navigation/walkArea.ts`): a stand is a solid voxel,
  not water or foliage, with 4 free levels above (the character is 1.6 units tall) (shallow water, at most
  `WADING_DEPTH`, counts as free). Moves go to the 8 neighbour columns, at
  most 2 levels up or down; diagonals need both orthogonal moves (no
  corner cutting). A* with the octile distance; columns are cached and
  dropped on any chunk rebuild.
- **Edits** (debug): `src/app/editing/debugEdits.ts` writes to the map from
  the engine's `hoveredHit` (`Shift` + click places a stone voxel on the
  surface). The map marks the
  edited chunk dirty, plus the chunks above and below and the side
  neighbours within 2 voxels (the faceted mesher reads whole column runs and
  neighbour columns); the next frame rebuilds only those. The HUD shows each rebuild batch (count, keys, time).
- How to add materials, shapes, meshers and maps: see [[Extending]].

## Documentation rules in code

- Every exported symbol in `core` and `render` has a TSDoc comment
  (`jsdoc/require-jsdoc`, enforced by ESLint).
- Each file starts with a short header: role, layer, what it reads and
  writes.
- Non-obvious logic carries a comment explaining _why_.

## Tooling

| Concern      | Tool and config                                                                                                                                                                                                       |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Type-check   | `vue-tsc --build`: `tsconfig.app.json` (src, browser) + `tsconfig.node.json` (`vite.config.ts`).                                                                                                                      |
| Strictness   | `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noUnused*`.                                                                                                                                              |
| Lint         | ESLint flat config, `typescript-eslint` strict + stylistic type-checked, `eslint-plugin-vue`.                                                                                                                         |
| Format       | Prettier (`.prettierrc.json`); ESLint formatting rules disabled via `eslint-config-prettier`.                                                                                                                         |
| Tests        | Vitest, Node environment, files `src/**/*.test.ts` next to the module under test.                                                                                                                                     |
| Import alias | `@/` maps to `src/` (Vite `resolve.alias` and tsconfig `paths`).                                                                                                                                                      |
| Dev server   | `tooling/compression.ts`: Brotli (else gzip) for dev and preview, cached; preview caches hashed assets a year, revalidates `index.html`; build writes `.br` / `.gz`; pre-bundled deps minified, inline maps stripped. |
| Screenshots  | `make screenshots` (`scripts/screenshots.mjs`): headless Chromium (Playwright) into `screenshots/`.                                                                                                                   |
| Models       | `make models`: `assets-src/models/` to `src/assets/models/` (`tooling/blender/<name>.py` in headless Blender when present, flat WebP texture at most 1024 px on the host, `gltfpack` meshopt in the container).       |
