"""
The reference humanoid skeleton, and the conversion of any rigged model to
it.

Every standard human of the game shares one skeleton: Mixamo bone names
(`mixamorig:Hips`...), a T-pose at rest, and the same rest axes for every
bone. With that, a clip made on one model plays on any other as it is (the
same local rotations), with no conversion in the game: only the hips'
height is scaled to the legs.

Models come rigged from Tripo with Mixamo or VRM-style names (`J_Bip_*`),
at rest in a T-pose or an A-pose, with bone axes of their own. `normalise`
brings one to the reference:

1. bones are renamed (`BONES`: reference name, VRM-style alias);
2. the arms, hands, fingers and legs are posed to the reference directions
   (arms straight out, palms down, legs straight down); the trunk, head and
   feet keep the posture they were modelled in; that pose becomes the rest
   pose, mesh included;
3. every reference bone gets the reference rest axes (Y along the
   reference direction, whatever the model's proportions), which changes
   no shape;
4. a root bone above the hips is removed.

`sample_actions` / `write_actions` carry a model's own clips through the
conversion exactly (same shapes on every frame): sample before
`normalise`, write after.

Blender axes: the model faces -Y, +X is its left, +Z is up.
"""
import bpy
from mathutils import Matrix, Vector

PREFIX = "mixamorig:"
L = Vector((1, 0, 0))
F = Vector((0, -1, 0))
U = Vector((0, 0, 1))

# How a bone is brought to the reference pose:
# - keep: stays as it was modelled (trunk, head, feet);
# - aim: turned to the reference direction (arms, legs, fingers);
# - hand: turned to the reference direction, palm down.
KEEP, AIM, HAND = "keep", "aim", "hand"


def _bones():
    """Reference bones: name -> (parent, VRM-style alias, direction, Z axis, mode)."""
    out = {
        "Hips": (None, "C_Hips", U, F, KEEP),
        "Spine": ("Hips", "C_Spine", U, F, KEEP),
        "Spine1": ("Spine", "C_Chest", U, F, KEEP),
        "Spine2": ("Spine1", "C_UpperChest", U, F, KEEP),
        "Neck": ("Spine2", "C_Neck", U, F, KEEP),
        "Head": ("Neck", "C_Head", U, F, KEEP),
    }
    for side, s, sign in (("Left", "L", 1), ("Right", "R", -1)):
        out_dir = L * sign
        thumb = (out_dir * 0.7 + F * 0.7).normalized()
        out[f"{side}Shoulder"] = ("Spine2", f"{s}_Shoulder", out_dir, U, KEEP)
        out[f"{side}Arm"] = (f"{side}Shoulder", f"{s}_UpperArm", out_dir, U, AIM)
        out[f"{side}ForeArm"] = (f"{side}Arm", f"{s}_LowerArm", out_dir, U, AIM)
        out[f"{side}Hand"] = (f"{side}ForeArm", f"{s}_Hand", out_dir, U, HAND)
        for finger, alias in (("Thumb", "Thumb"), ("Index", "Index"), ("Middle", "Middle"), ("Ring", "Ring"), ("Pinky", "Little")):
            parent = f"{side}Hand"
            for k in (1, 2, 3):
                name = f"{side}Hand{finger}{k}"
                out[name] = (parent, f"{s}_{alias}{k}", thumb if finger == "Thumb" else out_dir, U, AIM)
                parent = name
        out[f"{side}UpLeg"] = ("Hips", f"{s}_UpperLeg", -U, F, AIM)
        out[f"{side}Leg"] = (f"{side}UpLeg", f"{s}_LowerLeg", -U, F, AIM)
        out[f"{side}Foot"] = (f"{side}Leg", f"{s}_Foot", (F * 0.8 - U * 0.6).normalized(), U, KEEP)
        out[f"{side}ToeBase"] = (f"{side}Foot", f"{s}_ToeBase", F, U, KEEP)
    return out


BONES = _bones()

# Child whose head gives a bone's direction when it is aimed.
AIM_CHILD = {}
for _side in ("Left", "Right"):
    AIM_CHILD[f"{_side}Arm"] = f"{_side}ForeArm"
    AIM_CHILD[f"{_side}ForeArm"] = f"{_side}Hand"
    AIM_CHILD[f"{_side}UpLeg"] = f"{_side}Leg"
    AIM_CHILD[f"{_side}Leg"] = f"{_side}Foot"
    for _finger in ("Thumb", "Index", "Middle", "Ring", "Pinky"):
        AIM_CHILD[f"{_side}Hand{_finger}1"] = f"{_side}Hand{_finger}2"
        AIM_CHILD[f"{_side}Hand{_finger}2"] = f"{_side}Hand{_finger}3"


def reference_name(bone_name):
    """Reference name (without prefix) of a model's bone, or None."""
    short = bone_name.split(":")[-1]
    if short in BONES:
        return short
    if bone_name.startswith("J_Bip_"):
        alias = bone_name[len("J_Bip_") :]
        return next((name for name, spec in BONES.items() if spec[1] == alias), None)
    return None


def find_armature():
    return next(o for o in bpy.data.objects if o.type == "ARMATURE")


def frame(a, b):
    """Rotation whose columns are a, b made perpendicular to a, and a x b."""
    a = a.normalized()
    b = (b - a * b.dot(a)).normalized()
    return Matrix((a, b, a.cross(b))).transposed()


def _order(arm):
    return sorted(arm.data.bones, key=lambda b: len(b.parent_recursive))


def _pose_matrices(arm, rotation_of, hips_head=None):
    """
    Pose every bone from model-space rotations of the reference bones.

    `rotation_of(bone, parent_delta)` returns the rotation applied to the
    bone from rest (model space); bones are visited parents first.
    Returns the posed 4x4 matrix of each bone (armature space).
    """
    rest = {b.name: b.matrix_local.copy() for b in arm.data.bones}
    posed, delta = {}, {}
    for bone in _order(arm):
        n = bone.name
        if bone.parent:
            p = bone.parent.name
            head = (posed[p] @ rest[p].inverted() @ rest[n]).translation
            parent_delta = delta[p]
        else:
            head, parent_delta = rest[n].translation.copy(), Matrix.Identity(3)
        if hips_head is not None and reference_name(n) == "Hips":
            head = hips_head
        delta[n] = rotation_of(bone, parent_delta)
        m = (delta[n] @ rest[n].to_3x3()).to_4x4()
        m.translation = head
        posed[n] = m
    return posed, delta, rest


def _apply_pose(arm, posed, rest, key_frame=None, previous=None):
    """Set (and optionally key) the pose bones from posed armature-space matrices."""
    for bone in _order(arm):
        n = bone.name
        pb = arm.pose.bones[n]
        base = posed[bone.parent.name] @ rest[bone.parent.name].inverted() @ rest[n] if bone.parent else rest[n]
        basis = base.inverted() @ posed[n]
        q = basis.to_quaternion()
        if previous is not None:
            if n in previous and previous[n].dot(q) < 0:
                q.negate()
            previous[n] = q
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = q
        pb.location = basis.translation if not bone.parent or reference_name(n) == "Hips" else (0, 0, 0)
        if key_frame is not None and reference_name(n):
            pb.keyframe_insert("rotation_quaternion", frame=key_frame)
            if reference_name(n) == "Hips":
                pb.keyframe_insert("location", frame=key_frame)


def sample_actions(arm, actions):
    """
    Model-space rotation of every reference bone and hips position, for
    every frame of every action of the model as imported.
    """
    scene = bpy.context.scene
    arm.animation_data_create()
    samples = {}
    for action in actions:
        arm.animation_data.action = action
        first, last = (int(round(x)) for x in action.frame_range)
        frames = []
        for f in range(first, last + 1):
            scene.frame_set(f)
            rotations = {}
            feet = []
            hips = None
            for pb in arm.pose.bones:
                name = reference_name(pb.name)
                if not name:
                    continue
                rotations[name] = pb.matrix.to_3x3().normalized()
                if name == "Hips":
                    hips = pb.matrix.translation.copy()
                if name.endswith(("Foot", "ToeBase")):
                    feet.append(pb.matrix.translation.z)
            frames.append((rotations, hips, min(feet)))
        samples[action.name] = frames
    arm.animation_data.action = None
    for pb in arm.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
    bpy.context.view_layer.update()
    return samples


def normalise(arm):
    """
    Bring a rigged model to the reference skeleton (see the module text).
    Returns what `write_actions` needs: per reference bone, the rest
    rotation before, the rotation applied by the reference pose, and the
    rest height of the lowest foot bone.
    """
    bpy.context.view_layer.objects.active = arm
    names = {b.name: reference_name(b.name) for b in arm.data.bones}
    by_ref = {ref: n for n, ref in names.items() if ref}
    old_rest = {ref: arm.data.bones[n].matrix_local.to_3x3() for ref, n in by_ref.items()}
    rest_head = {ref: arm.data.bones[n].head_local.copy() for ref, n in by_ref.items()}
    foot_rest = min(h.z for ref, h in rest_head.items() if ref.endswith(("Foot", "ToeBase")))

    # 1-2. Reference pose.
    def rotation_of(bone, parent_delta):
        ref = names[bone.name]
        if not ref:
            return parent_delta
        _, _, direction, _, mode = BONES[ref]
        if mode == KEEP:
            return Matrix.Identity(3)
        if mode == HAND:
            side = "Left" if ref.startswith("Left") else "Right"
            if all(f"{side}Hand{f}1" in rest_head for f in ("Middle", "Index", "Pinky")):
                fingers = rest_head[f"{side}HandMiddle1"] - rest_head[ref]
                knuckles = rest_head[f"{side}HandPinky1"] - rest_head[f"{side}HandIndex1"]
                now = frame(parent_delta @ fingers, parent_delta @ knuckles)
                # Palm down: the knuckles run from the index (front) to the little finger (back).
                return frame(direction, -F) @ now.transposed() @ parent_delta
            return parent_delta
        child = AIM_CHILD.get(ref)
        if child not in rest_head:
            return parent_delta
        now = parent_delta @ (rest_head[child] - rest_head[ref]).normalized()
        return now.rotation_difference(direction).to_matrix() @ parent_delta

    posed, delta, rest = _pose_matrices(arm, rotation_of)
    _apply_pose(arm, posed, rest)
    bpy.context.view_layer.update()
    meshes = [o for o in bpy.data.objects if o.type == "MESH" and any(m.type == "ARMATURE" and m.object == arm for m in o.modifiers)]
    for o in bpy.data.objects:
        o.select_set(False)
    for mesh in meshes:
        bpy.context.view_layer.objects.active = mesh
        for mod in [m for m in mesh.modifiers if m.type == "ARMATURE"]:
            bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    for mesh in meshes:
        mesh.modifiers.new("Armature", "ARMATURE").object = arm

    # 3-4. Reference names and rest axes; no root above the hips.
    bpy.ops.object.mode_set(mode="EDIT")
    edit = arm.data.edit_bones
    for eb in edit:
        eb.use_connect = False
    hips = edit[by_ref["Hips"]]
    if hips.parent is not None and not names[hips.parent.name]:
        root = hips.parent
        for child in list(root.children):
            child.parent = root.parent
        edit.remove(root)
    for ref, n in by_ref.items():
        _, _, direction, z_axis, _ = BONES[ref]
        eb = edit[n]
        eb.tail = eb.head + direction * max(eb.length, 0.01)
        eb.align_roll(z_axis - direction * z_axis.dot(direction))
    bpy.ops.object.mode_set(mode="OBJECT")
    for n, ref in names.items():
        if ref and n in arm.data.bones:
            arm.data.bones[n].name = PREFIX + ref
    return {
        "old_rest": old_rest,
        "posed_by": {ref: delta[n] for ref, n in by_ref.items()},
        "foot_rest": foot_rest,
    }


def write_actions(arm, samples, conversion, ground=True):
    """
    Recreate sampled actions on the normalised skeleton: the same shapes on
    every frame. With `ground`, a clip whose lowest foot never comes down
    to the rest height of the feet is lowered by the gap (floating runs).
    """
    arm.animation_data_create()
    new_rest = {reference_name(b.name): b.matrix_local.to_3x3() for b in arm.data.bones if reference_name(b.name)}
    for name, frames in samples.items():
        action = bpy.data.actions.new(name)
        arm.animation_data.action = action
        gap = min(f[2] for f in frames) - conversion["foot_rest"]
        drop = gap if ground and gap > 0.005 else 0.0
        previous = {}
        for index, (rotations, hips, _) in enumerate(frames):

            def rotation_of(bone, parent_delta, rotations=rotations):
                ref = reference_name(bone.name)
                if not ref or ref not in rotations:
                    return parent_delta
                # Same skin matrix as the original bone on this frame.
                target = rotations[ref] @ conversion["old_rest"][ref].inverted() @ conversion["posed_by"][ref].inverted() @ new_rest[ref]
                return target @ new_rest[ref].inverted()

            posed, _, rest = _pose_matrices(arm, rotation_of, hips_head=hips - Vector((0, 0, drop)))
            _apply_pose(arm, posed, rest, key_frame=index + 1, previous=previous)
        action.use_fake_user = True
        if drop:
            print(f"humanoid: {name} lowered by {drop:.3f} (floating feet)")
    arm.animation_data.action = None
    for pb in arm.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)


def load_normalised(path, keep_actions=False, reset=True):
    """
    Import a rigged model and normalise it; returns its armature. With
    `keep_actions`, its clips are carried over (see `write_actions`), else
    they are dropped. `reset` empties the scene first.
    """
    if reset:
        bpy.ops.wm.read_factory_settings(use_empty=True)
    objects, actions = set(bpy.data.objects), set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in objects]
    for o in new:
        if o.type == "MESH" and o.name.startswith("Icosphere"):
            bpy.data.objects.remove(o)
    arm = next(o for o in new if o.type == "ARMATURE")
    imported = [a for a in bpy.data.actions if a not in actions]
    samples = sample_actions(arm, imported) if keep_actions else None
    arm.animation_data_create()
    arm.animation_data.action = None
    for pb in arm.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
    conversion = normalise(arm)
    for action in imported:
        bpy.data.actions.remove(action)
    if keep_actions:
        write_actions(arm, samples, conversion)
    return arm


def export_model(path):
    """
    Export the scene as a character model: skinned mesh, no clip (the game
    takes them from the animation library), base colour texture only (the
    toon material uses no normal or metal-roughness map).
    """
    for mat in bpy.data.materials:
        tree = mat.node_tree
        if tree is None:
            continue
        bsdf = next((n for n in tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        keep = {link.from_node for link in bsdf.inputs["Base Color"].links} if bsdf else set()
        for node in list(tree.nodes):
            if node.type in ("TEX_IMAGE", "NORMAL_MAP", "SEPARATE_COLOR") and node not in keep:
                tree.nodes.remove(node)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_yup=True,
        export_skins=True,
        export_animations=False,
        export_def_bones=False,
        export_all_influences=False,
    )
