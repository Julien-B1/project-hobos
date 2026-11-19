# 2. What to continue

## Immediately pending

1. **Push** `e20fe7d` (and later commits) to `origin/dev` with the next
   batch: at the end of a topic, when the owner asks, or after a while (see
   [05-agent-handover.md](05-agent-handover.md), commit cadence).
2. **Owner checks** not yet confirmed on screen: the hover cursor on the
   rope bridge (follows the sagging planks) and on the bed of fords; bridge
   placement on more organic seeds.

## Next topics announced by the owner

- **Buildings and other set pieces** on top of the structures system
  (ADR-007, [Structures](../wiki/Structures.md)): add kinds and meshers,
  reuse the primitives (`render/geometry/primitives.ts`), keep meshes
  closed (cut section).

## Deferred by the owner ("pour plus tard"), do not start unasked

- Several wind intensities for foliage and grass.
- GPU optimisation beyond the direct-to-canvas output (ADR-009); measure
  with the probes (keys `1` to `6`) on a real GPU, in WebGPU.
- Max zoom-out (240) was sized for 128-cell maps; maps are now 32 cells.

## Known limits

- Structures are not rebuilt or moved when voxels around them are edited.
- The reference map keeps its old voxel bridge.
- A river shore flat at water level up to the map's edge gets a fallback
  crossing (half step at the ends); a lake from edge to edge gets none.
- Out of scope per `BOOTSTRAP.md` until asked: navigation graph, A*, tokens,
  sprites, occlusion fading, editor, save/load.
