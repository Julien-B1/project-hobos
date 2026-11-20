"""
Combat clips for the shared animation library, keyed by script.

Imported by `humanoid_library.py` (and the preview tooling): `add_clips(arm)`
adds actions to the library armature (VRM-style bone names, T-pose rest,
facing -Y in Blender, about 1 unit tall).

Sword (the fighter):
- `sword_draw`: reach the sword at the left hip (cross draw), pull it out
  and come to the combat guard;
- `sword_idle`: combat guard, sword in the right hand, light bounce and
  footwork (loop);
- `sword_slash`: wind-up over the right shoulder, diagonal cut down to the
  left hip with a step in, back to the guard.

Staff (the wizard):
- `staff_draw`: reach over the right shoulder for the staff slung on the
  back, pull it out, come to the guard;
- `staff_idle`: staff held by the middle in the right hand, diagonal
  (loop);
- `staff_strike`: staff raised overhead in both hands, brought straight
  down on the head of a foe in front, with a step in;
- `staff_cast`: staff raised high, other hand open towards the foe,
  incantation held, back to the guard (the game adds floating clothes and
  hair and the arcane effects while it plays).

Both (from each weapon's guard): `<weapon>_hit` (shock, shoulders thrown
back, half step back, recovery) and `<weapon>_defeat` (shock, stagger,
fall on the back, stay down).

Poses are written as targets, not bone angles: hips offset and turn,
spine and head bends, hand positions with the sword's direction, ankle
positions. Arms and legs are solved by a two-bone IK (elbows and knees
towards a pole), fingers curl around the grip, and every bone without a
target keeps its rest pose relative to its parent.

Body axes (Blender world): L = +X (the character's left), F = -Y
(forward), U = +Z (up). Positions use `P(left, forward, up)` from the
point on the ground under the hips at rest.

Grip convention (for attaching the weapon models): the sword's blade, and
the staff's top, point along the right hand's "thumb axis", the direction
that is forward (-Y) at rest, carried by the hand's rotation. The sword is
held by its hilt, the staff by its middle.
"""
import math

import bpy
from mathutils import Matrix, Quaternion, Vector

L = Vector((1, 0, 0))
F = Vector((0, -1, 0))
U = Vector((0, 0, 1))
GROUND_Y = -0.049

P = lambda l, f, u: Vector((l, GROUND_Y - f, u))  # noqa: E731
B = "J_Bip_"


def axis_rot(axis, degrees):
    return Matrix.Rotation(math.radians(degrees), 3, axis)


def euler(yaw=0.0, pitch=0.0, roll=0.0):
    """Turn about U (yaw: + brings the right side forward), L (pitch: + bends forward), F (roll)."""
    return axis_rot(U, yaw) @ axis_rot(L, pitch) @ axis_rot(F, roll)


def min_rot(a, b):
    """Smallest rotation taking direction a to direction b (3x3)."""
    return a.normalized().rotation_difference(b.normalized()).to_matrix()


def frame(f, t):
    """Orthonormal basis from a main direction f and a second one t (made orthogonal)."""
    f = f.normalized()
    t = (t - f * t.dot(f)).normalized()
    return Matrix((f, t, f.cross(t))).transposed()


def two_bone(root, target, l1, l2, pole):
    """Joint position of a two-bone limb from root towards target, bending towards pole."""
    d = target - root
    dist = min(d.length, (l1 + l2) * 0.999)
    u = d.normalized()
    a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist)
    h = math.sqrt(max(0.0, l1 * l1 - a * a))
    v = pole - u * pole.dot(u)
    v = v.normalized() if v.length > 1e-6 else Vector((0, 0, 1))
    return root + u * a + v * h


class Rig:
    """Rest data of the library armature and the pose solver."""

    def __init__(self, arm):
        self.arm = arm
        self.bones = arm.data.bones
        self.rest = {b.name: b.matrix_local.copy() for b in self.bones}
        self.order = sorted(self.bones, key=lambda b: len(b.parent_recursive))
        head = lambda n: self.rest[B + n].translation  # noqa: E731
        self.lengths = {}
        for side in "LR":
            self.lengths[side + "arm"] = (
                (head(side + "_LowerArm") - head(side + "_UpperArm")).length,
                (head(side + "_Hand") - head(side + "_LowerArm")).length,
            )
            self.lengths[side + "leg"] = (
                (head(side + "_LowerLeg") - head(side + "_UpperLeg")).length,
                (head(side + "_Foot") - head(side + "_LowerLeg")).length,
            )
        # Hand rest frames: fingers direction, forward ("thumb axis"), palm.
        self.hand_rest = {}
        for side in "LR":
            fingers = head(side + "_Middle1") - head(side + "_Hand")
            self.hand_rest[side] = frame(fingers, F)
        self.ankle_rest = {s: head(s + "_Foot").copy() for s in "LR"}

    CHILD = {"UpperArm": "LowerArm", "LowerArm": "Hand", "UpperLeg": "LowerLeg", "LowerLeg": "Foot"}

    def rest_dir(self, name):
        side, part = name[len(B) :].split("_", 1)
        child = f"{B}{side}_{self.CHILD[part]}"
        return (self.rest[child].translation - self.rest[name].translation).normalized()

    def solve(self, pose):
        """Armature-space matrices of every bone for a pose dict (see module doc)."""
        posed, delta = {}, {}
        for bone in self.order:
            n = bone.name
            rest = self.rest[n]
            parent = bone.parent
            if parent:
                pp, pr = posed[parent.name], self.rest[parent.name]
                head = (pp @ pr.inverted() @ rest).translation
                d_parent = delta[parent.name]
            else:
                head, d_parent = rest.translation.copy(), Matrix.Identity(3)
            short = n[len(B) :] if n.startswith(B) else n
            d = d_parent
            if short == "C_Hips":
                head = head + pose.get("hips_offset", Vector())
                d = pose.get("hips", Matrix.Identity(3))
            elif short in ("C_Spine", "C_Chest", "C_UpperChest", "C_Neck", "C_Head"):
                d = d_parent @ pose.get(short[2:].lower(), Matrix.Identity(3))
            elif short.endswith(("_UpperArm", "_LowerArm", "_UpperLeg", "_LowerLeg")):
                side = short[0]
                limb = "arm" if "Arm" in short else "leg"
                if (side + limb) in pose.get("ik", {}):
                    target_dir = pose["ik"][side + limb][short.split("_")[1]]
                    carried = d_parent @ self.rest_dir(n)
                    d = min_rot(carried, target_dir) @ d_parent
            elif short.endswith("_Hand") and short[0] + "hand" in pose:
                f, t = pose[short[0] + "hand"]
                d = frame(f, t) @ self.hand_rest[short[0]].transposed()
            elif short.endswith("_Foot") and short[0] + "foot_yaw" in pose:
                d = axis_rot(U, pose[short[0] + "foot_yaw"])
            elif any(k in short for k in ("Thumb", "Index", "Middle", "Ring", "Little")):
                side = short[0]
                curl = pose.get(side + "curl", 0.0)
                if curl:
                    # Fingers bend towards the palm (down at rest, T-pose).
                    fingers = self.hand_rest[side].col[0]
                    axis = fingers.cross(-U)
                    k = 0.45 if "Thumb" in short else 1.0
                    d = d_parent @ axis_rot(axis, curl * k)
            delta[n] = d
            m = (d @ rest.to_3x3()).to_4x4()
            m.translation = head
            posed[n] = m
        return posed

    def pose(self, spec):
        """Pose dict with the limb IK directions filled in (needs a first pass for the joints)."""
        pose = dict(spec)
        pose["ik"] = {}
        # Pass 1: trunk only, to find the shoulders and the hips joints.
        trunk = self.solve(pose)
        for side in "LR":
            for limb, upper, target_key, pole in (
                ("arm", "_UpperArm", side + "hand_pos", spec.get(side + "elbow_pole", -U + F * 0.3)),
                ("leg", "_UpperLeg", side + "ankle", spec.get(side + "knee_pole", F + U * 0.1)),
            ):
                if target_key not in spec:
                    continue
                root = trunk[B + side + upper].translation
                l1, l2 = self.lengths[side + limb]
                target = spec[target_key]
                joint = two_bone(root, target, l1, l2, pole)
                lower = "Lower" + ("Arm" if limb == "arm" else "Leg")
                upper_name = "Upper" + ("Arm" if limb == "arm" else "Leg")
                pose["ik"][side + limb] = {upper_name: joint - root, lower: target - joint}
        return pose

    def key(self, spec, frame_no):
        posed = self.solve(self.pose(spec))
        for bone in self.order:
            n = bone.name
            pb = self.arm.pose.bones[n]
            rest = self.rest[n]
            if bone.parent:
                base = posed[bone.parent.name] @ self.rest[bone.parent.name].inverted() @ rest
            else:
                base = rest
            basis = base.inverted() @ posed[n]
            pb.rotation_mode = "QUATERNION"
            pb.rotation_quaternion = basis.to_quaternion()
            pb.keyframe_insert("rotation_quaternion", frame=frame_no)
            if n == B + "C_Hips":
                pb.location = basis.translation
                pb.keyframe_insert("location", frame=frame_no)


def lerp_spec(a, b, t):
    """Blend two pose specs (vectors and matrices; matrices by quaternion slerp)."""
    out = {}
    for k in set(a) | set(b):
        va, vb = a.get(k, b.get(k)), b.get(k, a.get(k))
        if isinstance(va, Vector):
            out[k] = va.lerp(vb, t)
        elif isinstance(va, Matrix):
            out[k] = va.to_quaternion().slerp(vb.to_quaternion(), t).to_matrix()
        elif isinstance(va, tuple):
            out[k] = tuple(x.lerp(y, t) for x, y in zip(va, vb))
        elif isinstance(va, (int, float)):
            out[k] = va + (vb - va) * t
        else:
            out[k] = vb if t >= 0.5 else va
    return out


# Poses ---------------------------------------------------------------

def neutral():
    """Standing, arms down (start of the draw)."""
    return {
        "hips": euler(),
        "hips_offset": Vector(),
        "spine": euler(),
        "chest": euler(),
        "head": euler(),
        "Rhand_pos": P(-0.15, 0.03, 0.57),
        "Lhand_pos": P(0.15, 0.03, 0.57),
        "Relbow_pole": -U * 0.2 - F + -L * 0.3,
        "Lelbow_pole": -U * 0.2 - F + L * 0.3,
        "Rankle": P(-0.08, -0.02, 0.068),
        "Lankle": P(0.08, -0.02, 0.068),
        "Rfoot_yaw": -5.0,
        "Lfoot_yaw": 5.0,
        "Rcurl": 20.0,
        "Lcurl": 20.0,
    }


SWORD_UP = (L * 0.3 + F * 0.75 + U * 0.6).normalized()


def guard(bob=0.0, sway=0.0, lift_right=0.0, lift_left=0.0):
    """Combat guard: right foot forward, knees bent, sword pointing up and forward."""
    return {
        "hips_offset": Vector((sway, 0, -0.05 - bob)),
        "hips": euler(yaw=18, pitch=4),
        "spine": euler(yaw=-6, pitch=4),
        "chest": euler(yaw=-6, pitch=3),
        "head": euler(yaw=-8, pitch=-4),
        "Rhand_pos": P(-0.08, 0.2, 0.64 - bob * 0.6),
        "Rhand": (L * 0.9 + F * 0.2, SWORD_UP),
        "Relbow_pole": -U - L * 0.4 + F * 0.2,
        "Lhand_pos": P(0.15, 0.08, 0.66 - bob * 0.6),
        "Lelbow_pole": -U + L * 0.6 - F * 0.2,
        "Rankle": P(-0.09, 0.12, 0.068 + lift_right),
        "Lankle": P(0.12, -0.14, 0.068 + lift_left),
        "Rknee_pole": F + L * 0.1,
        "Lknee_pole": F + L * 0.5,
        "Rfoot_yaw": -8.0,
        "Lfoot_yaw": 35.0,
        "Rcurl": 80.0,
        "Lcurl": 55.0,
    }


def with_(base, **changes):
    out = dict(base)
    out.update(changes)
    return out


def add_action(rig, name, keys, loop=False):
    arm = rig.arm
    arm.animation_data_create()
    action = bpy.data.actions.new(name)
    arm.animation_data.action = action
    for frame_no, spec in keys:
        rig.key(spec, frame_no)
    action.use_fake_user = True
    arm.animation_data.action = None
    return action


def add_clips(arm):
    """Add the sword and staff clips to `arm` (the library armature, at rest)."""
    bpy.context.view_layer.objects.active = arm
    rig = Rig(arm)
    g = guard()

    # Draw: reach across to the left hip, pull up and out, settle in guard.
    reach = with_(
        lerp_spec(neutral(), g, 0.15),
        hips=euler(yaw=-14, pitch=6),
        chest=euler(yaw=-10, pitch=8),
        head=euler(yaw=10, pitch=10),
        Rhand_pos=P(0.08, 0.08, 0.56),
        # Grip on the hilt, blade in the sheath: pointing back and down.
        Rhand=(-U + L * 0.3, -F * 0.8 - U * 0.5 + L * 0.1),
        Relbow_pole=F + U * 0.2,
        Rcurl=70.0,
    )
    pull = with_(
        lerp_spec(neutral(), g, 0.5),
        hips=euler(yaw=8, pitch=2),
        chest=euler(yaw=4, pitch=0),
        Rhand_pos=P(-0.14, 0.14, 0.86),
        Rhand=(L, U * 0.9 + F * 0.3 - L * 0.2),
        Relbow_pole=-U - L * 0.6,
        Rcurl=80.0,
    )
    add_action(
        rig,
        "sword_draw",
        [(1, neutral()), (9, reach), (12, reach), (20, pull), (28, lerp_spec(pull, g, 0.8)), (34, g)],
    )

    # Idle: light bounce on the knees and a small weight shift (loop).
    add_action(
        rig,
        "sword_idle",
        [
            (1, guard()),
            # Footwork: each foot taps in turn while the weight shifts.
            (9, guard(bob=0.012, sway=0.008, lift_left=0.015)),
            (17, guard(bob=0.0, sway=0.0)),
            (25, guard(bob=0.012, sway=-0.008, lift_right=0.015)),
            (33, guard()),
        ],
        loop=True,
    )

    # Slash: wind-up over the right shoulder, diagonal cut with a step in.
    windup = with_(
        g,
        hips=euler(yaw=-6, pitch=0),
        chest=euler(yaw=-12, pitch=-6),
        head=euler(yaw=12, pitch=0),
        hips_offset=Vector((0, 0.02, -0.03)),
        Rhand_pos=P(-0.15, -0.02, 0.98),
        Rhand=(L * 0.6 + F * 0.4, (-F * 0.5 + U * 0.8 + L * 0.2)),
        Relbow_pole=-L + U * 0.3 - F * 0.4,
        Lhand_pos=P(0.18, 0.18, 0.75),
    )
    cut = with_(
        g,
        hips=euler(yaw=40, pitch=14),
        chest=euler(yaw=12, pitch=10),
        head=euler(yaw=-20, pitch=-6),
        hips_offset=Vector((0, -0.06, -0.06)),
        Rhand_pos=P(0.12, 0.26, 0.5),
        Rhand=(L * 0.3 + F * 0.6 + U * 0.3, (L * 0.6 + F * 0.5 - U * 0.6)),
        Relbow_pole=-U - L * 0.3,
        Lhand_pos=P(0.2, -0.05, 0.62),
        Rankle=P(-0.07, 0.22, 0.068),
        Lankle=P(0.11, -0.1, 0.068),
    )
    add_action(
        rig,
        "sword_slash",
        [(1, g), (8, windup), (10, windup), (13, cut), (18, cut), (30, lerp_spec(cut, g, 0.85)), (38, g)],
    )

    add_hit_and_defeat(rig, "sword", g)
    add_staff_clips(rig)


def add_hit_and_defeat(rig, prefix, g):
    """`<prefix>_hit` and `<prefix>_defeat`, from and back to the guard `g`."""
    # Hit: shock (shoulders back), half step back, recover to the guard.
    shock = with_(
        g,
        hips=euler(yaw=12, pitch=-6),
        spine=euler(pitch=-8),
        chest=euler(yaw=-4, pitch=-14),
        head=euler(pitch=-22, roll=6),
        hips_offset=Vector((0, 0.04, -0.03)),
        Rhand_pos=P(-0.2, 0.12, 0.74),
        Lhand_pos=P(0.24, 0.02, 0.7),
    )
    step_back = with_(
        lerp_spec(shock, g, 0.4),
        hips_offset=Vector((0, 0.08, -0.05)),
        Rankle=P(-0.08, -0.04, 0.068),
        Lankle=P(0.11, -0.14, 0.068),
    )
    add_action(
        rig,
        f"{prefix}_hit",
        [(1, g), (4, shock), (7, shock), (13, step_back), (22, lerp_spec(step_back, g, 0.7)), (32, g)],
    )

    # Defeat: shock, stagger back, fall on the back, stay down.
    stagger = with_(
        step_back,
        hips=euler(yaw=6, pitch=-14),
        chest=euler(pitch=-18),
        hips_offset=Vector((0, 0.12, -0.12)),
        Rhand_pos=P(-0.22, 0.05, 0.6),
    )
    falling = {
        "hips": euler(yaw=5, pitch=-45),
        "chest": euler(pitch=-10),
        "head": euler(pitch=20),
        "hips_offset": Vector((0, 0.22, -0.34)),
        "Rhand_pos": P(-0.3, -0.1, 0.45),
        "Lhand_pos": P(0.3, -0.12, 0.42),
        "Relbow_pole": -U - L,
        "Lelbow_pole": -U + L,
        "Rankle": P(-0.1, 0.1, 0.07),
        "Lankle": P(0.12, 0.0, 0.07),
        "Rknee_pole": F + U,
        "Lknee_pole": F + U,
        "Rcurl": 50.0,
        "Lcurl": 40.0,
    }
    down = {
        "hips": euler(yaw=8, pitch=-84),
        "spine": euler(pitch=6),
        "chest": euler(pitch=4),
        "head": euler(yaw=35, pitch=12),
        "hips_offset": Vector((0, 0.3, -0.52)),
        "Rhand_pos": P(-0.38, -0.42, 0.05),
        # Weapon dropped flat on the ground, pointing out.
        "Rhand": (-U, -L - F * 0.3),
        "Lhand_pos": P(0.32, -0.5, 0.05),
        "Relbow_pole": -U - L * 0.3,
        "Lelbow_pole": -U + L * 0.3,
        "Rankle": P(-0.16, 0.22, 0.06),
        "Lankle": P(0.14, 0.12, 0.09),
        "Rknee_pole": U + F,
        "Lknee_pole": U + F * 0.5 + L * 0.5,
        "Rcurl": 35.0,
        "Lcurl": 30.0,
    }
    bounce = with_(down, chest=euler(pitch=12), hips_offset=Vector((0, 0.3, -0.5)))
    add_action(
        rig,
        f"{prefix}_defeat",
        [(1, g), (4, shock), (10, stagger), (18, falling), (24, down), (27, bounce), (31, down), (45, down)],
    )


# Staff ---------------------------------------------------------------

STAFF_UP = (L * 0.6 + F * 0.35 + U * 0.7).normalized()


def staff_guard(bob=0.0):
    """Staff held by the middle in the right hand, diagonal, top up and to the left."""
    return {
        "hips_offset": Vector((0, 0, -0.025 - bob)),
        "hips": euler(yaw=10, pitch=2),
        "spine": euler(yaw=-4, pitch=2),
        "chest": euler(yaw=-4, pitch=-2 + bob * 100),
        "head": euler(yaw=-6),
        "Rhand_pos": P(-0.13, 0.12, 0.64 - bob * 0.5),
        "Rhand": (L * 0.9 + F * 0.3, STAFF_UP),
        "Relbow_pole": -U - L * 0.5,
        "Lhand_pos": P(0.15, 0.06, 0.6),
        "Lelbow_pole": -U + L * 0.5 - F * 0.3,
        "Rankle": P(-0.08, 0.06, 0.068),
        "Lankle": P(0.1, -0.08, 0.068),
        "Rfoot_yaw": -8.0,
        "Lfoot_yaw": 20.0,
        "Rcurl": 80.0,
        "Lcurl": 25.0,
    }


def add_staff_clips(rig):
    """Staff clips: draw from the back, guard, overhead strike, cast; hit and defeat."""
    g = staff_guard()

    # Draw: reach over the right shoulder for the staff slung on the back,
    # pull it up and out, swing it down to the guard.
    reach = with_(
        lerp_spec(neutral(), g, 0.2),
        hips=euler(yaw=-6, pitch=-2),
        chest=euler(yaw=-12, pitch=-4),
        head=euler(yaw=25, pitch=-6),
        Rhand_pos=P(-0.1, -0.06, 0.96),
        # Staff on the back: from the left hip up to above the right shoulder.
        Rhand=(-F * 0.6 + L * 0.3 + U * 0.2, -L * 0.45 + U * 0.85 - F * 0.15),
        Relbow_pole=U * 0.4 - L - F * 0.3,
        Rcurl=70.0,
    )
    lift = with_(
        lerp_spec(neutral(), g, 0.5),
        Rhand_pos=P(-0.18, 0.06, 1.0),
        Rhand=(L * 0.8 + F * 0.3, U * 0.95 - L * 0.2 + F * 0.1),
        Relbow_pole=-L + U * 0.2,
        Rcurl=80.0,
    )
    add_action(
        rig,
        "staff_draw",
        [(1, neutral()), (10, reach), (13, reach), (21, lift), (29, lerp_spec(lift, g, 0.8)), (36, g)],
    )

    # Idle: calm breathing, the staff swaying a little (loop).
    add_action(
        rig,
        "staff_idle",
        [(1, staff_guard()), (17, staff_guard(bob=0.01)), (33, staff_guard())],
        loop=True,
    )

    # Strike: both hands raise the staff overhead, then bring it straight
    # down on the head of a foe in front, with a step in.
    raised = with_(
        g,
        hips=euler(yaw=4, pitch=-4),
        chest=euler(pitch=-10),
        head=euler(pitch=-8),
        hips_offset=Vector((0, 0.02, -0.02)),
        Rhand_pos=P(-0.05, 0.02, 1.06),
        Rhand=(L * 0.7 + F * 0.3, -F * 0.75 + U * 0.6),
        Relbow_pole=-L + F * 0.3,
        Lhand_pos=P(0.06, 0.0, 1.02),
        Lhand=(-L * 0.7 + F * 0.3, -F * 0.75 + U * 0.6),
        Lelbow_pole=L + F * 0.3,
        Lcurl=75.0,
    )
    impact = with_(
        g,
        hips=euler(yaw=6, pitch=16),
        chest=euler(pitch=12),
        head=euler(pitch=-14),
        hips_offset=Vector((0, -0.07, -0.07)),
        Rhand_pos=P(-0.04, 0.3, 0.72),
        Rhand=(L * 0.8 - U * 0.2, F * 0.95 - U * 0.1),
        Relbow_pole=-U - L * 0.4,
        Lhand_pos=P(0.04, 0.26, 0.74),
        Lhand=(-L * 0.8 - U * 0.2, F * 0.95 - U * 0.1),
        Lelbow_pole=-U + L * 0.4,
        Lcurl=75.0,
        Rankle=P(-0.07, 0.2, 0.068),
        Lankle=P(0.1, -0.1, 0.068),
    )
    add_action(
        rig,
        "staff_strike",
        [(1, g), (9, raised), (12, raised), (15, impact), (20, impact), (32, lerp_spec(impact, g, 0.85)), (40, g)],
    )

    # Cast: raise the staff high, open the other hand towards the foe, hold
    # the incantation, come back to the guard. The game makes the clothes and
    # hair float and draws the arcane effects while a `*_cast` clip plays.
    raise_high = with_(
        g,
        hips=euler(yaw=8, pitch=-4),
        spine=euler(pitch=-4),
        chest=euler(pitch=-10),
        head=euler(pitch=-14),
        Rhand_pos=P(-0.12, 0.1, 1.1),
        Rhand=(L * 0.8 + F * 0.2, U),
        Relbow_pole=-L - F * 0.2,
        Lhand_pos=P(0.16, 0.26, 0.82),
        Lhand=(F + L * 0.2, U),
        Lelbow_pole=-U + L,
        Lcurl=0.0,
    )
    surge = with_(raise_high, chest=euler(pitch=-14), head=euler(pitch=-18), Rhand_pos=P(-0.12, 0.12, 1.13))
    add_action(
        rig,
        "staff_cast",
        [(1, g), (10, raise_high), (24, surge), (40, raise_high), (52, surge), (62, lerp_spec(raise_high, g, 0.6)), (72, g)],
    )

    add_hit_and_defeat(rig, "staff", g)
