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
