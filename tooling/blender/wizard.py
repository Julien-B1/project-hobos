"""
The wizard model: reference skeleton (humanoid.py) and spring bones.

Usage (in the dev container, see `make models`):
    blender -b --python tooling/blender/wizard.py -- in.glb out.glb

The Tripo rig moves the skirt panels with one thigh each, and nothing
moves the bell sleeves or the long hair on its own. This script adds
chains of "spring" bones that the game animates at run time
(`src/render/actors/springBones.ts`): their names start with `Spring_`,
each chain ends with a leaf bone (`..._end`, no weights) that gives the
tip of the last bone. It reweights the cloth and hair vertices onto these
chains, fading into the body bones where the cloth is attached:

- skirt: 8 chains of 3 bones hanging from the hips all around the skirt,
  following its outer surface; the waist fades into the hips;
- sleeves: one chain of 2 bones under each forearm, for the bell part of
  the sleeve hanging below the arm;
- hair: 3 chains of 3 bones down the back, from the head.

The model is first brought to the reference skeleton; only the base
colour texture is kept (see `humanoid.export_model`). Coordinates below are Blender's (Z up, the model faces -Y), in
model units (the model is about 1 unit tall).
"""
import math
import sys

import bmesh
import os

import bpy
from mathutils import Vector
from mathutils.geometry import intersect_point_line

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import humanoid  # noqa: E402

ARGS = sys.argv[sys.argv.index("--") + 1 :]
SOURCE, TARGET = ARGS[0], ARGS[1]

# Bones of the reference skeleton (humanoid.py), by the short labels used
# below: C centre, L left, R right.
PREFIX = ""
NAMES = {
    "C_Hips": "Hips", "C_Head": "Head", "C_Neck": "Neck",
    "L_UpperLeg": "LeftUpLeg", "L_LowerLeg": "LeftLeg", "L_Foot": "LeftFoot",
    "R_UpperLeg": "RightUpLeg", "R_LowerLeg": "RightLeg", "R_Foot": "RightFoot",
    "L_LowerArm": "LeftForeArm", "L_Hand": "LeftHand",
    "R_LowerArm": "RightForeArm", "R_Hand": "RightHand",
}
# Bone segments: from a bone's head to its child's head.
SEGMENTS = {"L_UpperLeg": "L_LowerLeg", "L_LowerLeg": "L_Foot", "R_UpperLeg": "R_LowerLeg", "R_LowerLeg": "R_Foot", "L_LowerArm": "L_Hand", "R_LowerArm": "R_Hand"}
LEGS = ["L_UpperLeg", "L_LowerLeg", "R_UpperLeg", "R_LowerLeg"]

# Skirt: loose parts below the waist that stand away from the legs (the
# stockings hug the leg bones: mean distance about 0.04).
SKIRT_PART_MIN_MEAN_LEG_DISTANCE = 0.055
SKIRT_PART_LOWEST_TOP = 0.6
SKIRT_CHAINS = 8
SKIRT_TOP = 0.6
SKIRT_BOTTOM = 0.12
SKIRT_BONES = 3
# Waist: from fully on the hips (above) to fully on the chains (below).
WAIST_FULL_HIPS = 0.6
WAIST_FULL_SKIRT = 0.52

# Sleeves: the bell part hangs below the forearm.
SLEEVE_MIN_REACH = 0.2
SLEEVE_HEAD = (0.25, -0.045, 0.785)
SLEEVE_JOINTS_Z = (0.785, 0.74, 0.69)
SLEEVE_FADE = (0.012, 0.045)

# Hair: strands behind the neck and the back.
HAIR_MIN_Y = 0.015
HAIR_FULL_HEAD = 0.87
HAIR_FULL_STRANDS = 0.83
HAIR_CHAINS_X = (-0.05, 0.0, 0.05)
HAIR_Y = 0.05
HAIR_JOINTS_Z = (0.87, 0.8, 0.73, 0.66)


def smoothstep(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def load():
    arm = humanoid.load_normalised(SOURCE)
    mesh = max((o for o in bpy.data.objects if o.type == "MESH"), key=lambda o: len(o.data.vertices))
    return arm, mesh


def loose_parts(mesh):
    bm = bmesh.new()
    bm.from_mesh(mesh.data)
    bm.verts.ensure_lookup_table()
    seen, parts = set(), []
    for v in bm.verts:
        if v.index in seen:
            continue
        stack, comp = [v], []
        seen.add(v.index)
        while stack:
            x = stack.pop()
            comp.append(x.index)
            for e in x.link_edges:
                o = e.other_vert(x)
                if o.index not in seen:
                    seen.add(o.index)
                    stack.append(o)
        parts.append(comp)
    bm.free()
    return parts


def segment_distance(p, a, b):
    _, t = intersect_point_line(p, a, b)
    t = max(0.0, min(1.0, t))
    return (p - (a + (b - a) * t)).length


def dominant_group(mesh, index):
    groups = mesh.data.vertices[index].groups
    if not groups:
        return ""
    g = max(groups, key=lambda g: g.weight)
    return mesh.vertex_groups[g.group].name


def add_chain(arm, parent, name, joints):
    """Bones between consecutive joints, then a leaf bone past the last joint."""
    edit = arm.data.edit_bones
    prev = edit[parent]
    names = []
    for i in range(len(joints) - 1):
        b = edit.new(f"{name}_{i + 1}")
        b.head, b.tail = joints[i], joints[i + 1]
        b.parent = prev
        b.use_connect = i > 0
        prev = b
        names.append(b.name)
    tip = joints[-1] + (joints[-1] - joints[-2]) * 0.25
    leaf = edit.new(f"{name}_end")
    leaf.head, leaf.tail = joints[-1], tip
    leaf.parent = prev
    leaf.use_connect = True
    return names


def set_weights(mesh, index, weights):
    """Replace the vertex's weights (dict group name -> weight, normalized)."""
    v = mesh.data.vertices[index]
    for g in list(v.groups):
        mesh.vertex_groups[g.group].remove([index])
    total = sum(w for w in weights.values() if w > 1e-4)
    for name, w in weights.items():
        if w <= 1e-4:
            continue
        group = mesh.vertex_groups.get(name) or mesh.vertex_groups.new(name=name)
        group.add([index], w / total, "REPLACE")


def current_weights(mesh, index):
    v = mesh.data.vertices[index]
    return {mesh.vertex_groups[g.group].name: g.weight for g in v.groups}


def blend(a, b, t):
    """(1 - t) * a + t * b over weight dicts."""
    out = {k: w * (1 - t) for k, w in a.items()}
    for k, w in b.items():
        out[k] = out.get(k, 0.0) + w * t
    return out


def along(joints_z, z, names):
    """Weights over a vertical chain for height z, blended around joints."""
    n = len(names)
    top, bottom = joints_z[0], joints_z[-1]
    s = min(0.999, max(0.0, (top - z) / (top - bottom))) * n
    i = int(s)
    f = s - i
    out = {names[i]: 1.0}
    # Near the joint with the bone above, share with it (smooth bend).
    if i > 0 and f < 0.3:
        k = 0.5 - f / 0.6
        out = {names[i]: 1 - k, names[i - 1]: k}
    return out


def main():
    arm, mesh = load()
    mw = mesh.matrix_world
    real = {label: humanoid.PREFIX + name for label, name in NAMES.items()}
    head = lambda label: arm.matrix_world @ arm.data.bones[real[label]].head_local  # noqa: E731
    bones = {label: (head(label), head(SEGMENTS[label]) if label in SEGMENTS else head(label)) for label in NAMES}
    dominant_label = {v: k for k, v in real.items()}
    hips = bones[PREFIX + "C_Hips"][0]
    pos = [mw @ v.co for v in mesh.data.vertices]

    # 1. Classify the vertices.
    skirt, sleeve, hair = [], {"L": [], "R": []}, []
    for part in loose_parts(mesh):
        pts = [pos[i] for i in part]
        dom = {dominant_label.get(dominant_group(mesh, i), "") for i in part}
        lowest = min(p.z for p in pts)
        mean_leg = sum(min(segment_distance(p, *bones[PREFIX + n]) for n in LEGS) for p in pts) / len(pts)
        if 0.05 < lowest < SKIRT_PART_LOWEST_TOP and mean_leg >= SKIRT_PART_MIN_MEAN_LEG_DISTANCE:
            skirt += part
            continue
        for side in ("L", "R"):
            if PREFIX + side + "_LowerArm" in dom:
                lower = bones[PREFIX + side + "_LowerArm"]
                for i in part:
                    p = pos[i]
                    if abs(p.x) < SLEEVE_MIN_REACH or (p.x > 0) != (side == "L"):
                        continue
                    _, t = intersect_point_line(p, *lower)
                    axis_z = (lower[0] + (lower[1] - lower[0]) * max(0.0, min(1.0, t))).z
                    if axis_z - p.z > SLEEVE_FADE[0]:
                        sleeve[side].append(i)
        if dom & {PREFIX + "C_Head", PREFIX + "C_Neck"}:
            hair += [i for i in part if pos[i].y > HAIR_MIN_Y and pos[i].z < HAIR_FULL_HEAD]

    # 2. Skirt chains: joints on the skirt's outer surface, per sector.
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    to_local = arm.matrix_world.inverted()
    levels = [SKIRT_TOP + (SKIRT_BOTTOM - SKIRT_TOP) * k / SKIRT_BONES for k in range(SKIRT_BONES + 1)]
    angle = lambda p: math.atan2(p.y - hips.y, p.x - hips.x)
    skirt_chains = []
    for c in range(SKIRT_CHAINS):
        theta = 2 * math.pi * c / SKIRT_CHAINS
        joints = []
        for z in levels:
            near = [
                pos[i]
                for i in skirt
                if abs(pos[i].z - z) < 0.06
                and abs((angle(pos[i]) - theta + math.pi) % (2 * math.pi) - math.pi) < math.pi / SKIRT_CHAINS
            ]
            r = max((math.hypot(p.x - hips.x, p.y - hips.y) for p in near), default=None)
            joints.append(r)
        # Missing levels (short panels): carry the radius from above.
        last = 0.12
        for k, r in enumerate(joints):
            last = r if r is not None else last
            joints[k] = last
        points = [
            to_local @ Vector((hips.x + r * math.cos(theta), hips.y + r * math.sin(theta), z))
            for r, z in zip(joints, levels)
        ]
        skirt_chains.append((theta, add_chain(arm, real["C_Hips"], f"Spring_Skirt{c}", points)))

    sleeve_chains = {}
    for side, sign in (("L", 1), ("R", -1)):
        x, y, _ = SLEEVE_HEAD
        points = [to_local @ Vector((sign * x, y, z)) for z in SLEEVE_JOINTS_Z]
        sleeve_chains[side] = add_chain(arm, real[side + "_LowerArm"], f"Spring_Sleeve{side}", points)

    hair_chains = []
    for k, x in enumerate(HAIR_CHAINS_X):
        points = [to_local @ Vector((x, HAIR_Y, z)) for z in HAIR_JOINTS_Z]
        hair_chains.append((x, add_chain(arm, real["C_Head"], f"Spring_Hair{k}", points)))
    bpy.ops.object.mode_set(mode="OBJECT")

    # 3. Weights.
    step = 2 * math.pi / SKIRT_CHAINS
    for i in set(skirt):
        p = pos[i]
        a = angle(p) % (2 * math.pi)
        c0 = int(a // step) % SKIRT_CHAINS
        c1 = (c0 + 1) % SKIRT_CHAINS
        f = (a - c0 * step) / step
        chain = blend(along(levels, p.z, skirt_chains[c0][1]), along(levels, p.z, skirt_chains[c1][1]), f)
        waist = smoothstep(WAIST_FULL_SKIRT, WAIST_FULL_HIPS, p.z)
        set_weights(mesh, i, blend(chain, {real["C_Hips"]: 1.0}, waist))

    for side, ids in sleeve.items():
        lower = bones[PREFIX + side + "_LowerArm"]
        for i in set(ids):
            p = pos[i]
            _, t = intersect_point_line(p, *lower)
            axis_z = (lower[0] + (lower[1] - lower[0]) * max(0.0, min(1.0, t))).z
            k = smoothstep(*SLEEVE_FADE, axis_z - p.z)
            chain = along(SLEEVE_JOINTS_Z, p.z, sleeve_chains[side])
            set_weights(mesh, i, blend(current_weights(mesh, i), chain, k))

    for i in set(hair):
        p = pos[i]
        xs = [x for x, _ in hair_chains]
        j = min(range(len(xs) - 1), key=lambda j: abs(p.x - (xs[j] + xs[j + 1]) / 2))
        f = min(1.0, max(0.0, (p.x - xs[j]) / (xs[j + 1] - xs[j])))
        chain = blend(
            along(HAIR_JOINTS_Z, p.z, hair_chains[j][1]), along(HAIR_JOINTS_Z, p.z, hair_chains[j + 1][1]), f
        )
        k = 1 - smoothstep(HAIR_FULL_STRANDS, HAIR_FULL_HEAD, p.z)
        set_weights(mesh, i, blend(current_weights(mesh, i), chain, k))

    print(f"wizard: skirt {len(set(skirt))}, sleeves {sum(len(set(v)) for v in sleeve.values())}, hair {len(set(hair))} vertices")

    humanoid.export_model(TARGET)

main()
