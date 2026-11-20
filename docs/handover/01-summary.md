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

### v0.3.0, part 1: organic terrain and rendering

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

### v0.3.0, part 2: battle-map rendering, structures and bridges

| Commit    | Content                                                                                                                                                                                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `59e06c4` | Battle-map pass: maps sized for one encounter (32 x 32), water, shadows, real trees (oak, pine, birch, bush), scatter, grid, time of day, kitchen-sink map, cut slider, debug HUD figures.                                                                          |
| `e0f8998` | Watertight crags (Freudenthal lattice), stencil cut section (ADR-008), terrain hover tint in the shader, earthy cave mouths and rocky interiors, gzip dev server.                                                                                                   |
| `2803ab9` | Structures (ADR-007) and seven river crossings; crossing choice and placement on the organic map (flush or canyon deck, best site); bridges showcase map; map picker; output encoding in the materials (ADR-009); performance probes; `make screenshots` (ADR-010). |
| `998b02a` | Ford boulders on the gravel in line with the posts; cursor on the bed of shallow water.                                                                                                                                                                             |
| `e20fe7d` | Cursor on the deck over banks under a bridge's end.                                                                                                                                                                                                                 |

### v0.3.0, part 3: character, distribution, launch flow (tagged 2026-11-20)

| Commit    | Content                                                                                                                |
| --------- | ---------------------------------------------------------------------------------------------------------------------- |
| `8e574a7` | Playable character (fighter.glb, idle and walk), selection, A* walk area, right click to move.                         |
| `a70b573` | Foot IK and standing stance lock; `ec3196d`, `cbee486`: cel shading, outline, real shadow, 1.6 units tall.             |
| `e4736cf` | `make models` (WebP texture, gltfpack meshopt); `c3377e6`: Brotli, precompressed build, immutable assets.              |
| `baac9d1` | Desktop demo with Neutralino (`make release`); `9be53fa`: Linux AppImage. Pre-release `v0.3.0-demo.1`.                 |
| `e037a3d` | The cut hides objects on the scenery whole (ADR-011, `CutSupported`).                                                  |
| `c933144` | `organic` map renamed `river`; `46e06c2`: random 40 x 40 river map at launch, loading screens, zoom fitted to the map. |
| `fcc4e90` | No dark triangles on steep banks (crag shading normal).                                                                |
| `e07a0cb` | Bug button (debug HUD) and `?` button (controls); `cf7b670`, `d1444f0`: time-of-day swatches, smooth transitions.      |
| `33154cb` | Web deployment behind Traefik (`deploy/`, `make deploy*`). Pre-release `v0.3.0-demo.2` (`7ae1264`).                    |
| `1e1c980` | Water shader fixed for Firefox WebGPU (Naga); `b749387`: version badge.                                                |
| (release) | Reference map and `BOOTSTRAP.md` removed, CHANGELOG reorganised, version 0.3.0, tag `v0.3.0`.                          |

## Current state in one paragraph

The voxel grid is the truth for terrain and gameplay. Terrain materials are
drawn as a faceted low-poly height surface with watertight crags where the
relief is marked; trees as round trunks and leaf cards; water as a flat
plane; built voxels as patterned blocks. Structures (bridges now, buildings
later) are parametric map objects: their kind stamps gameplay voxels, a
mesher per kind draws them from closed primitives. Every generated river
gets one crossing of a kind fitting the site. One character walks the map
(A* on the voxels, foot IK, cel shading); the cut hides it whole when its
ground is cut away. The app starts on a random 40 x 40 river map behind a
loading screen. It runs in the browser (web host at
`labo.taverne-des-rolistes.fr/kratos/hobos/`) and as an offline desktop
demo. 274 unit tests, lint and type-check pass (`make check`).
