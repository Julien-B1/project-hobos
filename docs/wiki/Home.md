# project-hobos wiki

Browser-first HD-2D voxel RPG prototype. This wiki is the in-depth
documentation; the repository README only covers setup and daily usage.

> Source of truth: `docs/wiki/` in the main repository. Edit the files there
> and publish with `make wiki-publish`. Edits made directly in the GitHub wiki
> UI are overwritten on the next publish.

## Pages

- [[Architecture]]: layers and import rules, tooling.
- [[Extending]]: add materials, shapes, meshers, test maps.
- [[River Map|River-Map]]: procedural natural-looking test map (`?map=river&seed=n`).
- [[Kitchen Sink Map|Kitchen-Sink-Map]]: hand-made map holding every element (`?map=kitchen-sink`).
- [[Structures]]: parametric map objects (bridges, later buildings), the seven
  river crossings, how a crossing is chosen and placed, the bridges showcase
  map (`?map=bridges`).
- [[Conventions]]: world frame, units, voxel levels, camera and input conventions.
- [[Development Environment|Development-Environment]]: Docker stack, `make`
  targets, dev container, troubleshooting.
- [[Decisions]]: architecture decision records (engine, UI framework, Docker,
  terrain rendering, trees, structures, cut section, output encoding).

## Status

Details per version: `CHANGELOG.md` in the repository. A milestone is
tagged `vX.Y.0`; its pre-releases for testers are `vX.Y.0-demo.N`
(desktop builds attached to the GitHub release).

| Milestone | Content                                                                                                                       | Status                |
| --------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| v0.1.0    | Foundation: scaffold, WebGPU scene, RO-style camera, grid picking                                                             | Done                  |
| v0.2.0    | Multi-level voxel map: chunks, meshing, surface picking (two surfaces in one column), targeted rebuild                        | Done                  |
| v0.3.0    | Battle maps: natural terrain, water, trees, time of day, cut, river crossings, one playable character, desktop demo, web host | Done (demo.1, demo.2) |
| v0.4.0    | Map archetypes: more kinds of generated battle maps                                                                           | Next                  |

Deferred by the owner, not scheduled: several wind intensities, GPU
optimisation, more character animations. Later topics announced:
buildings and set pieces on the structures system, gameplay objects
(furniture, spells) that follow the cut rule of ADR-011, several
characters.
