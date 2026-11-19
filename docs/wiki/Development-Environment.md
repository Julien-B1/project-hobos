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
