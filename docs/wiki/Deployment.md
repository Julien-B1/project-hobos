# Deployment

The web build runs on the lab server behind Traefik, at
<https://labo.taverne-des-rolistes.fr/kratos/hobos/> (one path per
developer and project: `/<developer>/<project>/`). The server builds the
image itself from a clone of the repository; no registry.

## Files

All in `deploy/`:

- `Dockerfile`: production image, two stages.
  1. Build: same Node and pnpm as the dev image,
     `pnpm install --frozen-lockfile`, then the type check and
     `vite build --base ./`.
     Relative URLs: the same files work at a domain root or under any
     sub-path. The build also writes the precompressed `.br` / `.gz`.
  2. Serve: Alpine nginx with the Brotli module (about 90 MB). It serves
     the precompressed files (`brotli_static`, `gzip_static`, also to
     proxied requests), caches `/assets/` for a year (`immutable`: hashed
     names change with each version) and revalidates `index.html`
     (`no-cache`). Not Caddy: 2.10.2 answers `206 Partial Content` to
     every precompressed file, without a `Range` request.
- `Dockerfile.dockerignore`: build context of that image (BuildKit reads
  it instead of the root `.dockerignore`, which serves the dev image).
- `nginx.conf`: the server block.
- `compose.yaml`: the service, on the external `web` network, with the
  Traefik labels:
  - router `Host(labo.taverne-des-rolistes.fr) && PathPrefix(/kratos/hobos)`
    on `websecure`, TLS with the `default` certificate resolver;
  - `kratos-hobos-slash`: redirects `/kratos/hobos` (query kept) to
    `/kratos/hobos/`, as relative URLs need the trailing slash;
  - `kratos-hobos-strip`: strips the prefix, the container serves `/`;
  - an HTTP router on `web` redirecting to HTTPS.

## First deployment

On the server, with Docker Compose v2, Traefik already running on the
external `web` network, `make` and the GitHub CLI (`gh`, which uses git:
install both):

```sh
gh auth login            # once per server
gh repo clone Julien-B1/project-hobos hobos -- --branch dev
cd hobos
make deploy
```

## Update

```sh
cd hobos
make deploy   # gh repo sync --branch dev, then docker compose -f deploy/compose.yaml up -d --build
```

`make deploy` also passes the version and commit to the build
(`BUILD_DESCRIBE`, `BUILD_COMMIT`: the image has no `.git`), shown in the
app's bottom-left badge: check it after a deployment. Without them (a bare
`docker compose up --build`) the badge shows the package version and
`unknown`. `gh repo sync` fast-forwards only: it refuses if the clone was changed on
the server. The build takes a minute or two (dependencies are cached in a
layer while the lockfile does not change); the old container serves until
the new one replaces it. Browsers pick up the new version on the next
visit (`index.html` is revalidated, the new assets have new names).

## Other targets

| Target                | Does                                               |
| --------------------- | -------------------------------------------------- |
| `make deploy-status`  | State of the container (`docker compose ps`)       |
| `make deploy-logs`    | Follow the logs (Ctrl+C to stop)                   |
| `make deploy-restart` | Restart without rebuilding                         |
| `make deploy-down`    | Stop and remove the container                      |
| `make deploy-prune`   | Remove the dangling images left by previous builds |

Check from outside:
`curl -sI https://labo.taverne-des-rolistes.fr/kratos/hobos/ | head -5`.

## Another project or path

Change the host, the path (`/kratos/hobos` in the router rules, the
redirect regex and the strip prefix) and the names (`kratos-hobos`: the
Compose project, the container, the routers, the middlewares; they must
be unique on the Traefik instance) in `compose.yaml`.
