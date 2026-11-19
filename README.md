# project-hobos

Browser-first 2.5D role-playing game prototype with an HD-2D look: multi-level
block terrain (bridges, tunnels, caves) rendered in 3D, with 2D billboard
sprites planned later. Native builds for all platforms are a later goal.

> Working title. The final product name is not decided yet.

Current scope: technical foundation (rendering, camera, picking) and a
multi-level voxel map. See [`BOOTSTRAP.md`](BOOTSTRAP.md) for the original
specification and [`CHANGELOG.md`](CHANGELOG.md) for progress.

## Stack

| Concern            | Choice                                                                 |
| ------------------ | ---------------------------------------------------------------------- |
| Language           | TypeScript (strict)                                                    |
| Rendering          | Three.js `WebGPURenderer` (`three/webgpu`), automatic WebGL 2 fallback |
| App shell / HUD    | Vue 3                                                                  |
| Build / dev server | Vite                                                                   |
| Tests              | Vitest                                                                 |
| Lint / format      | ESLint (flat config) + Prettier                                        |
| Package manager    | pnpm (via Corepack)                                                    |
| Dev environment    | Docker + Docker Compose, driven by `make`                              |

Why these choices: see the wiki page _Decisions_.

## Setup

Requirements on the host: **Docker** (with Compose v2), **make**, and a recent
browser (WebGPU: Chrome/Edge 113+, or any browser with WebGL 2 as fallback).
Node and pnpm are **not** needed on the host: everything runs in a container.

```sh
make image     # build the development image
make install   # install dependencies inside the container
make up        # start the dev server, then open http://localhost:5173
```

## Usage

```sh
make help        # list all targets
make up          # dev server with hot reload (Ctrl+C to stop)
make test        # unit tests
make lint        # ESLint
make typecheck   # vue-tsc
make check       # lint + typecheck + tests
make build       # production build into dist/
make sh          # shell inside the container
```

URL switches: `?forceWebGL=1` forces the WebGL 2 backend; `?map=flat` or
`?map=organic` (with optional `&seed=42`) loads another test map instead of
the reference map; `?mesher=blocky` shows exact voxel blocks instead of the
faceted terrain.

### Controls

Keys are bound by physical position: the same keys work on AZERTY and QWERTY.

| Action                 | Input                                              |
| ---------------------- | -------------------------------------------------- |
| Move the camera target | `Z` `Q` `S` `D` (AZERTY) / `W` `A` `S` `D`, arrows |
| Rotate by 45° steps    | `A` / `E` (AZERTY) / `Q` / `E` (QWERTY)            |
| Free rotation          | Left mouse drag                                    |
| Pan                    | Middle mouse drag                                  |
| Zoom                   | Mouse wheel, `R` / `F`, numpad `+` / `-`           |
| Reset view             | `C` or `Home`                                      |
| Remove voxel (debug)   | Right click                                        |
| Place voxel (debug)    | `Shift` + left click                               |

Camera settings (pitch, FOV, zoom bounds, speeds) live in `src/app/config.ts`.

## Branches

`master` only holds this README. Code and documentation live on the
[`dev`](https://github.com/Julien-B1/project-hobos/tree/dev) branch; releases
are tags on `dev`.

## Documentation

- [Wiki](https://github.com/Julien-B1/project-hobos/wiki) (architecture,
  conventions, development environment, decisions), sourced from
  [`docs/wiki/`](docs/wiki/).
- Rules for contributors and AI agents: [`AGENTS.md`](AGENTS.md).
