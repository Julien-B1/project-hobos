# 5. Handover to a new agent

Read this first, then [`AGENTS.md`](../../AGENTS.md). Talk to the owner in
**French**; write everything in the repository in **English**.

## Non-negotiable rules

1. **Docker only**: never run `node`/`pnpm` on the host; use `make`
   (`make help`). Docker is rootless on the owner's machine (handled by the
   Makefile).
2. **Ask before** adding dependencies or tools, changing the Docker image,
   or running expensive diagnostics. Exception approved by the owner:
   `make screenshots` (Playwright in the image) for visual self-checks.
3. **Performance first** for rendering: count the per-pixel cost of any
   shader or effect; heavy effects must be optional and off by default.
4. **Commits**: the owner's standing rule is to commit each completed step
   (once `make check` passes) without asking, Conventional Commits with the
   `Co-Authored-By` trailer. Pushing `dev` is allowed whenever useful,
   without asking. Never push to `master`.
5. **Docs in the same commit**: TSDoc on exports, `CHANGELOG.md`
   `[Unreleased]`, relevant `docs/wiki/*.md` page, `AGENTS.md` when a rule
   or the layout changes; refresh this handover pack at the end of each
   topic.
6. **Layering** (ESLint-enforced): `src/core` pure TypeScript,
   `src/render` Three.js, `src/app` Vue and input.
7. **Reports** to the owner end with a numbered **« Recette »** checklist.
8. Do not commit the owner's local `allowedHosts` change in
   `vite.config.ts` (Tailscale host).

## Repository map

| Path                                                                       | What                                                                                                   |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `src/core/voxel.ts`, `voxelMap.ts`, `chunk.ts`, `coords.ts`                | Voxel encoding, sparse chunked map, dirty tracking.                                                    |
| `src/core/shapes.ts`, `surface.ts`                                         | Height-field shapes; logical surfaces, `resolveHit`, `resolveColumnHit`, `wadeThrough`.                |
| `src/core/terrainSurface.ts`, `trees.ts`                                   | Faceted terrain model (runs, corner groups, vaults); tree recognition.                                 |
| `src/core/structures/`                                                     | Structures (ADR-007): kinds, registry, `StructureSet`, bridges, crossing measure and choice.           |
| `src/core/generators/`                                                     | `riverMap`, `flatMap`, `kitchenSinkMap`, `bridgesShowcaseMap`, `catalog` (`?map=`).                    |
| `src/render/meshing/`                                                      | Terrain (facets, crags, walls, water), blocks, trees, scatter, hybrid layers, cap, watertight helpers. |
| `src/render/structures/`, `src/render/geometry/`                           | One mesher per structure kind; closed primitives (box, beam, tube, hexahedron, slab stone, boulder).   |
| `src/render/*Material.ts`, `outputEncoding.ts`, `sectionCap.ts`            | TSL materials per layer; tone mapping in materials (ADR-009); stencil cut section (ADR-008).           |
| `src/render/engine.ts`, `chunkRenderer.ts`, `cameraRig.ts`, `highlight.ts` | Engine loop, probes, picking and cursor, chunk meshes per layer, camera.                               |
| `src/app/`                                                                 | Vue shell, HUD, map picker, time of day, cut slider, input bindings, `config.ts`.                      |
| `scripts/screenshots.mjs`, `tooling/gzip.ts`                               | Headless screenshots; gzip dev server.                                                                 |
| `docs/wiki/`                                                               | Architecture, Conventions, Decisions (ADR-001 to 010), Extending, Structures, maps, dev environment.   |

## URL switches

`?map=river|flat|kitchen-sink|bridges` (default `river`), `&seed=<int>`
(random when absent) `&size=<n>` (river, default 40),
`?cam=x,z,distance,yaw`, `?spawn=x,z`, `?time=dawn|...|late-night`,
`?shadows=off|low|high`, `?grid=off`, `?hud=on`, `?mesher=blocky`,
`?forceWebGL=1`. The map picker (bottom right) switches map, seed and size
without reload.

## Builds and versions

- Milestones `vX.Y.0`, tester pre-releases `vX.Y.0-demo.N` (see
  `AGENTS.md`, Git workflow); desktop builds with `make release`, attached
  to the GitHub release; the corner badge shows tag, commits after it and
  hash.
- Web host: `make deploy` on the owner's server (wiki _Deployment_).
- `make wiki-publish` needs the owner's SSH access: ask the owner to run it.

## State at handover

- Branch `dev`, milestone `v0.3.0` tagged and pushed on 2026-11-20.
- 274 tests pass. The owner validated the terrain, the bridges, the
  character, the launch flow, the desktop demo and the web deployment.
- The owner's machine: rootless Docker, accesses the dev server over
  Tailscale (HTTP, so WebGL 2; WebGPU needs a secure context). Keep the
  local `allowedHosts` line of `vite.config.ts` out of commits.

## How to start

1. `make image && make install && make check`.
2. Read [02-next-steps.md](02-next-steps.md),
   [04-issues-and-fixes.md](04-issues-and-fixes.md) and the wiki's
   [Structures](../wiki/Structures.md) and [River Map](../wiki/River-Map.md)
   pages.
3. Check visually with `make screenshots` before reporting rendering work.
   Next topic: map archetypes (wait for the owner's brief).
