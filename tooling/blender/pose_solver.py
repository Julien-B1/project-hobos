"""
Pose solver for clips keyed by script (see `combat_clips.py`).

A clip is a list of keys `(frame, spec)`. A spec gives targets, not bone
angles: hips offset and turn, spine and head bends, grip positions and
weapon directions for the hands, ankle positions and foot angles. For
every frame of the clip (not only the keys):

1. the targets are interpolated between the keys, channel by channel, with
   a monotone cubic (PCHIP): smooth through the keys, flat at holds, no
   overshoot;
2. the trunk is posed, then each arm and leg is solved by a two-bone IK
   towards its target, so hands and feet follow smooth paths in space and
   planted feet do not slide;
3. bone orientations are built as full frames, not shortest rotations:
   the elbow and knee hinges stay anatomical. The asked weapon axis is
   turned into the two joint angles a hand really has, each kept in its
   range: the forearm's roll (pronation, supination) and the sideways bend
   of the wrist; 60 % of the roll is put in the forearm bone, the rest at
   the wrist. An axis the arm cannot give is approached, never forced. The
   elbow's swivel around the shoulder-to-hand line is chosen per frame,
   near the hinted direction (`*_pole`): the one that brings the weapon
   closest to the asked axis and keeps the arm out of the trunk, close to
   the previous frame's;
4. joint limits (`TRUNK_LIMITS` and the constants after it): the trunk,
   elbow, knee, forearm and wrist stay in their ranges by construction; the
   shoulder, hip and ankle are checked and reported, and the shoulder's
   range also guides the elbow's swivel;
5. every bone is keyed on every frame, with quaternions kept on the same
   hemisphere from frame to frame (no flip when they are interpolated).

Body axes (Blender world, the armature is at the origin, T-pose rest,
about 1 unit tall): L = +X (the character's left), F = -Y (forward),
U = +Z (up). `P(left, forward, up)` is a point from the ground under the
hips at rest.

Spec channels (all required in every key; build keys from a complete base
pose with `pose(base, **changes)`):

- `hips_pos` Vector: offset of the hips from rest;
- `hips`, `spine`, `chest`, `head`: (yaw, pitch, roll) in degrees: yaw
  about U (+ brings the right side forward), pitch about L (+ bends
  forward), roll about F; each relative to its parent;
- `R_grip`, `L_grip` Vector: centre of the hand's grip (palm);
- `R_axis`, `L_axis` Vector: weapon direction, from the grip towards the
  thumb side (a sword's blade, a staff's head);
- `R_free`, `L_free` float 0..1: 1 ignores the axis and holds the hand in
  the natural relaxed orientation for where the forearm points;
- `R_pole`, `L_pole` Vector: where the elbow points, in the chest's frame;
- `R_ankle`, `L_ankle` Vector; `R_foot`, `L_foot`: (yaw, pitch) degrees
  (pitch + lowers the toes: heel lift);
- `R_knee`, `L_knee` Vector: where the knee points, in the hips' frame;
- `R_curl`, `L_curl` float: finger curl in degrees (0 open, 80 fist).

A key may also hold `R_grab = (socket, along)`: the right hand's grip and
axis are then taken from that weapon socket, `along` units from its origin
against its axis (see `SOCKETS`), as posed at that key.
"""
import math

from mathutils import Matrix, Quaternion, Vector

import humanoid

L = Vector((1, 0, 0))
F = Vector((0, -1, 0))
U = Vector((0, 0, 1))
GROUND_Y = -0.049
# Prefix of the solver's own bone labels (see Rig).
B = "J_Bip_"

# Forearm roll from neutral (pronation, supination), radians; and the range
# of the angle between the weapon axis and the forearm, degrees (90: a
# hammer grip square to the forearm; less: the weapon leans forward).
ROLL_LIMIT = math.radians(85)
# Largest change of the elbow's swivel from one frame to the next, degrees.
SWIVEL_STEP = 12
COCK_RANGE = (48.0, 125.0)
FOREARM_TWIST_SHARE = 0.6
# Grip centre from the wrist, in the hand's frame: along the fingers, and
# towards the palm.
GRIP_ALONG = 0.036
GRIP_PALM = 0.012
# Joint limits, in degrees, after the usual ranges of a healthy adult.
# Enforced by construction: the trunk bends are clamped, the elbow and the
# knee cannot fold further than their range (the hand or foot target is
# moved out), the forearm roll and the wrist bend are bounded (above).
# Checked and reported (`make clip-check`), because moving them would move a
# hand or a planted foot: the shoulder, the hip and the ankle.
TRUNK_LIMITS = {
    # (yaw, pitch, roll): lowest and highest of each.
    "spine": ((-20, 20), (-15, 30), (-15, 15)),
    "chest": ((-25, 25), (-20, 25), (-15, 15)),
    "head": ((-70, 70), (-45, 45), (-30, 30)),
}
# Largest fold of the elbow and of the knee (0: straight).
ELBOW_FOLD = 150.0
KNEE_FOLD = 150.0
# Upper arm, in the chest's frame: how far it may point backwards and
# across the body (cosines towards the back and towards the other side).
SHOULDER_BACK = math.cos(math.radians(40))
SHOULDER_ACROSS = math.cos(math.radians(50))
# Thigh, in the hips' frame: forward lift, backward reach, sideways out and in.
HIP_FLEXION = 125.0
HIP_EXTENSION = 30.0
HIP_ABDUCTION = 55.0
HIP_ADDUCTION = 30.0
# Angle between the foot and the shin (90: standing).
ANKLE_RANGE = (58.0, 145.0)

# Trunk section for the arm checks: half width, depth in front and behind.
TRUNK_HALF_WIDTH = 0.1
TRUNK_FRONT = 0.1
TRUNK_BACK = 0.075


def P(left, forward, up):
    """Point from the ground under the hips at rest (body axes)."""
    return Vector((left, GROUND_Y - forward, up))


def V(left, forward, up):
    """Direction in body axes (not normalized)."""
    return L * left + F * forward + U * up


def axis_rot(axis, degrees):
    return Matrix.Rotation(math.radians(degrees), 3, axis)


def euler(angles):
    """(yaw, pitch, roll) degrees to a rotation matrix."""
    yaw, pitch, roll = angles
    return axis_rot(U, yaw) @ axis_rot(L, pitch) @ axis_rot(F, roll)


def perp(v, axis):
    """Part of v perpendicular to the unit vector axis."""
    return v - axis * v.dot(axis)


def frame(a, b):
    """Rotation whose columns are a, b made perpendicular to a, and a x b."""
    a = a.normalized()
    b = perp(b, a)
    if b.length < 1e-6:
        b = perp(U if abs(a.dot(U)) < 0.9 else F, a)
    b.normalize()
    return Matrix((a, b, a.cross(b))).transposed()


def two_bone(root, target, l1, l2, pole, fold=150.0):
    """
    Middle joint of a two-bone limb; returns (joint, reached target, side
    the joint points to). The target is moved along its line when it is out
    of reach, or so close that the joint would fold more than `fold` degrees.
    """
    d = target - root
    reach = (l1 + l2) * 0.998
    inner = math.radians(180 - fold)
    closest = math.sqrt(l1 * l1 + l2 * l2 - 2 * l1 * l2 * math.cos(inner))
    dist = d.length
    if dist > reach or dist < closest:
        dist = min(reach, max(closest, dist))
        u = d.normalized() if d.length > 1e-6 else Vector((0, 0, -1))
        target = root + u * dist
    u = (target - root).normalized()
    a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist)
    h = math.sqrt(max(0.0, l1 * l1 - a * a))
    v = perp(pole, u)
    v = v.normalized() if v.length > 1e-6 else perp(U, u).normalized()
    return root + u * a + v * h, target, v


def pchip(times, values, t):
    """Monotone cubic through (times, values) at t; values are floats."""
    n = len(times)
    if t <= times[0]:
        return values[0]
    if t >= times[-1]:
        return values[-1]
    i = max(k for k in range(n - 1) if times[k] <= t)
    h = [times[k + 1] - times[k] for k in range(n - 1)]
    d = [(values[k + 1] - values[k]) / h[k] for k in range(n - 1)]

    def slope(k):
        if k == 0 or k == n - 1:
            return 0.0
        if d[k - 1] * d[k] <= 0:
            return 0.0
        w1, w2 = 2 * h[k] + h[k - 1], h[k] + 2 * h[k - 1]
        return (w1 + w2) / (w1 / d[k - 1] + w2 / d[k])

    m0, m1 = slope(i), slope(i + 1)
    s = (t - times[i]) / h[i]
    h00 = 2 * s**3 - 3 * s**2 + 1
    h10 = s**3 - 2 * s**2 + s
    h01 = -2 * s**3 + 3 * s**2
    h11 = s**3 - s**2
    return h00 * values[i] + h10 * h[i] * m0 + h01 * values[i + 1] + h11 * h[i] * m1


def interpolate(keys, t):
    """Spec at frame t from the keys [(frame, spec)], channel by channel."""
    times = [k[0] for k in keys]
    out = {}
    for name in keys[0][1]:
        samples = [k[1][name] for k in keys]
        first = samples[0]
        if isinstance(first, Vector):
            out[name] = Vector([pchip(times, [s[c] for s in samples], t) for c in range(3)])
        elif isinstance(first, tuple):
            out[name] = tuple(pchip(times, [s[c] for s in samples], t) for c in range(len(first)))
        else:
            out[name] = pchip(times, samples, t)
    return out


def pose(base, **changes):
    """Copy of a spec with some channels replaced."""
    out = dict(base)
    out.update(changes)
    return out


def mix(a, b, t):
    """Blend of two specs (linear per channel)."""
    out = {}
    for k in a:
        va, vb = a[k], b[k]
        if isinstance(va, Vector):
            out[k] = va.lerp(vb, t)
        elif isinstance(va, tuple):
            out[k] = tuple(x + (y - x) * t for x, y in zip(va, vb))
        else:
            out[k] = va + (vb - va) * t
    return out


# Weapon sockets: name -> (parent bone, offset from the parent's head, axis
# towards the weapon's head, flat direction), at rest, in model space, for
# a model whose hips are REFERENCE_HIPS high (offsets scale with the hips'
# height). A weapon's own grip frame sits on the socket: sword held by the
# hilt, staff by its middle.
REFERENCE_HIPS = 0.607
SOCKETS = {
    # Sword at the belt: hilt in front of the left hip, blade back and down.
    "Socket_Sheath_Sword": ("C_Hips", V(0.103, 0.085, 0.033), V(0.2, -0.72, -0.66), V(0, 0.66, -0.72)),
    # Staff slung on the back, diagonal: head down by the left hip, foot
    # above the right shoulder.
    "Socket_Sheath_Staff": ("C_UpperChest", V(0.018, -0.15, -0.047), V(0.5, 0, -0.87), V(0.87, 0, 0.5)),
}
GRIP_SOCKET = "Socket_Grip_R"


class Rig:
    """Rest data of the armature and the per-frame solver."""

    def __init__(self, arm):
        self.arm = arm
        # The solver names bones by short labels (`C_Hips`, `L_UpperArm`:
        # centre, left, right); `real` gives the armature's bone names (the
        # reference skeleton, see humanoid.py).
        def label(bone):
            ref = humanoid.reference_name(bone.name)
            return B + humanoid.BONES[ref][1] if ref else bone.name

        bones = sorted(arm.data.bones, key=lambda b: len(b.parent_recursive))
        self.real = {label(b): b.name for b in bones}
        self.parent = {label(b): label(b.parent) if b.parent else None for b in bones}
        self.rest = {label(b): b.matrix_local.copy() for b in bones}
        self.order = [label(b) for b in bones]
        self.head = lambda n: self.rest[B + n].translation
        self.lengths, self.limb_rest, self.hand_rest = {}, {}, {}
        for s in "LR":
            for limb, a, b, c, bend in (
                ("arm", "UpperArm", "LowerArm", "Hand", F),
                ("leg", "UpperLeg", "LowerLeg", "Foot", -F),
            ):
                pa, pb, pc = (self.head(f"{s}_{x}") for x in (a, b, c))
                self.lengths[s + limb] = ((pb - pa).length, (pc - pb).length)
                # Rest frames: bone direction and the way the joint bends.
                self.limb_rest[f"{s}_{a}"] = frame(pb - pa, bend)
                self.limb_rest[f"{s}_{b}"] = frame(pc - pb, bend)
            fingers = self.head(s + "_Middle1") - self.head(s + "_Hand")
            self.hand_rest[s] = frame(fingers, F)
        # Size of the model against the reference (socket offsets).
        self.scale = self.head("C_Hips").z / REFERENCE_HIPS
        self.overreach = 0.0
        self.warnings = []
        self.label = ""
        # Elbow swivel chosen at the previous frame, per side (continuity).
        self.swivel = {}
        # Forearm roll chosen at the previous frame, per side (continuity).
        self.roll = {}
        # Wrist state of the last solved frame, per side: bend from the
        # forearm's line and roll left at the wrist joint, in degrees.
        self.wrist = {}
        # Per clip: worst wrist bend, wrist roll and rotation step per frame.
        self.report = {}

    # Hands ------------------------------------------------------------

    def hand_frame(self, side, forearm, thumb, axis, free):
        """
        Posed hand frame (columns: fingers, weapon axis, their cross
        product) for a forearm direction and its neutral thumb direction
        (perpendicular to it, towards the inside of the elbow: thumb forward
        when the arm hangs, up when the forearm points forward).

        The asked weapon axis is turned into two joint angles, each kept in
        its range: the forearm's roll (pronation and supination, within
        `ROLL_LIMIT` of neutral) and the angle between the weapon and the
        forearm (`COCK_RANGE`: the wrist's sideways bend). A relaxed hand
        (`free` = 1) is neutral: no roll, weapon axis square to the forearm.
        Returns (frame, roll in radians, degrees between asked and got axis).
        """
        forearm = forearm.normalized()
        thumb = perp(thumb, forearm).normalized()
        axis = axis.normalized()
        cock = max(COCK_RANGE[0], min(COCK_RANGE[1], math.degrees(forearm.angle(axis))))
        flat = perp(axis, forearm)
        previous = self.roll.get(side, 0.0)
        if flat.length > 1e-4:
            roll = math.atan2(thumb.cross(flat).dot(forearm), thumb.dot(flat))
            # Straight behind the forearm both limits are as far: stay on
            # the previous frame's side instead of flipping.
            if abs(roll) > math.radians(150) and previous * roll < 0:
                roll = -roll
            roll = max(-ROLL_LIMIT, min(ROLL_LIMIT, roll))
            # Near the forearm's line the roll is ill-defined: lean on the
            # previous frame's.
            trust = min(1.0, flat.length / 0.5)
            roll = previous + (roll - previous) * trust
        else:
            roll = previous
        roll *= 1 - free
        cock = cock + (90 - cock) * free
        side_dir = Matrix.Rotation(roll, 3, forearm) @ thumb
        got = (forearm * math.cos(math.radians(cock)) + side_dir * math.sin(math.radians(cock))).normalized()
        fingers = perp(forearm, got).normalized()
        error = 0.0 if free > 0.5 else math.degrees(got.angle(axis))
        return Matrix((fingers, got, fingers.cross(got))).transposed(), roll, error

    def grip_offset(self, side, hand):
        """Vector from the wrist to the grip centre for a posed hand frame."""
        fingers, _, normal = hand.col[0], hand.col[1], hand.col[2]
        # The cross product points to the back of the right hand, and to
        # the palm of the left one.
        palm = -normal if side == "R" else normal
        return fingers * GRIP_ALONG + palm * GRIP_PALM

    # Solver -----------------------------------------------------------

    def trunk(self, spec):
        """Rotations (from rest, model space) and head positions of the trunk bones."""
        delta, heads = {}, {}

        def limited(name):
            angles = tuple(max(lo, min(hi, a)) for a, (lo, hi) in zip(spec[name], TRUNK_LIMITS[name]))
            if angles != tuple(spec[name]):
                self.warnings.append(f"{self.label}: {name} bend beyond its range by {max(abs(a - b) for a, b in zip(angles, spec[name])):.0f}")
            return angles

        d_hips = euler(spec["hips"])
        d_spine = d_hips @ euler(limited("spine"))
        half = tuple(a * 0.5 for a in limited("chest"))
        d_chest = d_spine @ euler(half)
        d_upper = d_chest @ euler(half)
        head = limited("head")
        d_neck = d_upper @ euler(tuple(a * 0.4 for a in head))
        d_head = d_neck @ euler(tuple(a * 0.6 for a in head))
        delta = {
            B + "C_Hips": d_hips,
            B + "C_Spine": d_spine,
            B + "C_Chest": d_chest,
            B + "C_UpperChest": d_upper,
            B + "C_Neck": d_neck,
            B + "C_Head": d_head,
        }
        heads[B + "C_Hips"] = self.head("C_Hips") + spec["hips_pos"]
        for child, parent in (("C_Spine", "C_Hips"), ("C_Chest", "C_Spine"), ("C_UpperChest", "C_Chest"), ("C_Neck", "C_UpperChest"), ("C_Head", "C_Neck")):
            offset = self.head(child) - self.head(parent)
            heads[B + child] = heads[B + parent] + delta[B + parent] @ offset
        return delta, heads

    def trunk_depth(self, point, chest, delta, heads):
        """How deep a point is inside the trunk (0 outside), model units."""
        a, b = heads[B + "C_Hips"], heads[B + "C_Neck"]
        along = b - a
        t = max(0.0, min(1.0, (point - a).dot(along) / along.length_squared))
        d = point - (a + along * t)
        side, front = d.dot(chest @ L), d.dot(chest @ F)
        # Elliptical section: wider than deep, deeper in front (bust) than behind.
        r = math.hypot(side / TRUNK_HALF_WIDTH, front / (TRUNK_FRONT if front > 0 else TRUNK_BACK))
        return max(0.0, 1.0 - r) * TRUNK_HALF_WIDTH

    def arm_at(self, s, spec, root, side_dir, chest, delta, heads):
        """Arm solved with the elbow pointing towards `side_dir`."""
        l1, l2 = self.lengths[s + "arm"]
        grip = spec[s + "_grip"]
        ua, la = f"{s}_UpperArm", f"{s}_LowerArm"
        # The wrist depends on the hand's orientation, which depends on the
        # forearm: a few rounds settle it.
        wrist = grip
        for _ in range(4):
            elbow, reached, side = two_bone(root, wrist, l1, l2, side_dir, ELBOW_FOLD)
            forearm = (reached - elbow).normalized()
            upper = (elbow - root).normalized()
            # The forearm folds away from the side the elbow points to.
            bend = -perp(side, upper)
            hinge = upper.cross(bend.normalized())
            thumb = hinge.cross(forearm)
            hand, roll, error = self.hand_frame(s, forearm, thumb, spec[s + "_axis"], spec[s + "_free"])
            wrist = grip - self.grip_offset(s, hand)
        over = (wrist - root).length - (l1 + l2)
        d_upper = frame(upper, bend) @ self.limb_rest[ua].transposed()
        d_lower = frame(forearm, thumb) @ self.limb_rest[la].transposed()
        d_hand = hand @ self.hand_rest[s].transposed()
        # Shoulder range: not too far behind the back nor across the chest.
        local = chest.transposed() @ upper
        outward = 1 if s == "L" else -1
        shoulder = max(0.0, -local.dot(F) - SHOULDER_BACK, -local.dot(L) * outward - SHOULDER_ACROSS)
        inside = max(
            self.trunk_depth(elbow, chest, delta, heads),
            self.trunk_depth(elbow.lerp(reached, 0.5), chest, delta, heads),
            self.trunk_depth(reached, chest, delta, heads),
        )
        return {
            "elbow": elbow, "wrist": reached, "hand": hand, "forearm": forearm, "over": over,
            "d_upper": d_upper, "d_lower": d_lower, "d_hand": d_hand, "twist": roll, "inside": inside,
            "error": error, "shoulder": shoulder,
        }

    def solve_arm(self, s, spec, root, hint, chest, delta, heads):
        """
        Arm with the elbow swivel chosen around the hinted direction: the
        weapon as close as possible to the asked axis, no arm through the
        trunk, close to the hint and to the previous frame's choice.
        """
        axis = (spec[s + "_grip"] - root).normalized()
        base = perp(hint, axis)
        base = base.normalized() if base.length > 0.05 else None
        previous = self.swivel.get(s)
        if previous is not None:
            previous = perp(previous, axis)
            previous = previous.normalized() if previous.length > 1e-4 else None

        def cost(side_dir):
            arm = self.arm_at(s, spec, root, side_dir, chest, delta, heads)
            # Weapon on its axis, arm out of the trunk, forearm near neutral,
            # elbow near the hint; the previous frame only breaks ties (the
            # rate is limited below).
            c = (arm["error"] / 20) ** 2 + (arm["inside"] / 0.01) ** 2 + 0.6 * (arm["twist"] / ROLL_LIMIT) ** 2
            c += (arm["shoulder"] / 0.1) ** 2
            if base is not None:
                c += 0.3 * side_dir.angle(base) ** 2
            if previous is not None:
                c += 0.2 * side_dir.angle(previous) ** 2
            return c, arm, side_dir

        def around(centre, degrees):
            return [Matrix.Rotation(math.radians(a), 3, axis) @ centre for a in degrees]

        if previous is None:
            start = base if base is not None else perp(-U, axis).normalized()
            best = min((cost(v) for v in around(start, range(-80, 81, 10))), key=lambda r: r[0])
            fine = min((cost(v) for v in around(best[2], range(-8, 9, 2))), key=lambda r: r[0])
        else:
            # The elbow swings at most SWIVEL_STEP degrees per frame.
            fine = min((cost(v) for v in around(previous, range(-SWIVEL_STEP, SWIVEL_STEP + 1, 2))), key=lambda r: r[0])
        self.swivel[s] = fine[2]
        self.roll[s] = fine[1]["twist"]
        return fine[1]

    def carried(self, name, parent, delta, heads):
        """Head of a bone carried by its posed parent."""
        return heads[B + parent] + delta[B + parent] @ (self.head(name) - self.head(parent))

    def socket_world(self, socket, spec, along=0.0):
        """Posed origin (moved `along` against the axis) and axis of a weapon socket."""
        parent, offset, axis, _ = SOCKETS[socket]
        delta, heads = self.trunk(spec)
        d = delta[B + parent]
        axis = (d @ axis).normalized()
        point = heads[B + parent] + d @ (offset * self.scale)
        return point - axis * along, axis

    def resolve(self, keys):
        """Replace `R_grab` entries by explicit grip and axis targets."""
        out = []
        for frame_no, spec in keys:
            spec = dict(spec)
            grab = spec.pop("R_grab", None)
            if grab:
                spec["R_grip"], spec["R_axis"] = self.socket_world(grab[0], spec, grab[1])
                spec["R_free"] = 0.0
            out.append((frame_no, spec))
        return out

    def solve(self, spec, label=""):
        """Model-space rotation from rest and head position of every bone."""
        self.label = label
        delta, heads = self.trunk(spec)
        chest, hips = delta[B + "C_UpperChest"], delta[B + "C_Hips"]

        for s, out in (("L", 1), ("R", -1)):
            # Arm ------------------------------------------------------
            grip = spec[s + "_grip"]
            # Collarbone: lifts as the hand goes above the shoulder.
            sh, ua = f"{s}_Shoulder", f"{s}_UpperArm"
            heads[B + sh] = self.carried(sh, "C_UpperChest", delta, heads)
            rest_dir = chest @ (self.head(ua) - self.head(sh)).normalized()
            shoulder_rest = heads[B + sh] + rest_dir * (self.head(ua) - self.head(sh)).length
            lift = max(0.0, min(1.0, (grip.z - shoulder_rest.z + 0.05) / 0.3)) * 0.4
            lifted = (rest_dir + chest @ U * lift).normalized()
            delta[B + sh] = (rest_dir.rotation_difference(lifted).to_matrix()) @ chest
            heads[B + ua] = self.carried(ua, sh, delta, heads)
            root = heads[B + ua]
            l1, l2 = self.lengths[s + "arm"]
            hint = chest @ spec[s + "_pole"]
            arm = self.solve_arm(s, spec, root, hint, chest, delta, heads)
            if arm["over"] > 0.004:
                self.overreach = max(self.overreach, arm["over"])
                self.warnings.append(f"{label}: {s} hand out of reach by {arm['over']:.3f}")
            if arm["inside"] > 0.012:
                self.warnings.append(f"{label}: {s} arm inside the trunk by {arm['inside']:.3f}")
            if arm["shoulder"] > 0.08:
                self.warnings.append(f"{label}: {s} shoulder beyond its range by {math.degrees(math.asin(min(1.0, arm['shoulder']))):.0f}")
            if arm["error"] > 12:
                self.warnings.append(f"{label}: {s} weapon axis off the asked one by {arm['error']:.0f}")
            la = f"{s}_LowerArm"
            elbow, wrist, hand, forearm = arm["elbow"], arm["wrist"], arm["hand"], arm["forearm"]
            d_upper, d_hand = arm["d_upper"], arm["d_hand"]
            # Pronation: part of the hand's roll about the forearm goes in
            # the forearm bone, so the wrist joint does not twist alone.
            rest_axis = self.limb_rest[la].col[0]
            share = arm["twist"] * FOREARM_TWIST_SHARE
            d_lower = arm["d_lower"] @ Matrix.Rotation(share, 3, rest_axis)
            self.wrist[s] = (math.degrees(forearm.angle(hand.col[0])), math.degrees(arm["twist"] - share))
            delta[B + ua], delta[B + la], delta[B + s + "_Hand"] = d_upper, d_lower, d_hand
            heads[B + la], heads[B + s + "_Hand"] = elbow, wrist

            # Leg ------------------------------------------------------
            ul, ll = f"{s}_UpperLeg", f"{s}_LowerLeg"
            heads[B + ul] = self.carried(ul, "C_Hips", delta, heads)
            root = heads[B + ul]
            l1, l2 = self.lengths[s + "leg"]
            ankle = spec[s + "_ankle"]
            pole = hips @ spec[s + "_knee"]
            knee, reached, side = two_bone(root, ankle, l1, l2, pole, KNEE_FOLD)
            over = (ankle - root).length - (l1 + l2)
            if over > 0.004:
                self.overreach = max(self.overreach, over)
                self.warnings.append(f"{label}: {s} foot out of reach by {over:.3f}")
            thigh = (knee - root).normalized()
            shin = (reached - knee).normalized()
            # Hip range, in the hips' frame.
            local = hips.transposed() @ thigh
            lift = math.degrees(math.atan2(local.dot(F), -local.dot(U)))
            out = math.degrees(math.asin(max(-1.0, min(1.0, local.dot(L) * (1 if s == "L" else -1)))))
            beyond = max(lift - HIP_FLEXION, -lift - HIP_EXTENSION, out - HIP_ABDUCTION, -out - HIP_ADDUCTION)
            if beyond > 4:
                self.warnings.append(f"{label}: {s} hip beyond its range by {beyond:.0f}")
            # The shin folds away from the side the knee points to.
            bend = -perp(side, thigh)
            hinge = thigh.cross(bend.normalized())
            delta[B + ul] = frame(thigh, bend) @ self.limb_rest[ul].transposed()
            delta[B + ll] = frame(shin, hinge.cross(shin)) @ self.limb_rest[ll].transposed()
            yaw, pitch = spec[s + "_foot"]
            delta[B + s + "_Foot"] = axis_rot(L, pitch) @ axis_rot(U, yaw)
            toes = delta[B + s + "_Foot"] @ F
            ankle_angle = math.degrees(toes.angle(-shin))
            beyond = max(ANKLE_RANGE[0] - ankle_angle, ankle_angle - ANKLE_RANGE[1])
            if beyond > 4:
                self.warnings.append(f"{label}: {s} ankle beyond its range by {beyond:.0f}")
            # Toes stay flat on the ground while the heel lifts.
            delta[B + s + "_ToeBase"] = axis_rot(L, min(pitch, 0.0)) @ axis_rot(U, yaw)
            heads[B + ll], heads[B + s + "_Foot"] = knee, reached

            # Fingers --------------------------------------------------
            curl = spec[s + "_curl"]
            curl_axis = self.hand_rest[s].col[0].cross(-U).normalized()
            for finger in ("Index", "Middle", "Ring", "Little", "Thumb"):
                previous = d_hand
                for k, share in ((1, 0.9), (2, 1.0), (3, 0.7)):
                    amount = curl * share * (0.35 if finger == "Thumb" else 1.0)
                    previous = previous @ axis_rot(curl_axis, amount)
                    delta[f"{B}{s}_{finger}{k}"] = previous

        # Remaining heads and rotations: carried by the parent.
        for n in self.order:
            p = self.parent[n]
            if n not in delta:
                delta[n] = delta[p] if p else Matrix.Identity(3)
            if n not in heads:
                heads[n] = heads[p] + delta[p] @ (self.rest[n].translation - self.rest[p].translation)
        return delta, heads

    def bake(self, action_name, keys):
        """Create an action with every bone keyed on every frame of the clip."""
        import bpy

        arm = self.arm
        arm.animation_data_create()
        action = bpy.data.actions.new(action_name)
        arm.animation_data.action = action
        keys = self.resolve(keys)
        first, last = keys[0][0], keys[-1][0]
        previous = {}
        self.swivel = {}
        self.roll = {}
        stats = {"wrist_bend": 0.0, "wrist_roll": 0.0, "step": 0.0, "step_bone": ""}
        self.report[action_name] = stats
        for frame_no in range(first, last + 1):
            spec = interpolate(keys, frame_no)
            delta, heads = self.solve(spec, f"{action_name}@{frame_no}")
            for bend, roll in self.wrist.values():
                stats["wrist_bend"] = max(stats["wrist_bend"], bend)
                stats["wrist_roll"] = max(stats["wrist_roll"], abs(roll))
            posed = {}
            for n in self.order:
                m = (delta[n] @ self.rest[n].to_3x3()).to_4x4()
                m.translation = heads[n]
                posed[n] = m
            for n in self.order:
                pb = arm.pose.bones[self.real[n]]
                rest = self.rest[n]
                p = self.parent[n]
                if p:
                    base = posed[p] @ self.rest[p].inverted() @ rest
                else:
                    base = rest
                basis = base.inverted() @ posed[n]
                q = basis.to_quaternion()
                # Same hemisphere as the previous frame: no flip in between.
                if n in previous and previous[n].dot(q) < 0:
                    q.negate()
                if n in previous:
                    step = math.degrees(previous[n].rotation_difference(q).angle)
                    if step > stats["step"]:
                        stats["step"], stats["step_bone"] = step, f"{n[len(B):]}@{frame_no}"
                previous[n] = q
                pb.rotation_mode = "QUATERNION"
                pb.rotation_quaternion = q
                pb.keyframe_insert("rotation_quaternion", frame=frame_no)
                if n == B + "C_Hips":
                    pb.location = basis.translation
                    pb.keyframe_insert("location", frame=frame_no)
        action.use_fake_user = True
        arm.animation_data.action = None
        return action


def add_sockets(arm):
    """Add the weapon sockets to the armature as bones (Y: axis, X: flat direction)."""
    import bpy

    bpy.context.view_layer.objects.active = arm
    rig = Rig(arm)
    hand = rig.hand_rest["R"]
    grip = rig.head("R_Hand") + rig.grip_offset("R", hand)
    sockets = {
        name: (parent, rig.head(parent) + offset * rig.scale, axis, flat)
        for name, (parent, offset, axis, flat) in SOCKETS.items()
    }
    sockets[GRIP_SOCKET] = ("R_Hand", grip, hand.col[1].copy(), hand.col[0].copy())
    bpy.ops.object.mode_set(mode="EDIT")
    to_local = arm.matrix_world.inverted()
    for name, (parent, origin, axis, flat) in sockets.items():
        axis = axis.normalized()
        flat = perp(flat, axis).normalized()
        bone = arm.data.edit_bones.new(name)
        bone.head = to_local @ origin
        bone.tail = to_local @ (origin + axis * 0.05)
        bone.align_roll(flat.cross(axis))
        bone.parent = arm.data.edit_bones[rig.real[B + parent]]
        bone.use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
