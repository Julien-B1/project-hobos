# 2. What to continue

## Immediately pending

1. **Owner feedback on `de78de4`** (procedural terrain material). The
   previous version burned the GPU; this one costs 2 texture fetches per
   pixel. Do not stack new effects before the owner confirms the GPU load is
   acceptable.
2. **Push**: commits after `59345c7` are local only. Push `dev` (and publish
   the wiki with `make wiki-publish`) only when the owner explicitly asks.
   Consider a `v0.3.0` release at that point (freeze the changelog first).

## Requested by the owner, not started

Owner request (2026-11-19): textures and materials instead of plain colours
(done in `de78de4`), global illumination, no visible grid patterns, ground
transitions, translucent water with some IOR, farther max zoom (done).

| Item     | Plan                                                                                                                                                 | Cost / risk                                                                     |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Water    | `MeshPhysicalNodeMaterial` on the water layer: transmission, IOR 1.33, light absorption tint, normal ripples from the noise texture (not GPU noise). | Medium: transmission renders the opaque scene to a texture. Make it degradable. |
| Lighting | Sky (`SkyMesh`) and environment lighting, sun shadows (one shadow camera following the camera target, or `CSMShadowNode`), tone mapping.             | Low to medium.                                                                  |
| GI       | `SSGINode` + `TRAANode` (WebGPU only, needs `rg11b10ufloat-renderable`), `GTAONode` as fallback.                                                     | **High**. Must be optional and **off by default** (`?gi=ssgi                    | ao  | off`). Ask the owner before enabling by default. |

Check each effect's cost and expose a toggle; see the performance rule in
[05-agent-handover.md](05-agent-handover.md).

## Known limits and ideas (not requested)

- Picking on faceted terrain resolves by column (`resolveColumnHit`); hits on
  tunnel walls target the hill top.
- Edits rebuild up to 12 chunks (vertical neighbours always marked).
- Meshing the full organic map takes about 0.7 s (Node); `TerrainField`
  reads voxels through string-keyed lookups and could be optimised.
- Out of scope per `BOOTSTRAP.md` until asked: navigation graph, A*, tokens,
  sprites, occlusion fading, editor, save/load.
