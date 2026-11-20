"""
Shared animation library: the reference skeleton and every clip, without
mesh or texture.

Usage (in the dev container, see `make models`):
    blender -b --python tooling/blender/humanoid_library.py -- in.glb out.glb clips.json

The source is the wizard's Tripo export (seven clips). It is brought to
the reference skeleton (humanoid.py), its clips with it; the weapon sockets
and the combat clips keyed by script are added (pose_solver.py,
combat_clips.py). Every character shares that skeleton, so the game plays
these clips on any of them as they are. `clips.json` describes the combat
clips for the game (`combat_clips.CLIPS`).
"""
import json
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import combat_clips  # noqa: E402
import humanoid  # noqa: E402
import pose_solver  # noqa: E402

ARGS = sys.argv[sys.argv.index("--") + 1 :]
SOURCE, TARGET, CLIPS_JSON = ARGS[0], ARGS[1], ARGS[2]

arm = humanoid.load_normalised(SOURCE, keep_actions=True)
for o in list(bpy.data.objects):
    if o.type != "ARMATURE":
        bpy.data.objects.remove(o)
for image in list(bpy.data.images):
    bpy.data.images.remove(image)
pose_solver.add_sockets(arm)
combat_clips.add_clips(arm)
print("library clips:", ", ".join(sorted(a.name for a in bpy.data.actions)))

with open(CLIPS_JSON, "w") as out:
    json.dump(combat_clips.CLIPS, out, indent=2)
    out.write("\n")

bpy.ops.export_scene.gltf(
    filepath=TARGET,
    export_format="GLB",
    export_yup=True,
    export_animations=True,
    export_animation_mode="ACTIONS",
    export_force_sampling=True,
    export_def_bones=False,
)
