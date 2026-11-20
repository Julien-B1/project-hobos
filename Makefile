# Single entry point for development tasks.
#
# Every Node/pnpm command runs inside the `app` container (see compose.yaml),
# so the host only needs Docker, make and a browser. Run `make help` for the list.

# Container user that maps to the host user, so files written in the bind
# mount belong to you:
# - rootful Docker: same uid/gid as the host user;
# - rootless Docker: container root (0:0) is mapped to the host user, while
#   any other container uid maps to an unprivileged sub-uid without write access.
DOCKER_ROOTLESS := $(shell docker info --format '{{.SecurityOptions}}' 2>/dev/null | grep -q rootless && echo 1)
ifeq ($(DOCKER_ROOTLESS),1)
CONTAINER_UID ?= 0
CONTAINER_GID ?= 0
else
CONTAINER_UID ?= $(shell id -u)
CONTAINER_GID ?= $(shell id -g)
endif
export CONTAINER_UID CONTAINER_GID

COMPOSE := docker compose
RUN     := $(COMPOSE) run --rm app

.DEFAULT_GOAL := help

.PHONY: help image install up down test test-watch lint format format-check typecheck build preview check screenshots models release deploy deploy-status deploy-logs deploy-restart deploy-down deploy-prune sh wiki-publish clean

help: ## List available targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

image: ## Build (or rebuild) the development image
	$(COMPOSE) build

install: ## Install dependencies (pnpm install) inside the container
	$(RUN) pnpm install

up: ## Start the Vite dev server on http://localhost:5173 (Ctrl+C to stop)
	$(COMPOSE) up app

down: ## Stop and remove the dev containers
	$(COMPOSE) down

test: ## Run unit tests once
	$(RUN) pnpm test

test-watch: ## Run unit tests in watch mode
	$(RUN) pnpm test:watch

lint: ## Run ESLint
	$(RUN) pnpm lint

format: ## Format the code base with Prettier
	$(RUN) pnpm format

format-check: ## Check formatting without writing
	$(RUN) pnpm format:check

typecheck: ## Type-check with vue-tsc
	$(RUN) pnpm typecheck

build: ## Production build into dist/
	$(RUN) pnpm build

preview: ## Serve the production build on http://localhost:5173
	$(COMPOSE) run --rm --service-ports app pnpm preview

check: lint format-check typecheck test ## Lint + format check + type-check + tests (run before each commit)

screenshots: ## Screenshots of the app in headless Chromium into screenshots/ (VIEWS=file.json for custom views)
	$(RUN) node scripts/screenshots.mjs $(VIEWS)

models: ## Rebuild src/assets/models/ from assets-src/models/ (Blender script per model if any, then host python3 + numpy + ffmpeg for the texture, then gltfpack)
	@mkdir -p tooling/.build
	for f in assets-src/models/*.glb; do \
	  name=$$(basename $$f); src=$$f; \
	  script=tooling/blender/$${name%.glb}.py; \
	  if [ -f $$script ]; then \
	    $(RUN) blender -b --factory-startup --python $$script -- $$f tooling/.build/$${name%.glb}.blend.glb >/dev/null || exit 1; \
	    src=tooling/.build/$${name%.glb}.blend.glb; \
	  fi; \
	  python3 -I tooling/compress_glb.py $$src tooling/.build/$$name --flat 12 --max-size 1024 --texture-only && \
	  $(RUN) pnpm exec gltfpack -i tooling/.build/$$name -o src/assets/models/$$name -cc -vpf -vtf || exit 1; \
	done

release: ## Desktop demo (Neutralino): build, then executables for Windows, Linux (+ AppImage) and macOS into release/hobos/
	$(RUN) sh -c "PRECOMPRESS=off pnpm build && { [ -f bin/neutralino-win_x64.exe ] || pnpm exec neu update; } && pnpm exec neu build --release --embed-resources && node scripts/appimage.mjs"

# Production deployment (on the server, see deploy/ and the wiki page Deployment).
PROD := $(COMPOSE) -f deploy/compose.yaml

deploy: ## Server: fetch dev (gh repo sync), rebuild and restart the production container
	gh repo sync --branch dev
	git fetch --tags --quiet || true
	BUILD_DESCRIBE="$$(git describe --tags --long 2>/dev/null)" BUILD_COMMIT="$$(git rev-parse --short HEAD)" $(PROD) up -d --build

deploy-status: ## Server: state of the production container
	$(PROD) ps

deploy-logs: ## Server: follow the production logs (Ctrl+C to stop)
	$(PROD) logs -f

deploy-restart: ## Server: restart the production container without rebuilding
	$(PROD) restart

deploy-down: ## Server: stop and remove the production container
	$(PROD) down

deploy-prune: ## Server: remove dangling images left by previous builds
	docker image prune -f

sh: ## Open a shell inside the dev container
	$(RUN) bash

wiki-publish: ## Publish docs/wiki/ to the GitHub wiki (runs on the host, needs git + ssh access)
	./scripts/publish-wiki.sh

clean: ## Remove build output and node_modules
	rm -rf dist node_modules coverage
