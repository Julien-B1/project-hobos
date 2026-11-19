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
- **shape** (4 bits) and **orientation** (4 bits): see the shapes section.
- Any voxel with material 0 is air, whatever its other bits.

## Chunks and the map

- Chunks are **16 x 16 x 16 voxels**, stored as a dense `Uint16Array(4096)`
  indexed `x + z * 16 + y * 256`.
- Chunk coordinate = `v >> 4`, local coordinate = `v & 15`. Both are exact
  floor division / positive modulo for negative integers too.
- Chunk key: the string `"cx,cy,cz"`.
- `VoxelMap` is **sparse**: only chunks with at least one non-air voxel
  exist; reading elsewhere returns air; a chunk emptied by writes is deleted.
- **Dirty tracking**: a write that changes a voxel marks its chunk, plus the
  face-adjacent chunk on each axis where the voxel is on the border
  (local 0 or 15). Up to 4 chunks for a corner voxel. Diagonal chunks are not
  marked because face culling only looks at the 6 face neighbours.
  `drainDirty()` returns and clears the set; a dirty key may name a chunk
  that no longer exists (remove its mesh).

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
