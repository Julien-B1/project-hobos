"""
Preview of the combat clips: renders frames of each clip on a model (the
wizard, or `PREVIEW_MODEL`), weapons attached as in the game, for a visual check without the
game.

Usage (in the dev container):
    blender -b --python tooling/blender/preview_clips.py -- OUT_DIR [clip[:f1,f2,...]]...

Without clips, every combat clip is rendered at 10 evenly spaced frames.
Each frame gives two images, `OUT_DIR/<clip>_<view>_<frame>.png` (views:
`a` three-quarter front, `b` side). Cycles on the CPU, a few samples: a
frame takes about a second.

With `PREVIEW_VIDEO=1`, every frame of each clip is rendered, from the
three-quarter view only and larger: frames for a video (assemble them with
ffmpeg at 24 frames per second).

With the environment variable `PREVIEW_FOCUS` set to a bone (for instance
`mixamorig:RightHand`), the camera closes in on that bone instead, from four
sides: `front`, `left` (the character's left), `right` and `top`.
"""
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import combat_clips  # noqa: E402
import humanoid  # noqa: E402
import pose_solver  # noqa: E402

ARGS = sys.argv[sys.argv.index("--") + 1 :]
OUT = ARGS[0]
REQUEST = ARGS[1:]
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# Model the clips are shown on (any model of assets-src/models with a rig).
MODEL = os.environ.get("PREVIEW_MODEL", "wizard")

# Weapon models (Blender axes after import: +Z up the model). Grip frame in
# the model: origin, axis towards the head (blade tip, staff head), flat
# direction; and the length the model is scaled to (it is 1 unit long).
WEAPONS = {
    "sword": {"origin": Vector((0, 0, 0.855)), "axis": Vector((0, 0, -1)), "flat": Vector((1, 0, 0)), "length": 0.6, "sheath": "Socket_Sheath_Sword"},
    "staff": {"origin": Vector((0, 0, 0.5)), "axis": Vector((0, 0, 1)), "flat": Vector((1, 0, 0)), "length": 1.0, "sheath": "Socket_Sheath_Staff"},
}


def load(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


# The clips are made on the wizard, as in the library (its own clips kept);
# another model plays the same actions as they are: one skeleton for all.
arm = humanoid.load_normalised(os.path.join(ROOT, "assets-src/models/wizard.glb"), keep_actions=True)
pose_solver.add_sockets(arm)
combat_clips.add_clips(arm)
library = arm
if MODEL != "wizard":
    for o in [o for o in bpy.data.objects if o.type == "MESH"]:
        bpy.data.objects.remove(o)
    arm = humanoid.load_normalised(os.path.join(ROOT, f"assets-src/models/{MODEL}.glb"), reset=False)
    pose_solver.add_sockets(arm)


def play(action):
    for a in {library, arm}:
        a.animation_data_create()
        a.animation_data.action = action
        if action.slots:
            a.animation_data.action_slot = action.slots[0]


weapons = {}
for name, w in WEAPONS.items():
    objects = load(os.path.join(ROOT, f"assets-src/models/{name}.glb"))
    root = next(o for o in objects if o.parent is None)
    grip = Matrix((w["flat"], w["axis"], w["flat"].cross(w["axis"]))).transposed().to_4x4()
    grip.translation = w["origin"]
    weapons[name] = (root, Matrix.Scale(w["length"], 4) @ grip.inverted())


def socket(name):
    return arm.matrix_world @ arm.pose.bones[name].matrix.normalized()


def ease(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 8 if os.environ.get('PREVIEW_FOCUS') else 4
scene.cycles.device = "CPU"
scene.render.resolution_x = 360
scene.render.resolution_y = 480
world = bpy.data.worlds.new("w")
scene.world = world
world.color = (0.55, 0.55, 0.55)
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 3
sun.rotation_euler = (0.7, 0.2, 0.5)
scene.collection.objects.link(sun)
bpy.ops.mesh.primitive_plane_add(size=6)
camera = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
camera.data.type = "ORTHO"
camera.data.ortho_scale = 1.5
scene.collection.objects.link(camera)
scene.camera = camera
VIEWS = {"a": 35, "b": 90}
FOCUS = os.environ.get("PREVIEW_FOCUS")
VIDEO = bool(os.environ.get("PREVIEW_VIDEO"))
if VIDEO:
    VIEWS = {"a": 35}
    scene.render.resolution_x = 480
    scene.render.resolution_y = 600
# Close-up views: camera direction from the bone, and its rotation.
CLOSE = {
    "front": (Vector((0, -1, 0)), (math.radians(90), 0, 0)),
    "left": (Vector((1, 0, 0)), (math.radians(90), 0, math.radians(90))),
    "right": (Vector((-1, 0, 0)), (math.radians(90), 0, math.radians(-90))),
    "top": (Vector((0, 0, 1)), (0, 0, 0)),
}

plan = []
if REQUEST:
    for item in REQUEST:
        clip, _, frames = item.partition(":")
        plan.append((clip, [int(f) for f in frames.split(",")] if frames else None))
else:
    plan = [(clip, None) for clip in combat_clips.CLIPS]

for clip, frames in plan:
    action = bpy.data.actions[clip]
    play(action)
    first, last = (int(x) for x in action.frame_range)
    if VIDEO:
        frames = list(range(first, last + 1))
    elif frames is None:
        frames = sorted({round(first + (last - first) * k / 9) for k in range(10)})
    meta = combat_clips.CLIPS.get(clip, {})
    held = meta.get("weapon")
    offset = None
    if meta.get("draw"):
        grab = round(meta["grab"] * combat_clips.FPS) + 1
        scene.frame_set(grab)
        offset = socket(pose_solver.GRIP_SOCKET).inverted() @ socket(WEAPONS[held]["sheath"])
        s0, s1 = (round(t * combat_clips.FPS) + 1 for t in meta["settle"])
    for f in frames:
        scene.frame_set(f)
        for name, (obj, local) in weapons.items():
            if name != held:
                holder = socket(WEAPONS[name]["sheath"])
            elif offset is not None and f < grab:
                holder = socket(WEAPONS[name]["sheath"])
            elif offset is not None:
                k = ease((f - s0) / max(1, s1 - s0))
                blend = Matrix.Translation(offset.translation * (1 - k)) @ offset.to_quaternion().slerp(Matrix.Identity(3).to_quaternion(), k).to_matrix().to_4x4()
                holder = socket(pose_solver.GRIP_SOCKET) @ blend
            else:
                holder = socket(pose_solver.GRIP_SOCKET)
            obj.matrix_world = holder @ local
        if FOCUS:
            centre = arm.matrix_world @ arm.pose.bones[FOCUS].head
            camera.data.ortho_scale = 0.36
            for view, (direction, rotation) in CLOSE.items():
                camera.location = centre + direction * 4
                camera.rotation_euler = rotation
                scene.render.filepath = os.path.join(OUT, f"{clip}_{view}_{f:03d}.png")
                bpy.ops.render.render(write_still=True)
            continue
        for view, angle in VIEWS.items():
            a = math.radians(angle)
            camera.location = (4 * math.sin(a), -4 * math.cos(a), 0.58)
            camera.rotation_euler = (math.radians(90), 0, a)
            scene.render.filepath = os.path.join(OUT, f"{clip}_{view}_{f:03d}.png")
            bpy.ops.render.render(write_still=True)
