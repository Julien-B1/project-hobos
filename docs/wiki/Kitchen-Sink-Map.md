# Kitchen-sink map

`src/core/generators/kitchenSinkMap.ts` builds a **hand-made** (not
procedural) sample board that holds every element the engine supports, each
in its own plot. Open it with `?map=kitchen-sink`. Exact coordinates are
exported as `KITCHEN_SINK_LAYOUT`.

Size: 40 x 32 cells (one cell = one 5 ft battle-map square). Flat grass at
surface level 6, water surface at level 5.

## Layout

| Row | Plot (cells x, z)                                       | What it shows                                                       |
| --- | ------------------------------------------------------- | ------------------------------------------------------------------- |
| A   | x 2..6, 8..12, 14..18, 20..24, 26..30; z 2..7           | Ground swatches: dirt, sand, rock, stone, path (and their scatter). |
| A   | mound x 34..36, z 4..5, wedges around                   | Slopes in 4 orientations and corner wedges.                         |
| B   | (3, 15), (9, 15), (15, 15), (20, 15)                    | Oak, birch, pine, bush.                                             |
| B   | arch x 23..28, z 13..16, passage x 25..26               | Natural rock arch: passage under the rock (two surfaces).           |
| B   | ramp x 30..33, platform x 34..38, z 13..16              | Brick slopes climbing to a brick platform (level 10).               |
| C   | hill x 2..11, z 22..30 (top 13); cave z 25..27          | Faceted hill, cave mouths, cave floor under the hill top.           |
| C   | pond centre (19, 26), radius 6; dock x 14..17           | Deep and shallow water, beach, planks on the water.                 |
| C   | canal x 33..35, path x 31..32, bridge x 32..36 z 24..25 | Wooden beam bridge structure over the canal (two surfaces).         |

Natural relief (hill, cave, rock arch) uses terrain materials, drawn
faceted: slopes all around, and vertical faces only around the openings
(opening rule of `core/terrainSurface.ts`: runs around a corner touched by a
covered run only join when they agree on it). Built structures use block
materials (`WOOD`, `STONE_BRICK`) and keep sharp edges with plank and brick
patterns.

## Tests

`kitchenSinkMap.test.ts` checks determinism, the size, that every material,
shape and tree kind is present, the stacked surfaces (bridge, cave, arch),
deep water, the brick ramp and the relief heights.
