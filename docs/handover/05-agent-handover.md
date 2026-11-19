# 5. Handover to a new agent

Read this first, then [`AGENTS.md`](../../AGENTS.md). Talk to the owner in
**French**; write everything in the repository in **English**.

## Non-negotiable rules

1. **Docker only**: never run `node`/`pnpm` on the host; use `make`
   (`make help`). Docker is rootless on the owner's machine (handled by the
   Makefile).
2. **Ask before** adding dependencies, tools (browsers, Playwright, ...),
   changing the Docker image, or running expensive diagnostics.
3. **Performance first** for rendering: count the per-pixel cost of any
   shader or effect; heavy effects must be optional and off by default.
4. **Commits**: one per significant step, Conventional Commits, with the
   `Co-Authored-By` trailer; `make check` must pass. **Never push** unless
   the owner explicitly asks in the current exchange.
5. **Docs in the same commit**: TSDoc on exports, `CHANGELOG.md`
   `[Unreleased]`, relevant `docs/wiki/*.md` page.
6. **Layering** (ESLint-enforced): `src/core` pure TypeScript,
   `src/render` Three.js, `src/app` Vue and input.
7. **Reports** to the owner end with a numbered **« Recette »** checklist.
8. Do not commit the owner's local `allowedHosts` change in
   `vite.config.ts` (Tailscale host).

## Repository map

| Path                                                                       | What                                                                                                                        |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `src/core/voxel.ts`, `voxelMap.ts`, `chunk.ts`, `coords.ts`                | Voxel encoding, sparse chunked map, dirty tracking.                                                                         |
| `src/core/shapes.ts`                                                       | FULL / SLOPE / CORNERS height-field shapes.                                                                                 |
| `src/core/surface.ts`                                                      | Logical surfaces, `resolveHit`, `resolveColumnHit`.                                                                         |
| `src/core/terrainSurface.ts`                                               | Faceted terrain model: runs, connected corner groups, heights and material weights.                                         |
| `src/core/generators/`                                                     | `referenceMap`, `organicMap`, `flatMap`, `catalog` (`?map=`).                                                               |
| `src/render/meshing/`                                                      | `terrainMesher` (facets, walls, water plane), `culledMesher` (blocks), `hybridMesher` (layers), `watertight` (test helper). |
| `src/render/terrainMaterial.ts`, `noiseTexture.ts`, `materials.ts`         | TSL materials per layer.                                                                                                    |
| `src/render/engine.ts`, `chunkRenderer.ts`, `cameraRig.ts`, `highlight.ts` | Engine loop, chunk meshes per layer, camera, hover patch.                                                                   |
| `src/app/`                                                                 | Vue shell, HUD, input bindings, debug edits, `config.ts`.                                                                   |
| `docs/wiki/`                                                               | Architecture, Conventions, Decisions (ADRs), Extending, maps, dev environment.                                              |

## URL switches

`?map=reference|organic|flat`, `&seed=<int>` (organic), `?mesher=blocky`,
`?forceWebGL=1`.

## State at handover

- Branch `dev`, last commit `de78de4` (plus this handover commit). Remote
  `dev` is at `59345c7` (v0.2.0); everything after is local.
- 145 tests pass. The owner approved the faceted terrain and shorelines
  (`b7937ce`). The procedural material `de78de4` is waiting for the owner's
  feedback on GPU load.

## How to start

1. `make image && make install && make check`.
2. Read [02-next-steps.md](02-next-steps.md) and
   [04-issues-and-fixes.md](04-issues-and-fixes.md).
3. Ask the owner for feedback on `de78de4` (GPU load, look) before starting
   water, lighting or GI, and confirm which of them to do first.
