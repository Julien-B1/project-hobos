# Conventions

Fixed project-wide conventions. Code in `src/core/coords.ts` is the reference
implementation; change both together.

## World frame and units

- Three.js frame: **Y is up**, the ground plane is **(x, z)**.
- **1 horizontal cell = 1 world unit.** Cell `(x, z)` covers
  `[x, x + 1) x [z, z + 1)`.
- **1 voxel = 0.5 world unit tall** (a half step). A full-height wall of one
  cell is 2 stacked voxels.
- Voxel coordinates are integers `(x, y, z)`; `y` is the half-height level.
  Level `y` covers world heights `[y * 0.5, (y + 1) * 0.5)`.
- World-to-grid conversions always use `Math.floor` (never truncation), so
  negative coordinates work: world x = -0.25 lies in cell -1.

## Voxels

A voxel is one `uint16` (`src/core/voxel.ts`):

```
 15            8 7       4 3       0
+---------------+---------+---------+
|   material    |  shape  | orient. |
+---------------+---------+---------+
```

- **material** (8 bits): id from `src/core/materials.ts`; `0` = air. Ids are
  never renumbered. Colours are a render concern.
- **shape** (4 bits) and **orientation** (4 bits): see _Shapes and
  orientations_ below.
- Any voxel with material 0 is air, whatever its other bits.

## Shapes and orientations

Defined in `src/core/shapes.ts`.

- Orientations are compass directions: **North = -Z, East = +X, South = +Z,
  West = -X**.
- Faces: `PX, NX, PY, NY, PZ, NZ`; the opposite face is `face ^ 1`.
- Every shape so far is a **height-field column**: solid from the voxel
  bottom up to a top surface given by 4 corner heights
  `[c00, c10, c11, c01]` (voxel units, 0..1; `c00` = north-west corner).

| Shape     | Id  | Top corners                                  | Faces                                                                                 |
| --------- | --- | -------------------------------------------- | ------------------------------------------------------------------------------------- |
| `FULL`    | 0   | all 1                                        | 6 full faces.                                                                         |
| `SLOPE`   | 1   | 1 on the high side (orientation), 0 opposite | Full bottom and high side, no low side, triangular sides, sloped top.                 |
| `CORNERS` | 2   | bit i of the orientation = corner i at 1     | Generic wedge: outer corner (1 bit), inner corner (3 bits), saddle (2 opposite bits). |

A slope rises by one voxel (0.5 world unit) across one cell.

Non-planar tops (corners, saddles) are two triangles split along
`topDiagonal()`: away from the odd corner for outer/inner corners, along the
high ridge for saddles. Meshing, `topHeightAt()` and the highlight share it.

**Face profiles** (`NONE`, `PARTIAL`, `FULL`) are derived from the corners.
Culling rule: a face is hidden only when the neighbour's touching face is
`FULL`.

**Surface**: the top of a non-air voxel whose voxel above is air
(`src/core/surface.ts`). A column can hold several surfaces (bridge over a
path).

## Picking: from a ray hit to a surface

`core/surface.resolveHit(map, point, normal)`:

1. The hit point is pushed 0.001 world unit into the mesh (against the
   normal) and floored to voxel coordinates (`y / 0.5`). Works for sloped
   faces too. If that voxel is air (the faceted terrain does not follow
   voxel faces), the point keeps moving inwards (steps of 0.125, up to 1.25
   world units) until it meets a solid voxel.
2. The targeted surface is in the same column as the touched voxel:
   - **top face** (normal mostly up, flat or sloped): the touched voxel;
   - **side face**: climb while the voxel above is solid, so a wall or cliff
     face targets the top of its stack;
   - **bottom face** (a ceiling seen from below, e.g. in a tunnel): the
     nearest surface below.

On faceted terrain, hits on upward facets use
`core/surface.resolveColumnHit(map, point)` instead: the surface of the
column under the point whose top is closest to the hit height.

The HUD shows the touched voxel and the surface as a column `(x, z)` plus
the surface voxel `y` and its level `y + 1`.

## Chunks and the map

- Chunks are **16 x 16 x 16 voxels**, stored as a dense `Uint16Array(4096)`
  indexed `x + z * 16 + y * 256`.
- Chunk coordinate = `v >> 4`, local coordinate = `v & 15`. Both are exact
  floor division / positive modulo for negative integers too.
- Chunk key: the string `"cx,cy,cz"`.
- `VoxelMap` is **sparse**: only chunks with at least one non-air voxel
  exist; reading elsewhere returns air; a chunk emptied by writes is deleted.
- **Dirty tracking**: a write that changes a voxel marks its chunk, the
  chunks above and below, and the side neighbours (faces, edges, corners)
  within `DIRTY_MARGIN = 2` voxels: 3 chunks for an interior voxel, up to 12
  near a column corner. The faceted terrain mesher reads whole column runs
  across chunk layers and the neighbouring columns.
  `drainDirty()` returns and clears the set; a dirty key may name a chunk
  that no longer exists (remove its mesh).

## Terrain and blocky materials

`isTerrainMaterial()` (`src/core/materials.ts`): grass, dirt, stone, rock,
sand and path are **terrain**; they are drawn as a faceted height surface.
Everything else is drawn as blocks: wood structures (bridges, trunks, future
stairs) keep sharp edges, leaves stay cubic, water is a flat block.

## Faceted terrain heights

`core/terrainSurface.ts`:

- A **run** is a vertical stretch of terrain voxels in a column; its top
  counts a wedge's partial height (+0.5 for a slope).
- Runs of the 4 cells around a lattice point **connect** when the higher
  column is solid down to the lower top and nothing covers the lower run
  below the higher top (max rise 12 levels). Connected runs share the mean
  of their tops as corner height.
- **Shores**: runs under water (beds) only group with other beds; a dry
  corner touching a water column is set to the water surface level.
- Each top is split into two triangles along the diagonal whose ends are
  closest in height (`facetDiagonal`); `facetHeightAt` samples it.

## Camera

- Yaw 0: the camera is on the +Z side of its target and looks towards -Z.
  Positive yaw turns counter-clockwise seen from above.
- Pitch is locked (40° by default, `src/app/config.ts`).

## Input

- Keys are bound with `KeyboardEvent.code` (physical position), so bindings
  are layout-independent. Docs name keys by their AZERTY label first.

## Code

- TSDoc states units explicitly: _world units_ vs _voxel units_ vs _CSS
  pixels_ vs _radians/degrees_.
- Tests live next to the module: `foo.ts` + `foo.test.ts`.
