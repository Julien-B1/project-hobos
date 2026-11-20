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
make preview     # serve the production build on http://localhost:5173
make sh          # shell inside the container
```

Both servers compress their responses (Brotli on HTTPS and localhost,
gzip otherwise). Over a slow link, prefer `make build` then `make
preview`: about 0.45 MB on the wire, cached by the browser until the next
version, against about 1.2 MB in many modules for the dev server.

Maps are battle-map sized (one encounter). The app starts on the `river`
map (40 x 40 squares) with a random seed, the camera close on the
character, behind a loading screen (also shown at each map change); the
farthest zoom shows the whole map. URL switches:
`?forceWebGL=1` forces the WebGL 2 backend; `?seed=42` and `?size=24` fix
the river map's seed and size; `?map=reference`, `?map=flat`,
`?map=kitchen-sink` (every element in one hand-made map) or `?map=bridges`
(100 x 24 river, one crossing of each kind) loads another test map;
`?hud=on` starts with the debug HUD shown. The map picker at the bottom right switches map, seed (🎲 for
a random one) and size without reloading, and updates the URL to match; `?cam=x,z,distance,yaw` frames the camera on
start; `?time=dusk` (or `dawn`, `morning`, `noon`, `afternoon`,
`evening`, `midnight`, `late-night`) sets the time of day, also chosen with
the picker at the top right; `?mesher=blocky` shows exact voxel blocks instead of the
faceted terrain; `?shadows=off`, `low` or `high` (default) sets the sun
shadow quality.

### Controls

Keys are bound by physical position: the same keys work on AZERTY and QWERTY.

| Action                 | Input                                                                   |
| ---------------------- | ----------------------------------------------------------------------- |
| Move the camera target | `Z` `Q` `S` `D` (AZERTY) / `W` `A` `S` `D`, arrows                      |
| Rotate by 45° steps    | `A` / `E` (AZERTY) / `Q` / `E` (QWERTY)                                 |
| Free rotation          | Left mouse drag                                                         |
| Pan                    | Middle mouse drag                                                       |
| Zoom                   | Mouse wheel, `R` / `F`, numpad `+` / `-`                                |
| Reset view             | `C` or `Home` (centred on the character)                                |
| Show / hide the grid   | `G`                                                                     |
| Show / hide controls   | The round `?` button at the top left                                    |
| Show / hide debug HUD  | The round bug button at the top left                                    |
| Show / hide overlays   | `H` (HUD, pickers, cut slider)                                          |
| Performance probes     | `1` to `6` (shadows, foliage, scatter, water, terrain, half resolution) |
| Select the character   | Left click on it (left click elsewhere clears the selection)            |
| Move the character     | Right click on the destination (character selected)                     |
| Place voxel (debug)    | `Shift` + left click                                                    |

Camera settings (pitch, FOV, zoom bounds, speeds) live in `src/app/config.ts`.

### Desktop demo

`make release` builds desktop executables (Neutralino) into
`release/hobos/`: `hobos-win_x64.exe` for Windows 10/11 (about 4 MB, no
install), a Linux AppImage `hobos-x86_64.AppImage` (needs WebKitGTK,
`libwebkit2gtk-4.1`), plus Linux and macOS binaries. They run offline
(everything embedded). Demo builds are published as GitHub pre-releases.

### Server

`deploy/` holds the production image (nginx, precompressed files) and a
Compose file for Traefik, published at
<https://labo.taverne-des-rolistes.fr/kratos/hobos/>. On the server:
`make deploy` (pull, rebuild, restart). See the wiki page _Deployment_.

## Branches

`master` only holds this README. Code and documentation live on the
[`dev`](https://github.com/Julien-B1/project-hobos/tree/dev) branch; releases
are tags on `dev`.

## Documentation

- [Wiki](https://github.com/Julien-B1/project-hobos/wiki) (architecture,
  conventions, development environment, decisions), sourced from
  [`docs/wiki/`](docs/wiki/).
- Rules for contributors and AI agents: [`AGENTS.md`](AGENTS.md).
