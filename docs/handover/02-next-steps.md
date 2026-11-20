# 2. What to continue

State on **2026-11-20**, after the `v0.3.0` milestone.

## In progress

- **Wizard character** with spring bones (skirt, sleeves, hair): owner's
  visual check pending (tune `DEFAULT_SPRING_PROFILE` from feedback). Its
  other clips (run, cast a spell, fall, defeat, stairs) are in the model,
  not used by the game yet.

## Next topic (owner, 2026-11-20)

- **Map archetypes** (milestone `v0.4.0`): add a few new kinds of
  generated battle maps next to `river`. Wait for the owner's brief before
  starting.

## Later topics announced

- **Buildings and other set pieces** on top of the structures system
  (ADR-007, [Structures](../wiki/Structures.md)): add kinds and meshers,
  reuse the primitives (`render/geometry/primitives.ts`), keep meshes
  closed (cut section).
- **Gameplay objects** (furniture, spell effects, props): implement
  `CutSupported` (ADR-011): never sliced, hidden whole when their support
  is cut.
- **Several characters** (only one today).

## Deferred by the owner ("pour plus tard"), do not start unasked

- Several wind intensities for foliage and grass.
- GPU optimisation beyond the direct-to-canvas output (ADR-009); measure
  with the probes (keys `1` to `6`) on a real GPU, in WebGPU.
- More character animations (slopes and stairs, run, jump), or an
  animation library (Mixamo-compatible packs); alternative: planned
  footsteps on top of the foot IK.

## Settled decisions (do not reopen)

- Character scale: 1.6 units tall on 1-unit cells (1 cell = 5 ft); kept
  because it reads better than a realistic 1.2.
- Structures are never rebuilt live when the voxels around them are
  edited: no live rebuild is planned.
- A lake running from edge to edge gets no crossing: accepted.

## Known limits

- Windows and macOS builds are unsigned (SmartScreen, Gatekeeper warn).
