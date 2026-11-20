"""
Numeric check of the combat clips: no render, a table per clip.

Usage (in the dev container):
    blender -b --python tooling/blender/check_clips.py -- [clip ...]

For every second frame of each clip (all combat clips by default), and for
each arm: forearm roll from neutral (degrees; the range is +-85), angle
between the asked and the obtained weapon axis (0 for a relaxed hand), and
depth of the arm inside the trunk (model units). Then the warnings and the
summary of `combat_clips.add_clips`. Poses are tuned on these numbers
first, then looked at with `preview_clips.py`.
"""
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import combat_clips  # noqa: E402
import humanoid  # noqa: E402
import pose_solver  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WANTED = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []

arm = humanoid.load_normalised(os.path.join(ROOT, "assets-src/models/wizard.glb"))
pose_solver.add_sockets(arm)

rows = {}
solve_arm = pose_solver.Rig.solve_arm
solve = pose_solver.Rig.solve


def traced_arm(self, s, spec, root, hint, chest, delta, heads):
    result = solve_arm(self, s, spec, root, hint, chest, delta, heads)
    rows.setdefault(self.label, {})[s] = (math.degrees(result["twist"]), result["error"], result["inside"])
    return result


def traced(self, spec, label=""):
    self.label = label
    return solve(self, spec, label)


pose_solver.Rig.solve_arm = traced_arm
pose_solver.Rig.solve = traced
combat_clips.add_clips(arm)

for label, sides in rows.items():
    clip, frame_no = label.split("@")
    if (WANTED and clip not in WANTED) or int(frame_no) % 2 == 0:
        continue
    cells = " | ".join(f"{s} roll {sides[s][0]:4.0f} off {sides[s][1]:3.0f} in {sides[s][2]:.3f}" for s in "RL")
    print(f"check {clip:13s} {int(frame_no):3d} | {cells}")
