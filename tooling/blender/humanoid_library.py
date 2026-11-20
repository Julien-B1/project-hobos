"""
Shared animation library: the skeleton and clips of a rigged model, without
its mesh or textures.

Usage (in the dev container, see `make models`):
    blender -b --python tooling/blender/humanoid_library.py -- in.glb out.glb

The game loads this file once and transfers its clips onto each
character's own skeleton (`src/render/actors/retarget.ts`), so every
character gets every clip whatever its rig (Mixamo or VRM-style names).
The source is the wizard's Tripo export: seven clips on a VRM-style rig.
"""
import sys

import bpy

ARGS = sys.argv[sys.argv.index("--") + 1 :]
SOURCE, TARGET = ARGS[0], ARGS[1]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SOURCE)
for o in list(bpy.data.objects):
    if o.type != "ARMATURE":
        bpy.data.objects.remove(o)
for image in list(bpy.data.images):
    bpy.data.images.remove(image)
print("library clips:", ", ".join(sorted(a.name for a in bpy.data.actions)))

bpy.ops.export_scene.gltf(
    filepath=TARGET,
    export_format="GLB",
    export_yup=True,
    export_animations=True,
    export_animation_mode="ACTIONS",
    export_force_sampling=True,
    export_def_bones=False,
)
