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

.PHONY: help image install up down test test-watch lint format format-check typecheck build preview check screenshots sh wiki-publish clean

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

models: ## Rebuild src/assets/models/ from assets-src/models/ (host: python3 + numpy + ffmpeg for the texture, then gltfpack in the container)
	@mkdir -p tooling/.build
	for f in assets-src/models/*.glb; do \
	  name=$$(basename $$f); \
	  python3 -I tooling/compress_glb.py $$f tooling/.build/$$name --flat 12 --texture-only && \
	  $(RUN) pnpm exec gltfpack -i tooling/.build/$$name -o src/assets/models/$$name -cc -vpf -vtf || exit 1; \
	done

sh: ## Open a shell inside the dev container
	$(RUN) bash

wiki-publish: ## Publish docs/wiki/ to the GitHub wiki (runs on the host, needs git + ssh access)
	./scripts/publish-wiki.sh

clean: ## Remove build output and node_modules
	rm -rf dist node_modules coverage
