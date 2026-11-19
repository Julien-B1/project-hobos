# Agent and contributor guide

Read this before changing anything. It applies to humans and AI agents alike.

## Project in one paragraph

Browser-first HD-2D voxel RPG prototype. Original specification:
[`BOOTSTRAP.md`](BOOTSTRAP.md). Deeper documentation lives in
[`docs/wiki/`](docs/wiki/) (published to the GitHub wiki).

## Hard rules

1. **Docker only.** Never run `node`, `pnpm` or `npx` on the host. Use the
   `make` targets (`make help`), which run inside the `app` container.
2. **Layering** (enforced by ESLint `no-restricted-imports`):
   - `src/core/`: pure TypeScript. No import of `three`, `vue`, `src/render`
     or `src/app`. Holds map data, coordinates, shapes, generators, and pure
     geometry/picking maths.
   - `src/render/`: everything Three.js. Reads `core`, never mutates map data
     itself. No import of `vue` or `src/app`.
   - `src/app/`: Vue shell, HUD, input wiring. The only layer that mutates the
     map in response to user input.
3. **Tests**: every module in `src/core/` has unit tests (`*.test.ts` next to
   the module). `make check` must pass before every commit.
4. **Scope**: follow the current step of `BOOTSTRAP.md`. Do not anticipate
   out-of-scope features (navigation graph, A*, tokens, sprites, occlusion
   fading, post-processing, editor, save/load).
5. **Language**: English everywhere in the repository (code, comments, docs,
   wiki, changelog, commit messages).

## Conventions (summary, details in the wiki *Conventions* page)

- Three.js frame: Y up, horizontal plane is (x, z).
- 1 horizontal cell = 1 world unit. 1 voxel is 0.5 world unit tall.
- Voxel coordinates are integers; `y` is the half-height level index.
- Chunks are 16 x 16 x 16 voxels, stored sparsely.
- A voxel is 16 bits: 8 bits material (0 = air), 4 bits shape, 4 bits
  orientation.

## Documentation duties

Update documentation **in the same commit** as the code:

- TSDoc on every exported symbol (purpose, units: voxel or world, invariants).
  Comment non-obvious logic (why, not what).
- `CHANGELOG.md`: add an entry under `[Unreleased]` (Keep a Changelog format).
- `docs/wiki/*.md`: update the relevant page when architecture, conventions or
  workflows change.
- `README.md`: only setup, stack and usage; keep it short.

## Git workflow

- One commit per significant step, Conventional Commits
  (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`), scoped when
  useful (`feat(core): ...`).
- Push only at validation milestones, after the project owner approves.
  Releases are tagged `vX.Y.Z` and the wiki is published with
  `make wiki-publish` at the same time.
