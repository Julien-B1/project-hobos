# project-hobos wiki

Browser-first HD-2D voxel RPG prototype. This wiki is the in-depth
documentation; the repository README only covers setup and daily usage.

> Source of truth: `docs/wiki/` in the main repository. Edit the files there
> and publish with `make wiki-publish`. Edits made directly in the GitHub wiki
> UI are overwritten on the next publish.

## Pages

- [[Architecture]]: layers and import rules, tooling.
- [[Reference Map|Reference-Map]]: layout of the deterministic test map and key columns to check.
- [[Extending]]: add materials, shapes, meshers, test maps.
- [[Organic Map|Organic-Map]]: procedural natural-looking test map (`?map=organic&seed=n`).
- [[Kitchen Sink Map|Kitchen-Sink-Map]]: hand-made map holding every element (`?map=kitchen-sink`).
- [[Conventions]]: world frame, units, voxel levels, camera and input conventions.
- [[Development Environment|Development-Environment]]: Docker stack, `make`
  targets, dev container, troubleshooting.
- [[Decisions]]: architecture decision records (engine, UI framework, Docker).

## Status

See `CHANGELOG.md` in the repository. Roadmap source: `BOOTSTRAP.md`.

| Step | Content                                                                                  | Status        |
| ---- | ---------------------------------------------------------------------------------------- | ------------- |
| 1    | Foundation: scaffold, WebGPU scene, RO-style camera, grid picking                        | Done (v0.1.0) |
| 2    | Multi-level voxel map: chunks, reference map, meshing, surface picking, targeted rebuild | Done (v0.2.0) |
