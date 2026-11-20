# River map

`src/core/generators/riverMap.ts` builds a procedural, natural-looking
test map sized for **one encounter** (a battle map), not a journey. Open it
with `?map=river`; change the terrain with `?map=river&seed=42` (any
integer) and its size with `&size=24` (8 to 128 cells). The same seed and
size always give the same map.

Scale: one cell is one battle-map square (5 ft, 1.5 m). The default
40 x 40 map (200 ft square) is a large tabletop battle map (usual ones are
20 x 30 to 30 x 30 squares, 24 x 36 posters). Features are sized in cells for that
scale: a stream a few squares wide, a hill, a rocky outcrop, a copse.

## Pipeline

| Step         | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Main knobs                                          |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Height field | 3-octave fBm at scale 26 cells (`RELIEF_SCALE`), hills up to 14 levels (`RELIEF_HEIGHT`), shaped into plains and hills, gentle undulation, three 3 x 3 box blurs. In cliff zones (noise mask at scale 24 cells) heights are terraced into plateaus 7 levels apart with steep risers, counted from 2 levels above the water so no terrace floods. Rounded, then step-limited by a min-plus distance transform: 2 levels per cell on ordinary ground, 8 in cliff zones. | `MAX_STEP = 2`, `CLIFF_MAX_STEP = 8`, `TERRACE = 7` |
| River        | Centre line along Z = sine bends + fBm offset; half-width 1.25 to 3 cells (a stream 2.5 to 6 squares wide). Terrain is blended down to a bed 3 levels under water over 6 cells.                                                                                                                                                                                                                                                                                       | bend frequency 0.09, `BANK_WIDTH = 6`               |
| Water        | Every column below level 10 is filled with water up to level 10 (river and natural lakes).                                                                                                                                                                                                                                                                                                                                                                            | `WATER_LEVEL = 10`                                  |
| Materials    | Stone core, 2 dirt layers, top: sand on beds and beaches within 2 cells of water, stone at level 27+, rock on steep faces (3+ levels) and in noise patches above level 17, grass otherwise.                                                                                                                                                                                                                                                                           | `PEAK_LEVEL`, `STEEP_STEP`, `ROCK_LEVEL`            |
| Wedges       | For each dry column, a top corner is raised when one of the 3 other cells sharing it is higher; the raised-corner mask picks a slope, corner, saddle or full block on top.                                                                                                                                                                                                                                                                                            | `shapeForCornerMask`                                |
| Trees        | One candidate per 5 x 5 block (jittered), kept on flat grass; 85 % chance in forest patches (noise mask at scale 14 cells), 20 % elsewhere. Kind from the height: mostly pines from level 15, oaks and birches below (`treeGrowth.ts`). Bushes on a 3 x 3 grid (14 %) on free grass.                                                                                                                                                                                  | `BLOCK = 5`, forest threshold 0.55                  |

Why wedges join cleanly: a corner is shared by 4 cells, and each of them
raises it to the same world height (one level above the lower cells), so
slopes, outer corners and inner corners meet without gaps or notches.

All randomness comes from `src/core/noise.ts` (hash, value noise, fBm),
which only uses 32-bit integer maths and doubles: results are identical on
every platform.

## Numbers

The default 40 x 40 map spans 3 x 3 columns of chunks (about 12 to 14
chunks with the vertical layers). A 128 x 128 map (`&size=128`, the former default) is
about 130 chunks and meshes in about 0.7 s in Node; the encounter size is
16 times smaller. Every step renders as a facet; cliff zones give steep
faces with bare dirt or rock colours.

## Limits

- The faceted look is a rendering of the voxels: walkable logic still uses
  voxel surfaces (half-height levels).
- Trees are voxels (WOOD trunk, LEAVES canopy) drawn as procedural trees,
  see ADR-006.

## River crossing

After the terrain and its wedges, one crossing is placed over the river
(see [[Structures]]): on the best row (short span, near the middle, away
from the edges, deck meeting both banks, level approaches rather than the
foot of a slope or a cliff), of a kind picked with the seed among those
fitting the site. Trees and bushes keep clear of it. A map flooded from edge to edge
has no banks to join and gets no crossing.

Crossing placement scores every row's site, best first; a site where no
kind fits once measured at its width (an islet one row wide) gives way to
the next one.
