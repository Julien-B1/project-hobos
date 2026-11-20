# Production image of the web build, for a server behind Traefik
# (`deploy/compose.yaml`, wiki page _Deployment_).
#
# Stage 1 builds the game (same Node and pnpm as the dev image, see
# docker/Dockerfile.dev). The build uses relative URLs (`--base ./`), so
# the same files work at a domain root or under a sub-path such as
# /kratos/hobos/. It also writes the precompressed .br / .gz files.
# Stage 2 serves dist/ with nginx (Alpine packages, with the Brotli
# module): precompressed files, long cache for the hashed assets. Not
# Caddy: 2.10.2 answers 206 Partial Content to every precompressed file.
FROM node:24.22.3-bookworm-slim AS build

ARG PNPM_VERSION=12.18.0
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare "pnpm@${PNPM_VERSION}" --activate

WORKDIR /app
# Dependencies first: this layer is reused while the lockfile is unchanged.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# Version and commit of the corner badge: no .git here, `make deploy`
# passes them (see tooling/buildInfo.ts). Empty: package version, unknown.
ARG BUILD_DESCRIBE=
ARG BUILD_COMMIT=
ENV BUILD_DESCRIBE=${BUILD_DESCRIBE} BUILD_COMMIT=${BUILD_COMMIT}
RUN pnpm exec vue-tsc --build && pnpm exec vite build --base ./

FROM alpine:3.22
RUN apk add --no-cache nginx nginx-mod-http-brotli
COPY deploy/nginx.conf /etc/nginx/http.d/default.conf
COPY --from=build /app/dist /srv
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
