# Organic map

`src/core/generators/organicMap.ts` builds a procedural, natural-looking
test map. Open it with `?map=organic`; change the terrain with
`?map=organic&seed=42` (any integer). The same seed always gives the same
map.

## Pipeline

| Step         | What it does                                                                                                                                                                                                                                                                                                                                | Main knobs                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Height field | 4-octave fBm at scale 72 cells, shaped into plains and hills, gentle undulation, three 3 x 3 box blurs. In cliff zones (low-frequency noise mask) heights are terraced into plateaus 7 levels apart with steep risers. Rounded, then step-limited by a min-plus distance transform: 2 levels per cell on ordinary ground, 8 in cliff zones. | `MAX_STEP = 2`, `CLIFF_MAX_STEP = 8`, `TERRACE = 7` |
| River        | Centre line along Z = sine bends + fBm offset; half-width 2 to 4.5 cells. Terrain is blended down to a bed 3 levels under water over 16 cells.                                                                                                                                                                                              | bend frequency 0.045, bank width 16                 |
| Water        | Every column below level 10 is filled with water up to level 10 (river and natural lakes).                                                                                                                                                                                                                                                  | `WATER_LEVEL = 10`                                  |
| Materials    | Stone core, 2 dirt layers, top: sand on beds and beaches within 2 cells of water, stone at level 27+, rock on steep faces (3+ levels) and in noise patches above level 17, grass otherwise.                                                                                                                                                 | `PEAK_LEVEL`, `STEEP_STEP`, `ROCK_LEVEL`            |
| Wedges       | For each dry column, a top corner is raised when one of the 3 other cells sharing it is higher; the raised-corner mask picks a slope, corner, saddle or full block on top.                                                                                                                                                                  | `shapeForCornerMask`                                |
| Trees        | One candidate per 5 x 5 block (jittered), kept on flat grass; 85 % chance in forest patches (low-frequency noise mask), 12 % elsewhere. Trunk 4 to 6 voxels, leaf canopy.                                                                                                                                                                   | `BLOCK = 5`, forest threshold 0.55                  |

Why wedges join cleanly: a corner is shared by 4 cells, and each of them
raises it to the same world height (one level above the lower cells), so
slopes, outer corners and inner corners meet without gaps or notches.

All randomness comes from `src/core/noise.ts` (hash, value noise, fBm),
which only uses 32-bit integer maths and doubles: results are identical on
every platform.

## Numbers (seed 1337, 128 x 128)

About 140 chunks and 120 k triangles with the culled mesher. Generation
takes about 0.15 s and meshing about 0.5 s in Node. With the smooth terrain renderer (default) every step looks like a slope;
cliff zones give steep, rounded faces. Meshing the whole map with the hybrid
mesher takes about 0.3 to 0.45 s in Node (85 k to 95 k triangles).

## Limits

- The smooth look is a rendering of the voxels: walkable logic still uses
  voxel surfaces (half-height levels).
- Water is an opaque block.
