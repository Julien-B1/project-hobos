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
- Debug URL flags are read by the app layer (`src/app/config.ts`):
  `?forceWebGL=1` forces the WebGL 2 backend.

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
