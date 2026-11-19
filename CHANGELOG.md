# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

### Changed

- The engine renders a voxel map instead of the step 1 flat grid; default
  camera distance raised to frame the 64 x 64 reference map.

- Branch model: `master` holds only the README, work happens on `dev`.

### Removed

- Step 1 flat grid (`core/generators/flatGrid`, `render/gridMesh`),
  superseded by the flat voxel test map.

### Fixed

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

[Unreleased]: https://github.com/Julien-B1/project-hobos/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Julien-B1/project-hobos/releases/tag/v0.1.0
