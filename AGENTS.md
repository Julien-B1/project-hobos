# Agent and contributor guide

Read this before changing anything. It applies to humans and AI agents alike.

## Project in one paragraph

Browser-first HD-2D voxel RPG prototype (native builds later): battle maps
of multi-level voxel terrain (bridges, tunnels, caves) drawn as natural
low-poly scenery, with characters moving on them. Milestones, current state
and roadmap: wiki page _Home_ ([`docs/wiki/Home.md`](docs/wiki/Home.md)).
Deeper documentation lives in [`docs/wiki/`](docs/wiki/) (published to the
GitHub wiki).

> Picking up the project? Start with the handover pack in
> [`docs/handover/`](docs/handover/README.md).

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
4. **Scope**: build what the project owner asked for, nothing more. The
   current topic and the roadmap are in the wiki _Home_ page; items the
   owner deferred are listed in
   [`docs/handover/02-next-steps.md`](docs/handover/02-next-steps.md). Do
   not start them, nor anticipate features nobody asked for (editor,
   save/load, rules, post-processing...).
5. **Language**: English everywhere in the repository (code, comments, docs,
   wiki, changelog, commit messages).

## Conventions (summary, details in the wiki _Conventions_ page)

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
- **This file** (`AGENTS.md`): keep it true. Update it in the same commit
  when a rule, the scope, the workflow or the repository layout changes.
- **Handover pack** (`docs/handover/`): keep it current at the end of each
  topic (summary, next steps, transcript, issues, agent briefing), so
  anyone can pick the project up without the conversation.

## Git workflow

- Repository: https://github.com/Julien-B1/project-hobos (public; the GitHub
  wiki needs a public repository on the free plan).
- Branches: `master` holds only the README (landing page). All work happens
  on `dev`, tagged at each validated milestone. Never merge `dev` into
  `master` unless the project owner asks.

- One commit per significant step, Conventional Commits
  (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`), scoped when
  useful (`feat(core): ...`).
- Commit each checked step (`make check` green). Pushing `dev` is allowed
  whenever useful; never push to `master`.
- Versions (wiki _Home_, table of milestones):
  - `vX.Y.0`: a milestone, one per finished topic group, with its own
    `CHANGELOG.md` section, the `package.json` and `neutralino.config.json`
    versions bumped, a GitHub release and `make wiki-publish`;
  - `vX.Y.0-demo.N`: a pre-release of the next milestone, for testers
    (desktop builds of `make release` attached as assets).
- The app's corner badge shows the last tag plus the commits after it
  (`tooling/buildInfo.ts`): tag before handing a build to testers.
