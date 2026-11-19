# Structures

Parametric objects placed on a map: bridges now, buildings later. The
design is recorded in [[Decisions]] (ADR-007).

## Pieces

| Piece                                                                      | Layer  | Role                                                                            |
| -------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------- |
| `Structure` (`core/structures/structure.ts`)                               | core   | `{ id, kind, params }`, immutable.                                              |
| `StructureKind`, `defineKind`                                              | core   | Bounds and stamp of one kind; parameters checked by a type guard.               |
| `StructureRegistry` (`registry.ts`)                                        | core   | Entries by id (kinds on the core side, meshers on the render side).             |
| `StructureSet` (`structureSet.ts`)                                         | core   | Structures of a map: `place` stamps and indexes; `owns`, `ownerOf`, `inChunk`.  |
| `defaultStructureKinds()` (`kinds.ts`)                                     | core   | Every built-in kind.                                                            |
| `BridgeSpan` (`bridges/bridgeSpan.ts`)                                     | core   | Where a crossing goes (axis, bank cells, width, deck, bed, water); `stampDeck`. |
| `StructureMesher`, `defineMesher` (`render/structures/structureMesher.ts`) | render | Draws one kind from its parameters.                                             |
| `defaultStructureMeshers()` (`render/structures/index.ts`)                 | render | Every built-in mesher.                                                          |
| Primitives (`render/geometry/primitives.ts`)                               | render | Closed `box`, `beam`, capped `tube`, `catenary`, `hash3`.                       |
| `bridgeFrame` (`render/structures/bridgeFrame.ts`)                         | render | Span-local coordinates (u along, v across, y) to world.                         |

`HybridMesher` takes the map's `StructureSet`: owned voxels are left out
of the blocks, and each structure's mesh is added to the blocks layer of
its home chunk (pickable, shadowed, cut like the rest).

## Adding a kind

1. Core: a module with its parameter type, a type guard, `bounds` and
   `stamp` (write only inside the bounds; return the owned voxels), built
   with `defineKind`; add it to `defaultStructureKinds()`. Test the stamp.
2. Render: a mesher built with `defineMesher` from the same id, using the
   primitives (closed volumes only); add it to `defaultStructureMeshers()`.
   Test that its output is closed (`unmatchedEdges`) and deterministic.
3. Place it from a generator with `StructureSet.place`.

## Kinds

All bridges take a `BridgeSpan`: deck flush with the banks (`deckY` is
the banks' top voxel), deck voxels stamped only where there is no ground.

| Kind                | Gameplay voxels                                                                                                   | Look                                                                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `wood-beam-bridge`  | WOOD deck                                                                                                         | Sills bedded in the banks, trestle bents (posts, cap, X bracing) at most 3.5 apart, stringers, transverse planks, railings.                   |
| `slab-bridge`       | STONE_BRICK deck                                                                                                  | Masonry abutments, piers with cutwaters on both faces at most 2.6 apart, one thick slab per bay.                                              |
| `stone-arch-bridge` | STONE_BRICK deck on the hump profile (`humpProfile`: one level per cell up to 3, SLOPE voxels where it climbs)    | Segmental arch of voussoirs springing above the water, spandrel fill and abutments up to the paved deck (same profile), parapets with coping. |
| `rope-bridge`       | WOOD deck at the sagging deck's level, rounded (`ropeDeckHeight`, sag 1/12 of the span, kept 0.3 above the water) | Anchor posts with guy ropes to stakes, foot ropes carrying the planks, hand ropes, suspenders.                                                |
| `fallen-log`        | WOOD walk one level above the banks                                                                               | Tapered bark trunk resting on both banks, root plate with roots, branch stubs.                                                                |
| `stepping-stones`   | STONE_BRICK stone at the water surface in each flooded cell                                                       | Rough flat stones (`slabStone`) on the bed, turned and offset.                                                                                |
| `ford`              | Gravel (PATH, terrain) raising the bed to one level under the water; owns nothing                                 | Boulders lining both sides in the water, a marker post at each corner on the banks.                                                           |

Core and render share the deck profiles (`humpProfile`, `ropeDeckHeight`),
so walkable voxels, picking and the hover cursor match the drawn deck. A
kind whose walking surface differs from its voxels' tops (the sagging rope
deck) gives it through `StructureKind.surfaceAt`, which the hover cursor
follows. Ground decoration (`ScatterMesher`) stays out of every
structure's bounds (`StructureSet.within`): no reed through a deck resting
on a bank.

## Choosing and placing a crossing

- `measureCrossing` (`bridges/riverCrossing.ts`): along a row through a
  flooded cell, picks the deck level that meets the ground flush on both
  sides (for each level from one above the water up, the ends are the
  first dry cells outwards reaching it, accepted when no more than one
  level higher; the shortest span wins), so banks of different heights get
  a deck reaching up the low side's slope instead of running into the high
  bank; an end whose bank stands a level above the deck is pulled in one
  cell, so the deck stops against the bank (a half step) instead of
  burying its last planks. In a canyon (both banks climbing, by 0.75 level per cell or more,
  to crests 5 levels or more above the water) the deck stays at the lower
  crest and the bridge spans the valley from plateau to plateau. Without
  any flush level (a shore flat at water level to the map's edge), the
  first dry cells and a deck a level above the water. It also
  measures the water width and the depth.
- `CROSSING_RULES` (`bridges/crossings.ts`): what each kind needs (narrow
  water for a log or stepping stones, shallow water for a ford or stepping
  stones, height above the water for a rope bridge...; the wooden beam
  bridge fits any site). `pickCrossing(site, seed)` picks among the fitting
  kinds with the seed.
- The organic map scores every row crossing the river and keeps the best:
  short span and narrow water, near the middle, never within 12 % of the
  map's edge, a deck meeting both banks (`CrossingSite.flush`), and easy
  approaches (`approachCost`: climb and bare rock over the 4 cells beyond
  each end, so a bridge does not land at the foot of a slope or a cliff).
  Trees keep 5 cells clear beyond the ends and 4 on the sides. A map
  flooded from edge to edge (a lake) gets none.

## Showcase map

`?map=bridges` (`core/generators/bridgesShowcaseMap.ts`, 100 x 24): a river
along X with seven crossing slots (`BRIDGES_LAYOUT.slots`): fallen log,
stepping stones, ford, wooden beam bridge, slab bridge, stone arch bridge,
rope bridge, each with a suitable river width and depth and a path across.
A slot is filled only when its kind is registered.
