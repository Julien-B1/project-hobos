# 1. Summary of the work done

Browser-first HD-2D voxel RPG prototype. Repository:
<https://github.com/Julien-B1/project-hobos> (public; `master` holds only the
README, all work is on `dev`).

## Stack

TypeScript (strict), Three.js r187 `WebGPURenderer` (WebGL 2 fallback),
TSL node materials, Vue 3 shell/HUD, Vite 8, Vitest, ESLint + Prettier,
pnpm. Everything runs in Docker through `make`. Rationale: wiki page
[Decisions](../wiki/Decisions.md) (ADR-001 to ADR-005).

## Milestones

### v0.1.0: step 1, foundation (tagged, pushed)

| Commit    | Content                                                                                |
| --------- | -------------------------------------------------------------------------------------- |
| `d5e1667` | Docker dev stack (rootless-aware Makefile, Compose, dev container), docs skeleton.     |
| `5fc9727` | Vite/Vue/TS scaffold, ESLint layer rules (`core` / `render` / `app`), mandatory TSDoc. |
| `320d1e7` | `WebGPURenderer` with backend detection (`?forceWebGL=1`), render loop, HUD.           |
| `613ee27` | RO-style orbit camera: locked pitch, 45° snaps, zoom, ZQSD pan (layout-independent).   |
| `d22c647` | 32 x 32 grid with hover picking.                                                       |
| `39c16c2` | Keyboard zoom (R/F, numpad +/-) and animated view reset (C / Home).                    |
| `4fde704` | Release 0.1.0.                                                                         |

### v0.2.0: step 2, multi-level voxel map (tagged, pushed)

| Commit    | Content                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------ |
| `d543bd0` | 16-bit voxels, sparse 16^3 chunked `VoxelMap`, dirty-chunk tracking.                                   |
| `ba61cb4` | Shapes (full, slope), deterministic reference map (river, path, bridge over path, cliff ramp, tunnel). |
| `50da000` | Culled chunk mesher with slope geometry.                                                               |
| `e806b3e` | Surface picking (`resolveHit`): two surfaces in one column (bridge over path) validated.               |
| `439f8cf` | Targeted rebuild, debug edits (right click remove, Shift + click place).                               |
| `59345c7` | Release 0.2.0.                                                                                         |

### After v0.2.0: organic terrain and rendering (local commits, **not pushed**)

| Commit    | Content                                                                                                          |
| --------- | ---------------------------------------------------------------------------------------------------------------- |
| `dceeae8` | Seeded noise utilities in core (hash, value noise, fBm).                                                         |
| `fb16b43` | Procedural organic test map (`?map=organic&seed=n`): hills, river, lakes, trees.                                 |
| `0220863` | `CORNERS` wedge shape, corner-aware slopes.                                                                      |
| `5bcaf4d` | Step limiting, rock patches, lighting tweak.                                                                     |
| `9d3f5de` | Surface-nets smooth terrain (**rejected** by the owner, superseded).                                             |
| `8d7723a` | Faceted low-poly terrain (`TerrainMesher`, `core/terrainSurface.ts`), ADR-005.                                   |
| `f404337` | Shore pinning attempt (made things worse, later reverted).                                                       |
| `003a308` | Exact terrain walls where neighbouring tops cross (real fix for bank slits).                                     |
| `b7937ce` | Terraces never below water; water drawn as a flat plane (smooth shorelines). **Validated by the owner.**         |
| `78f1cc6` | Per-layer chunk meshes (terrain, blocks, water); max zoom-out 240.                                               |
| `de78de4` | Cheap procedural terrain material (noise texture, blended transitions). **Awaiting owner feedback on GPU load.** |

## Current state in one paragraph

The voxel grid is the single source of truth for logic. Terrain materials
(grass, dirt, sand, rock, stone, path) are rendered as a faceted low-poly
height surface whose corner heights and material weights are averaged over
connected neighbouring runs; wood and leaves are rendered as blocks; water
is a flat plane drawn by the terrain mesher. The terrain shader samples a
small precomputed noise texture twice per pixel. 145 unit tests, lint and
type-check pass (`make check`).
