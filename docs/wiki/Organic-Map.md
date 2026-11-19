# Organic map

`src/core/generators/organicMap.ts` builds a procedural, natural-looking
test map. Open it with `?map=organic`; change the terrain with
`?map=organic&seed=42` (any integer). The same seed always gives the same
map.

## Pipeline

| Step         | What it does                                                                                                                                                                 | Main knobs                          |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Height field | 4-octave fBm at scale 72 cells, shaped with `smoothstep(0.2, 0.9)` and a 1.4 power (plains low, hills high), plus a gentle undulation. Three 3 x 3 box blurs, then rounding. | `9 + relief * 20 + detail` levels   |
| River        | Centre line along Z = sine bends + fBm offset; half-width 2 to 4.5 cells. Terrain is blended down to a bed 3 levels under water over 16 cells.                               | bend frequency 0.045, bank width 16 |
| Water        | Every column below level 10 is filled with water up to level 10 (river and natural lakes).                                                                                   | `WATER_LEVEL = 10`                  |
| Materials    | Stone core, 2 dirt layers, top: sand at or near water level, stone at level 27+, rock where a neighbour is 2+ levels away, grass otherwise.                                  | `PEAK_LEVEL`, `STEEP_STEP`          |
| Wedges       | For each dry column, a top corner is raised when one of the 3 other cells sharing it is higher; the raised-corner mask picks a slope, corner, saddle or full block on top.   | `shapeForCornerMask`                |
| Trees        | One candidate per 5 x 5 block (jittered), kept on flat grass; 85 % chance in forest patches (low-frequency noise mask), 12 % elsewhere. Trunk 4 to 6 voxels, leaf canopy.    | `BLOCK = 5`, forest threshold 0.55  |

Why wedges join cleanly: a corner is shared by 4 cells, and each of them
raises it to the same world height (one level above the lower cells), so
slopes, outer corners and inner corners meet without gaps or notches.

All randomness comes from `src/core/noise.ts` (hash, value noise, fBm),
which only uses 32-bit integer maths and doubles: results are identical on
every platform.

## Numbers (seed 1337, 128 x 128)

About 140 chunks and 120 k triangles with the culled mesher. Generation
takes about 0.15 s and meshing about 0.5 s in Node. Height steps between
neighbouring columns: about 75 % flat, 22 % one level (fully smoothed by
wedges), 2 % two levels, none higher.

## Limits

- Two-level steps show a half-height vertical band above the wedge.
- Water is an opaque block.
