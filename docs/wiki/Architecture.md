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

| Layer         | Owns                                                                                        | Must not                                                        |
| ------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `src/core/`   | Voxel encoding, chunked map, coordinates, shapes, map generators, hit-to-surface resolution | Import Three.js, Vue, render or app. Touch the DOM.             |
| `src/render/` | Renderer, scene, camera rig, chunk meshing, raycasting, highlight                           | Import Vue or app. Mutate map data (it only reads `core`).      |
| `src/app/`    | Vue components, HUD state, input bindings, config                                           | Hold rendering logic. Store Three.js objects in reactive state. |

Why `core` is strict: it is the part that will be reused by the native
builds, the future navigation graph and tests. Keeping it free of rendering
types also makes it fully unit-testable in Node.

## Runtime flow

```
App.vue
 ├─ GameCanvas.vue ── creates ──> Engine (src/render/engine.ts)
 │        ▲                         ├─ createRenderer(): WebGPURenderer, await init(),
 │        │ onHudChange(snapshot)   │   backend detection (WebGPU / WebGL 2)
 │        └─────────────────────────├─ createScene(): background + lights
 │                                  └─ render loop (setAnimationLoop), resize observer
 └─ DebugHud.vue <── snapshot (shallowRef in App.vue)
```

- The engine is created in `GameCanvas.vue` `onMounted` and disposed in
  `onBeforeUnmount`. It is kept in a plain variable, never in reactive state.
- The engine pushes immutable HUD snapshots (`EngineHudState`) through a
  callback, at most a few times per second. Vue only stores the latest one.
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
  (`reference` by default, `flat`).

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
        │     terrain materials   -> TerrainMesher (low-poly facets)
        │     wood, leaves, water -> CulledMesher (blocks, exact shapes)
        │   CulledMesher alone (`?mesher=blocky`)
        ▼
BufferGeometry on one Mesh per chunk (shared vertex-colour material)
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
  top becomes two flat-shaded triangles whose corners are the mean of the
  connected run tops around that lattice point (a tunnel floor never joins
  the roof above it). Vertical walls only where the neighbour column does
  not cover the run, flat undersides for overhangs, and a water quad over
  shore cells whose facets dip below a neighbouring water surface. Steep
  triangles use the layer under the top (dirt, rock). The voxel grid is
  unchanged: game logic still works on voxels; only the look is faceted.
- Picking on faceted terrain: hits on upward facets are resolved by column
  (`resolveColumnHit`: surface of that column closest in height), other
  hits by `resolveHit`.
- Hover highlight: a 3 x 3 patch draped on the surface cell. On faceted
  terrain its heights are measured with short downward rays on the chunk
  meshes, started just above the voxel surface so a bridge deck or a tunnel
  ceiling above is ignored. Re-draped only when the target or the terrain
  changes.
- **Edits** (debug): `src/app/editing/debugEdits.ts` writes to the map from
  the engine's `hoveredHit` (right click removes the touched voxel,
  `Shift` + click places a stone voxel on the surface). The map marks the
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

| Concern      | Tool and config                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------ |
| Type-check   | `vue-tsc --build`: `tsconfig.app.json` (src, browser) + `tsconfig.node.json` (`vite.config.ts`). |
| Strictness   | `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noUnused*`.                         |
| Lint         | ESLint flat config, `typescript-eslint` strict + stylistic type-checked, `eslint-plugin-vue`.    |
| Format       | Prettier (`.prettierrc.json`); ESLint formatting rules disabled via `eslint-config-prettier`.    |
| Tests        | Vitest, Node environment, files `src/**/*.test.ts` next to the module under test.                |
| Import alias | `@/` maps to `src/` (Vite `resolve.alias` and tsconfig `paths`).                                 |
