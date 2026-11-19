# Reference map

`src/core/generators/referenceMap.ts` builds a small **deterministic** map
(32 x 32 cells, a battle-map sized encounter area, levels 0 to 13) that contains every multi-level case the
engine must handle. Exact coordinates are exported as `REFERENCE_LAYOUT`;
tests and manual checks rely on them.

Heights below are **surface levels**: level `L` means "standing on top of
voxel `L - 1`", at world height `L * 0.5`.

## Features

| Feature       | Cells (x, z)                  | Levels                                    | Purpose                                         |
| ------------- | ----------------------------- | ----------------------------------------- | ----------------------------------------------- |
| Base ground   | everywhere else               | surface 6 (stone, dirt, grass)            | Reference height.                               |
| River trench  | x 15..18, all z               | sand bed, water surface 3                 | Lowered terrain, water material.                |
| Low bank path | x 12..14, all z               | path surface 4                            | Walkable surface under the bridge.              |
| Bridge deck   | x 11..19, z 9..10             | deck voxel 10, surface 11                 | **Two surfaces in one column** over path/river. |
| Bridge ramps  | x 6..10 and x 20..24, z 9..10 | slopes from 6 to 11, high side to bridge  | Slope geometry, picking on slopes.              |
| Cliff plateau | x 23..31, z 20..31            | surface 14, rock core                     | Vertical face.                                  |
| Cliff ramp    | x 27..28, z 12..19            | slopes from 6 to 14, high side south (+Z) | Climbing a cliff with slopes.                   |
| Hill          | x 1..10, z 20..30             | surface 14, rock core                     | Relief for the tunnel.                          |
| Tunnel        | x 1..10, z 24..26             | floor surface 6, air 6..9, ceiling 10..13 | Picking inside an enclosed space.               |

## Key columns for manual checks

| Column (x, z) | Expected surfaces (levels) | What it shows                    |
| ------------- | -------------------------- | -------------------------------- |
| (13, 9)       | 4 and 11                   | Path under the bridge deck.      |
| (16, 9)       | 3 and 11                   | River under the bridge deck.     |
| (5, 25)       | 6 and 14                   | Tunnel floor under the hill top. |
| (27, 15)      | slope at voxel 9           | Middle of the cliff ramp.        |

## Tests

`referenceMap.test.ts` checks determinism, the base ground, river and path
heights, exactly two surfaces over the path under the bridge, ramp slope
orientations and continuity with the deck and the cliff top, and the tunnel
(open ends, air inside, solid ceiling).
