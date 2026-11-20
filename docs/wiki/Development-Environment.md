# Development environment

All tooling (Node, pnpm, Vite, Vitest, ESLint, TypeScript) runs inside a
Docker container. The host needs only Docker with Compose v2, `make`, `git`
and a browser. This keeps the setup identical on every machine.

## Components

| File                              | Role                                                                                                |
| --------------------------------- | --------------------------------------------------------------------------------------------------- |
| `docker/Dockerfile.dev`           | Dev image: Node 24 (Debian slim), pnpm pinned through Corepack. No source code copied in.           |
| `compose.yaml`                    | Service `app`: bind-mounts the repository at `/app`, publishes port 5173, runs as the host uid/gid. |
| `Makefile`                        | Single entry point. Every target wraps `docker compose run --rm app ...`.                           |
| `.devcontainer/devcontainer.json` | Optional VS Code "Reopen in Container" setup on the same service.                                   |

## First run

```sh
make image     # build the image (once, or after Dockerfile changes)
make install   # pnpm install, writes node_modules/ and pnpm-lock.yaml
make up        # dev server, open http://localhost:5173
```

## Daily targets

| Target                          | What it does                                            |
| ------------------------------- | ------------------------------------------------------- |
| `make up` / `make down`         | Start / stop the Vite dev server (hot reload).          |
| `make test` / `make test-watch` | Vitest, once or in watch mode.                          |
| `make lint` / `make format`     | ESLint / Prettier (`make format-check` only checks).    |
| `make typecheck`                | `vue-tsc --build` (app and tooling tsconfigs).          |
| `make check`                    | Lint, format check, typecheck, tests. Before commits.   |
| `make build` / `make preview`   | Production build into `dist/` / serve it.               |
| `make screenshots`              | Headless Chromium captures into `screenshots/`.         |
| `make sh`                       | Bash inside the container.                              |
| `make wiki-publish`             | Mirror `docs/wiki/` to the GitHub wiki (host-side git). |

## Design notes

- **File ownership.** The Makefile exports `CONTAINER_UID`/`CONTAINER_GID`
  and Compose runs the container with that user, so `node_modules/`, `dist/`
  and the lockfile belong to you:
  - rootful Docker: your host uid/gid;
  - rootless Docker (detected with `docker info`): `0:0`, because container
    root is mapped to your host user; any other container uid would map to an
    unprivileged sub-uid that cannot write the bind mount.

  The image makes its shared folders writable by any uid, so this works
  whatever the uid.

- **node_modules on the host.** It lives in the bind mount on purpose: editor
  extensions on the host (ESLint, Vue/TypeScript language server) can resolve
  packages without a dev container. Binaries inside it are built for
  Linux x64; on macOS hosts prefer the dev container.
- **pnpm store.** A named volume (`pnpm-store`) keeps downloaded packages
  between container runs. Because it is on another filesystem than
  `node_modules`, pnpm copies files instead of hard-linking them. This is
  expected.
- **WebGPU.** The renderer runs in your browser, not in the container.
  `http://localhost` is a secure context, which WebGPU requires.

## Screenshots

`make screenshots` (`scripts/screenshots.mjs`) starts its own Vite server in
the container, opens the app in headless Chromium (Playwright, installed in
the image) and saves one PNG per view into `screenshots/` (git-ignored).
Without a GPU, the page runs on the WebGL 2 backend rendered in software
(SwiftShader): slow, and close to but not exactly a real GPU's image.
Default views: the bridges map and each of its crossings. Custom views:
`make screenshots VIEWS=screenshots/views.json`, a JSON array of
`{ "name", "query" }` where the query is the page's URL query, e.g.
`map=organic&seed=7&cam=16,16,30,35` (`cam=x,z,distance,yaw` frames the
camera). Playwright is pinned in `package.json` and in the Dockerfile
(`PLAYWRIGHT_VERSION`); keep them equal, then `make image`.

## Desktop demo

`make release` packages the production build as desktop executables with
[Neutralino](https://neutralino.js.org/) (`@neutralinojs/neu` 11.8.0, dev
dependency; runtime 6.10.0, `neutralino.config.json`): a small native
window around the system web view, the game files embedded in the
executable. Output in `release/hobos/` (git-ignored): `hobos-win_x64.exe`
(about 4 MB), Linux and macOS binaries, a Linux AppImage
(`hobos-x86_64.AppImage`, about 2.3 MB) and a zip of them all. The
runtimes are downloaded once into `bin/` (git-ignored). The build skips
the precompressed `.br` / `.gz` files (`PRECOMPRESS=off`): the window
serves files locally.

The demo runs fully offline: code, styles and models are embedded, maps
are generated, and the build loads nothing from the network (no CDN, no
remote font). The only external requirement is the system web view.

On Windows the web view is WebView2 (Edge, Chromium): WebGPU works,
WebView2 ships with Windows 11 and up-to-date Windows 10. On Linux the
binary needs WebKitGTK (`libwebkit2gtk-4.1`), whose WebGPU support is
limited: the WebGL 2 fallback is used. The AppImage
(`scripts/appimage.mjs`) wraps that same binary with a desktop entry and
an icon (`tooling/appimage/hobos.png`) for desktop integration; it does
not bundle WebKitGTK (about 100 MB), so the system one is still needed.
appimagetool 1.9.1 and the type2 runtime are downloaded into
`bin/appimage/`, pinned by SHA-256, and run extracted
(`APPIMAGE_EXTRACT_AND_RUN`: no FUSE in containers); the dev image
provides the `file` command they need. macOS builds are unsigned
(right click, Open, the first time).

Publishing a demo: `make release`, tag the commit (`vX.Y.Z-demo.N`), push
`dev` with the tag, then `gh release create <tag> --prerelease` with the
executables.

## Troubleshooting

- **Hot reload does not trigger.** File events may not cross the mount when
  the repository sits on a Windows drive (`/mnt/c/...`) under WSL. Move the
  repository to the Linux filesystem, or start with polling:
  `VITE_USE_POLLING=true make up`.
- **Port 5173 already in use.** Stop the other process or `make down`; the
  dev server uses a strict port and will not pick another one.
- **Permission errors on files.** Run `make` (not raw `docker compose`) so
  `CONTAINER_UID` is computed. If you call Compose directly, export it
  yourself (`0` with rootless Docker, `id -u` otherwise).

## Branches and releases

| Branch   | Content                                                    |
| -------- | ---------------------------------------------------------- |
| `master` | README only (public landing page).                         |
| `dev`    | All code and docs. Releases are tags `vX.Y.Z` on this one. |

Release at each validated milestone: freeze `CHANGELOG.md`, bump
`package.json`, commit `chore(release): X.Y.Z`, tag `vX.Y.Z`, push `dev` with
tags, then `make wiki-publish`.
