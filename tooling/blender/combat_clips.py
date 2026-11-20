"""
Combat clips of the shared animation library, keyed by script.

`add_clips(arm)` bakes them on the library armature with `pose_solver.py`
(targets interpolated and solved on every frame). `CLIPS` describes each
clip for the game (written next to the library as `humanoid.clips.json`):
which weapon it uses, when the hand takes it from its sheath, what follows.

Sword (the fighter; sheathed at the left hip):
- `sword_draw`: the left hand steadies the sheath, the right hand crosses
  to the hilt, pulls the blade out in an arc and settles in the guard;
- `sword_idle`: guard, right side forward, knees bent, blade up towards
  the foe, slow breathing and weight shift (loop);
- `sword_slash`: weight back and blade over the right shoulder, then a
  diagonal cut down to the left hip with a step in, and back to guard.

Staff (the wizard; slung on the back, head down):
- `staff_draw`: the right hand reaches over the shoulder, pulls the staff
  up and swings its head over to the front (it slides in the hand to be
  held by the middle), down to the guard;
- `staff_idle`: staff held by the middle, diagonal across the body (loop);
- `staff_strike`: the staff goes up behind the right shoulder, then its
  head comes straight down on a foe's head with a step in;
- `staff_cast`: gathers, raises the staff high, holds the incantation
  with a slow sway, comes back to the guard.

Both, from each weapon's guard: `<weapon>_hit` (shock, the trunk thrown
back then the head, half a step back, recovery) and `<weapon>_defeat`
(shock, stagger, the legs give way, sits down hard, falls on the back,
arms and legs settle, stays down).
"""
from mathutils import Vector

from pose_solver import GRIP_SOCKET, P, Rig, V, mix, pose  # noqa: F401

FPS = 24

# Distance from the staff's middle to where the hand takes it on the back
# (towards its foot, above the right shoulder).
STAFF_GRAB = 0.26


def neutral():
    """Standing at ease, arms down."""
    return {
        "hips_pos": Vector((0, 0, 0)),
        "hips": (0, 0, 0),
        "spine": (0, 0, 0),
        "chest": (0, 0, 0),
        "head": (0, 0, 0),
        "R_grip": P(-0.105, 0.02, 0.585),
        "R_axis": V(0, 1, 0),
        "R_free": 1.0,
        "R_pole": V(-0.5, -0.6, -0.6),
        "L_grip": P(0.109, 0.02, 0.585),
        "L_axis": V(0, 1, 0),
        "L_free": 1.0,
        "L_pole": V(0.5, -0.6, -0.6),
        "R_ankle": P(-0.096, -0.028, 0.068),
        "L_ankle": P(0.1, -0.028, 0.068),
        "R_foot": (-6, 0),
        "L_foot": (6, 0),
        "R_knee": V(-0.12, 1, 0.1),
        "L_knee": V(0.12, 1, 0.1),
        "R_curl": 25.0,
        "L_curl": 25.0,
    }


# Sword ---------------------------------------------------------------


def sword_guard(breath=0.0, shift=0.0):
    """Guard: right side forward, knees bent, blade up towards the foe."""
    return pose(
        neutral(),
        hips_pos=Vector((0.004 * shift, 0.01 - 0.012 * shift, -0.06 - 0.01 * breath)),
        hips=(25, 4, 0),
        spine=(4, 3 + breath, 0),
        chest=(6, 4 + 2 * breath, 0),
        head=(-30, -2 - breath, 0),
        R_grip=P(-0.095, 0.16 + 0.012 * shift, 0.63 - 0.008 * breath),
        R_axis=V(0.1, 0.62 - 0.05 * breath, 0.78),
        R_free=0.0,
        R_pole=V(-0.25, -0.6, -0.75),
        L_grip=P(0.095, 0.075, 0.615 - 0.006 * breath),
        L_pole=V(0.6, -0.4, -0.7),
        R_ankle=P(-0.075, 0.13, 0.068),
        L_ankle=P(0.105, -0.14, 0.068),
        R_foot=(-8, 0),
        L_foot=(38, 0),
        R_curl=80.0,
        L_curl=60.0,
    )


def sword_clips(rig):
    g = sword_guard()
    n = neutral()

    # Draw.
    # Lean forward and turn to the left to bring the right hand to the hilt.
    ready = pose(
        mix(n, g, 0.25),
        hips=(10, 5, 0),
        spine=(5, 4, 0),
        chest=(8, 5, 0),
        head=(0, 8, 0),
        R_grip=P(-0.02, 0.2, 0.7),
        R_axis=V(0.2, -0.5, -0.8),
        R_free=0.6,
        R_pole=V(-0.8, 0.2, -0.5),
        R_curl=30.0,
        L_grip=P(0.13, 0.05, 0.62),
        L_curl=50.0,
    )
    grab = pose(
        mix(n, g, 0.3),
        hips_pos=Vector((0, 0.025, -0.035)),
        hips=(14, 10, 0),
        spine=(6, 7, 0),
        chest=(10, 9, 0),
        head=(4, 10, 0),
        R_grab=("Socket_Sheath_Sword", 0.0),
        R_pole=V(-0.8, 0.4, -0.4),
        R_curl=80.0,
        L_grip=P(0.135, 0.02, 0.6),
        L_curl=55.0,
    )
    # The blade leaves the sheath along its own line, palm down; it sweeps
    # round by the left to point forward, then rises to the guard as the
    # forearm turns back to neutral and the trunk straightens.
    clear = pose(
        mix(n, g, 0.45),
        hips=(18, 7, 0),
        spine=(5, 5, 0),
        chest=(8, 5, 0),
        head=(-4, 6, 0),
        R_grip=P(0.0, 0.2, 0.75),
        R_axis=V(0.5, -0.4, -0.75),
        R_free=0.0,
        R_pole=V(-0.9, 0.1, -0.3),
        R_curl=80.0,
        L_grip=P(0.13, 0.03, 0.61),
    )
    across = pose(
        mix(n, g, 0.7),
        hips=(22, 5, 0),
        head=(-16, 2, 0),
        R_grip=P(-0.05, 0.23, 0.72),
        R_axis=V(0.9, 0.25, -0.3),
        R_free=0.0,
        R_pole=V(-0.9, 0.0, -0.3),
        R_curl=80.0,
    )
    rig.bake(
        "sword_draw",
        [(1, n), (6, ready), (10, grab), (12, grab), (17, clear), (21, across), (28, g), (33, g)],
    )

    # Idle.
    rig.bake(
        "sword_idle",
        [
            (1, sword_guard()),
            (13, sword_guard(breath=1.0, shift=1.0)),
            (25, sword_guard(breath=0.2, shift=0.0)),
            (37, sword_guard(breath=1.0, shift=-1.0)),
            (49, sword_guard()),
        ],
    )

    # Slash: the forearm turns palm down through the cut, so the blade
    # ends across the body, pointing left and down.
    windup = pose(
        g,
        hips_pos=Vector((0, 0.04, -0.05)),
        hips=(4, -2, 0),
        spine=(-4, -3, 0),
        chest=(-12, -6, 0),
        head=(-10, 0, 0),
        R_grip=P(-0.12, -0.01, 0.95),
        R_axis=V(-0.15, -0.6, 0.78),
        R_pole=V(-0.9, -0.2, 0.2),
        L_grip=P(0.07, 0.17, 0.7),
        L_curl=40.0,
    )
    mid = pose(
        g,
        hips_pos=Vector((0, -0.01, -0.06)),
        hips=(30, 6, 0),
        spine=(6, 4, 0),
        chest=(10, 6, 0),
        head=(-36, 0, 0),
        R_grip=P(-0.04, 0.2, 0.86),
        R_axis=V(0.35, 0.6, 0.72),
        R_pole=V(-0.8, -0.2, -0.4),
        R_ankle=P(-0.07, 0.19, 0.09),
        L_grip=P(0.12, 0.03, 0.64),
    )
    cut = pose(
        g,
        hips_pos=Vector((0.01, -0.05, -0.085)),
        hips=(44, 12, 0),
        spine=(8, 6, 0),
        chest=(14, 8, 0),
        head=(-50, -4, 0),
        R_grip=P(0.06, 0.22, 0.62),
        R_axis=V(0.85, 0.4, -0.35),
        R_pole=V(-0.7, -0.3, -0.3),
        R_ankle=P(-0.065, 0.24, 0.068),
        L_grip=P(0.13, -0.05, 0.6),
        L_pole=V(0.6, -0.7, -0.4),
    )
    through = pose(
        cut,
        hips=(50, 12, 0),
        R_grip=P(0.1, 0.16, 0.58),
        R_axis=V(0.95, 0.0, -0.3),
    )
    recover = pose(
        mix(through, g, 0.6),
        R_grip=P(0.0, 0.2, 0.62),
        R_axis=V(0.6, 0.6, 0.3),
        R_ankle=P(-0.07, 0.18, 0.085),
    )
    rig.bake(
        "sword_slash",
        [(1, g), (8, windup), (10, windup), (13, mid), (15, cut), (18, through), (21, through), (30, recover), (38, g)],
    )
    hit_and_defeat(rig, "sword", g, on_ground=V(-0.55, -0.8, 0.03))


# Staff ---------------------------------------------------------------


def staff_guard(breath=0.0):
    """Staff held by the middle in the right hand, diagonal across the body."""
    return pose(
        neutral(),
        hips_pos=Vector((0, 0.005, -0.025 - 0.006 * breath)),
        hips=(-10, 2, 0),
        spine=(-2, 1 + breath, 0),
        chest=(-2, -2 + 2 * breath, 0),
        head=(12, 0 - breath, 0),
        R_grip=P(-0.085, 0.15, 0.64 - 0.006 * breath),
        R_axis=V(0.5 + 0.03 * breath, 0.22, 0.84),
        R_free=0.0,
        R_pole=V(-0.7, -0.3, -0.6),
        L_grip=P(0.12, 0.13, 0.66 - 0.004 * breath),
        L_pole=V(0.6, -0.4, -0.7),
        R_ankle=P(-0.085, -0.07, 0.068),
        L_ankle=P(0.085, 0.06, 0.068),
        R_foot=(-22, 0),
        L_foot=(4, 0),
        R_curl=80.0,
        L_curl=30.0,
    )


def staff_clips(rig):
    g = staff_guard()
    n = neutral()

    # Draw: over the right shoulder, like a blade worn on the back.
    lift_elbow = pose(
        mix(n, g, 0.2),
        hips=(-4, 3, 0),
        chest=(-4, 4, 0),
        head=(-12, 6, 0),
        R_grip=P(-0.1, 0.1, 0.86),
        R_axis=V(0.2, -0.6, -0.4),
        R_free=0.6,
        R_pole=V(-0.7, 0.5, 0.3),
        R_curl=30.0,
    )
    grab = pose(
        mix(n, g, 0.25),
        hips=(-6, 4, 0),
        chest=(-6, 5, 0),
        head=(-20, 8, 0),
        R_grab=("Socket_Sheath_Staff", STAFF_GRAB),
        R_pole=V(-0.6, 0.6, 0.5),
        R_curl=80.0,
    )
    pull = pose(
        mix(n, g, 0.4),
        hips=(-6, 2, 0),
        chest=(-4, 0, 0),
        head=(-8, -2, 0),
        R_grip=P(-0.16, -0.09, 1.04),
        R_axis=V(0.42, -0.25, -0.87),
        R_free=0.0,
        R_pole=V(-0.8, 0.4, 0.2),
        R_curl=80.0,
    )
    over = pose(
        mix(n, g, 0.6),
        chest=(0, -2, 0),
        head=(4, -4, 0),
        R_grip=P(-0.13, 0.08, 1.02),
        R_axis=V(0.15, -0.9, 0.35),
        R_free=0.0,
        R_pole=V(-0.9, 0.1, -0.2),
        R_curl=80.0,
    )
    front = pose(
        mix(n, g, 0.85),
        R_grip=P(-0.1, 0.2, 0.86),
        R_axis=V(0.25, -0.1, 0.96),
        R_free=0.0,
        R_pole=V(-0.8, -0.2, -0.5),
        R_curl=80.0,
        L_grip=P(0.03, 0.2, 0.74),
        L_curl=45.0,
    )
    settle = pose(g, R_grip=P(-0.085, 0.16, 0.62), L_grip=P(0.07, 0.17, 0.68))
    rig.bake(
        "staff_draw",
        [(1, n), (6, lift_elbow), (11, grab), (13, grab), (18, pull), (23, over), (29, front), (35, settle), (40, g)],
    )

    # Idle.
    rig.bake(
        "staff_idle",
        [(1, staff_guard()), (19, staff_guard(breath=1.0)), (37, staff_guard())],
    )

    # Strike, one hand: the staff goes up behind the right shoulder, then
    # comes straight down, its head on a foe's head; it stays on the right of
    # the body so its lower half passes beside the hip.
    raised = pose(
        g,
        hips_pos=Vector((0, 0.03, -0.02)),
        hips=(-2, -3, 0),
        spine=(-2, -4, 0),
        chest=(-8, -8, 0),
        head=(6, 4, 0),
        R_grip=P(-0.13, 0.0, 0.97),
        R_axis=V(-0.1, -0.7, 0.7),
        R_pole=V(-0.9, 0.0, 0.3),
        L_grip=P(0.1, 0.19, 0.74),
        L_curl=15.0,
    )
    falling = pose(
        g,
        hips_pos=Vector((0, -0.02, -0.04)),
        hips=(6, 6, 0),
        spine=(2, 3, 0),
        chest=(4, 4, 0),
        head=(-6, -6, 0),
        R_grip=P(-0.14, 0.17, 0.92),
        R_axis=V(0.0, 0.25, 0.97),
        R_pole=V(-0.8, -0.2, -0.3),
        L_ankle=P(0.085, 0.14, 0.1),
        L_grip=P(0.13, 0.08, 0.66),
    )
    impact = pose(
        g,
        hips_pos=Vector((0, -0.06, -0.07)),
        hips=(12, 12, 0),
        spine=(3, 6, 0),
        chest=(5, 8, 0),
        head=(-14, -10, 0),
        R_grip=P(-0.14, 0.23, 0.66),
        R_axis=V(0.0, 0.75, 0.66),
        R_pole=V(-0.6, -0.4, -0.6),
        L_ankle=P(0.085, 0.19, 0.068),
        L_grip=P(0.14, 0.0, 0.62),
        L_pole=V(0.6, -0.7, -0.3),
    )
    rebound = pose(impact, R_grip=P(-0.14, 0.22, 0.69), R_axis=V(0.0, 0.66, 0.75))
    rig.bake(
        "staff_strike",
        [(1, g), (9, raised), (12, raised), (15, falling), (17, impact), (19, rebound), (23, rebound), (32, mix(rebound, g, 0.7)), (40, g)],
    )

    # Cast.
    gather = pose(
        g,
        hips_pos=Vector((0, 0.01, -0.05)),
        spine=(-2, 5, 0),
        chest=(-2, 6, 0),
        head=(10, 10, 0),
        R_grip=P(-0.07, 0.14, 0.7),
        R_axis=V(0.2, 0.1, 0.97),
        L_grip=P(0.07, 0.15, 0.68),
        L_curl=40.0,
    )

    def raised_cast(sway=0.0):
        return pose(
            g,
            hips_pos=Vector((0.004 * sway, 0.0, -0.005)),
            hips=(-6, -2, 0),
            spine=(0, -3, 0),
            chest=(2, -8, 0),
            head=(6, -12, 0),
            R_grip=P(-0.11 + 0.01 * sway, 0.15, 0.99),
            R_axis=V(0.06 * sway, 0.1, 1.0),
            R_pole=V(-0.8, 0.1, -0.5),
            L_grip=P(0.2, 0.08 + 0.01 * sway, 0.68),
            L_axis=V(0, 0.3, 1),
            L_free=0.5,
            L_pole=V(0.4, -0.7, -0.5),
            L_curl=8.0,
        )

    rig.bake(
        "staff_cast",
        [(1, g), (8, gather), (10, gather), (18, raised_cast()), (30, raised_cast(1)), (42, raised_cast(-1)), (54, raised_cast(1)), (62, raised_cast()), (72, mix(raised_cast(), g, 0.8)), (80, g)],
    )
    hit_and_defeat(rig, "staff", g, on_ground=V(-0.55, -0.8, 0.03))


# Shared --------------------------------------------------------------


def hit_and_defeat(rig, prefix, g, on_ground):
    """`<prefix>_hit` and `<prefix>_defeat` from the guard `g`."""
    back_foot = "L" if g["L_ankle"].y > g["R_ankle"].y else "R"
    front_foot = "R" if back_foot == "L" else "L"
    front, back = g[front_foot + "_ankle"], g[back_foot + "_ankle"]

    def moved(v, left=0.0, forward=0.0, up=0.0):
        return v + V(left, forward, up)

    hy, hp, hr = g["hips"]
    # The trunk is thrown back first; the head lags (chin down), then whips back.
    shock = pose(
        g,
        hips_pos=moved(g["hips_pos"], forward=-0.03, up=0.01),
        hips=(hy, hp - 6, hr),
        spine=(g["spine"][0], -8, 0),
        chest=(g["chest"][0], -12, 0),
        head=(g["head"][0], 12, 0),
        R_grip=moved(g["R_grip"], left=-0.02, forward=0.0, up=0.04),
        L_grip=moved(g["L_grip"], left=0.03, forward=0.02, up=0.04),
        L_curl=20.0,
    )
    recoil = pose(
        shock,
        hips_pos=moved(g["hips_pos"], forward=-0.07, up=0.0),
        hips=(hy, hp - 10, hr),
        chest=(g["chest"][0], -16, 0),
        head=(g["head"][0], -16, 0),
        R_grip=moved(g["R_grip"], left=-0.05, forward=-0.08, up=0.06),
        L_grip=moved(g["L_grip"], left=0.06, forward=-0.06, up=0.08),
    )
    recoil[front_foot + "_ankle"] = moved(front, forward=-0.06, up=0.035)
    absorb = pose(
        g,
        hips_pos=moved(g["hips_pos"], forward=-0.1, up=-0.03),
        hips=(hy, hp + 4, hr),
        spine=(g["spine"][0], 6, 0),
        chest=(g["chest"][0], 6, 0),
        head=(g["head"][0], 4, 0),
        R_grip=moved(g["R_grip"], forward=-0.08, up=-0.03),
        L_grip=moved(g["L_grip"], forward=-0.08, up=-0.02),
    )
    absorb[front_foot + "_ankle"] = moved(front, forward=-0.13)
    absorb[back_foot + "_ankle"] = moved(back, forward=-0.03)
    step_in = pose(mix(absorb, g, 0.6))
    step_in[front_foot + "_ankle"] = moved(front, forward=-0.05, up=0.03)
    rig.bake(
        f"{prefix}_hit",
        [(1, g), (4, shock), (8, recoil), (13, absorb), (17, absorb), (23, step_in), (29, g), (33, g)],
    )

    # Defeat.
    hard = pose(shock, chest=(g["chest"][0], -16, 0), hips_pos=moved(g["hips_pos"], forward=-0.04, up=0.01))
    reel = pose(
        recoil,
        hips_pos=moved(g["hips_pos"], forward=-0.1, up=0.0),
        hips=(hy * 0.5, -12, 0),
        chest=(g["chest"][0] * 0.5, -18, 0),
        head=(0, -20, 0),
        R_grip=moved(g["R_grip"], left=-0.08, forward=-0.14, up=0.1),
        L_grip=moved(g["L_grip"], left=0.08, forward=-0.14, up=0.12),
        R_curl=60.0,
    )
    reel[front_foot + "_ankle"] = moved(front, forward=-0.16)
    reel[back_foot + "_ankle"] = moved(back, forward=-0.02)
    feet_r, feet_l = P(-0.1, -0.03, 0.068), P(0.11, -0.13, 0.068)
    buckle = pose(
        g,
        hips_pos=Vector((0, 0.17, -0.25)),
        hips=(0, -8, 0),
        spine=(0, 8, 0),
        chest=(0, 10, 0),
        head=(0, 14, 0),
        R_grip=P(-0.2, -0.05, 0.62),
        R_axis=V(-0.3, 0.6, 0.6),
        R_pole=V(-0.8, -0.4, -0.3),
        L_grip=P(0.22, -0.06, 0.64),
        L_pole=V(0.8, -0.4, -0.3),
        R_ankle=feet_r,
        L_ankle=feet_l,
        R_foot=(-12, 0),
        L_foot=(14, 0),
        R_knee=V(-0.3, 1, 0.2),
        L_knee=V(0.3, 1, 0.2),
        R_curl=45.0,
        L_curl=20.0,
    )
    sit = pose(
        buckle,
        hips_pos=Vector((0, 0.3, -0.515)),
        hips=(0, -24, 0),
        spine=(0, 10, 0),
        chest=(0, 12, 0),
        head=(0, 10, 0),
        R_grip=P(-0.2, -0.22, 0.25),
        L_grip=P(0.2, -0.24, 0.27),
        R_pole=V(-0.8, -0.5, 0.2),
        L_pole=V(0.8, -0.5, 0.2),
        R_foot=(-14, -18),
        L_foot=(16, -18),
    )
    tip = pose(
        sit,
        hips_pos=Vector((0, 0.3, -0.52)),
        hips=(0, -55, 0),
        spine=(0, 4, 0),
        chest=(0, 4, 0),
        head=(0, 16, 0),
        R_grip=P(-0.24, -0.33, 0.2),
        L_grip=P(0.24, -0.36, 0.22),
        R_ankle=P(-0.11, 0.06, 0.07),
        L_ankle=P(0.12, -0.02, 0.07),
        R_foot=(-16, -40),
        L_foot=(18, -40),
    )
    flat = pose(
        tip,
        hips_pos=Vector((0, 0.3, -0.527)),
        hips=(0, -88, 0),
        spine=(0, 0, 0),
        chest=(0, -2, 0),
        head=(24, -6, 0),
        R_grip=P(-0.25, -0.4, 0.035),
        R_axis=on_ground,
        R_free=0.0,
        R_pole=V(-0.8, -0.6, 0.0),
        L_grip=P(0.24, -0.44, 0.03),
        L_free=1.0,
        L_pole=V(0.8, -0.6, 0.0),
        R_ankle=P(-0.12, 0.2, 0.05),
        L_ankle=P(0.13, 0.15, 0.05),
        R_foot=(-25, -75),
        L_foot=(28, -72),
        R_knee=V(-0.25, 1, 0.1),
        L_knee=V(0.3, 1, 0.1),
        R_curl=35.0,
        L_curl=20.0,
    )
    bounce = pose(
        flat,
        chest=(0, 4, 0),
        head=(24, 6, 0),
        R_grip=flat["R_grip"] + V(0, 0, 0.03),
        L_grip=flat["L_grip"] + V(0, 0, 0.035),
    )
    rest = pose(flat, R_ankle=P(-0.13, 0.22, 0.045), L_ankle=P(0.14, 0.19, 0.045), R_foot=(-30, -80), L_foot=(34, -78))
    rig.bake(
        f"{prefix}_defeat",
        [(1, g), (4, hard), (9, reel), (14, buckle), (19, sit), (21, sit), (25, tip), (28, flat), (31, bounce), (35, rest), (50, rest)],
    )


# What the game needs to know about each clip (seconds). `weapon`: the clip
# is played weapon in hand (a draw first if needed). `grab`: when the right
# hand takes the weapon from its sheath; `settle`: the period in which the
# weapon comes to its exact place in the hand (the staff slides to its
# middle). `then`: clip played next. `hold`: stays on its last frame.
# `foot_ik`: feet planted on the ground by the game (not when lying).
def seconds(frame_no):
    return round((frame_no - 1) / FPS, 4)


CLIPS = {
    "sword_draw": {"weapon": "sword", "draw": True, "grab": seconds(10), "settle": [seconds(12), seconds(17)], "then": "sword_idle"},
    "sword_idle": {"weapon": "sword", "loop": True},
    "sword_slash": {"weapon": "sword", "then": "sword_idle"},
    "sword_hit": {"weapon": "sword", "then": "sword_idle"},
    "sword_defeat": {"weapon": "sword", "hold": True, "foot_ik": False},
    "staff_draw": {"weapon": "staff", "draw": True, "grab": seconds(11), "settle": [seconds(27), seconds(37)], "then": "staff_idle"},
    "staff_idle": {"weapon": "staff", "loop": True},
    "staff_strike": {"weapon": "staff", "then": "staff_idle"},
    "staff_cast": {"weapon": "staff", "then": "staff_idle", "cast": [seconds(16), seconds(64)]},
    "staff_hit": {"weapon": "staff", "then": "staff_idle"},
    "staff_defeat": {"weapon": "staff", "hold": True, "foot_ik": False},
}


def add_clips(arm):
    """Bake every combat clip on `arm` (rest pose, sockets already added)."""
    rig = Rig(arm)
    sword_clips(rig)
    staff_clips(rig)
    worst = {}
    for w in rig.warnings:
        label, rest = w.split(": ", 1)
        clip, frame_no = label.split("@")
        what, amount = rest.rsplit(" by ", 1)
        key = (clip, what)
        if float(amount) > worst.get(key, (0.0, 0))[0]:
            worst[key] = (float(amount), frame_no)
    for (clip, what), (amount, frame_no) in sorted(worst.items()):
        print(f"combat_clips warning: {clip}: {what} by {amount:g} (worst at frame {frame_no})")
    for clip, r in rig.report.items():
        print(
            f"combat_clips report: {clip}: wrist bend {r['wrist_bend']:.0f} deg, wrist roll {r['wrist_roll']:.0f} deg, "
            f"largest step {r['step']:.0f} deg/frame ({r['step_bone']})"
        )
    return rig
