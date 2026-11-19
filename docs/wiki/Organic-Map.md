# Organic map

`src/core/generators/organicMap.ts` builds a procedural, natural-looking
test map. Open it with `?map=organic`; change the terrain with
`?map=organic&seed=42` (any integer). The same seed always gives the same
map.

## Pipeline

| Step         | What it does                                                                                                                                                                        | Main knobs                            |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Height field | 5-octave fBm at scale 46 cells, shaped with `smoothstep` + power so lows become plains and highs become hills; small 2-octave roughness on top.                                     | `8.5 + relief * 26 + detail` levels   |
| River        | Centre line along Z = sine bends + fBm offset; half-width 2 to 4.5 cells. Terrain is blended down to a bed 3 levels under water over 10 cells.                                      | `0.045` bend frequency, bank width 10 |
| Water        | Every column below level 10 is filled with water up to level 10 (river and natural lakes).                                                                                          | `WATER_LEVEL = 10`                    |
| Materials    | Stone core, 2 dirt layers, top: sand at or near water level, stone at level 30+, rock where a neighbour is 3+ levels away, grass otherwise.                                         | `PEAK_LEVEL`, `STEEP_STEP`            |
| Slopes       | A dry column exactly one level below a neighbour gets a slope voxel rising towards it (unless the opposite neighbour is higher too).                                                | none                                  |
| Trees        | One candidate per 5 x 5 block (jittered), kept on flat grass; 85 % chance in forest patches (low-frequency noise mask), 12 % elsewhere. Trunk 4 to 6 voxels, ellipsoid leaf canopy. | `BLOCK = 5`, forest threshold `0.55`  |

All randomness comes from `src/core/noise.ts` (hash, value noise, fBm),
which only uses 32-bit integer maths and doubles: results are identical on
every platform.

## Numbers (seed 1337, 128 x 128)

About 145 chunks and 120 k triangles with the culled mesher. Generation
takes about 0.1 s and meshing about 0.4 s in Node; the browser is in the
same range.

## Limits

- Height steps of 2 levels or more stay vertical (no 2-level slope shape
  yet), which gives terraced hills.
- Slopes only rise along one axis: diagonal steps and corners show small
  notches. Corner slope shapes would smooth them (see [[Extending]]).
- Water is an opaque block.
