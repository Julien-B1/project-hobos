/**
 * Spring bones: cloth and hair that swing, lag and fall on their own.
 *
 * Layer: render. The model carries chains of extra bones whose names start
 * with {@link SPRING_PREFIX} (added by a Blender script, see
 * `tooling/blender/wizard.py`); the animation clips leave them at rest.
 * Every frame, after the mixer and the foot IK, each chain is simulated
 * root to tip (the usual "spring bone" scheme of VRM avatars):
 *
 * - each bone's tip is a point mass with inertia (velocity kept from the
 *   previous step, damped by `drag`), pulled back towards its rest
 *   direction (`stiffness`) and down (`gravity`);
 * - the tip is put back at the bone's length from the bone's head, then
 *   pushed out of the body's colliders (capsules on the legs and the
 *   spine), so the skirt moves aside when a leg swings through it;
 * - the bone is turned towards the tip, and its children follow.
 *
 * Steps are fixed ({@link STEP}, at most {@link MAX_STEPS} per frame) so the
 * motion does not depend on the frame rate. Positions are in world units:
 * the character's moves (walking, turning) swing the chains too.
 */
import { Bone, type Object3D, Quaternion, Vector3 } from 'three'

/** Name prefix of the simulated bones. */
export const SPRING_PREFIX = 'Spring_'

/** Fixed simulation step, in seconds. */
const STEP = 1 / 60

/** Most steps per frame (a long frame is partly skipped, not exploded). */
const MAX_STEPS = 4

/** How a family of chains moves (chains are matched by name). */
export interface SpringSettings {
  /** Pull towards the rest direction: tip displacement per second, in bone lengths. */
  readonly stiffness: number
  /** Pull downwards: tip displacement per second, in world units. */
  readonly gravity: number
  /** Share of the velocity lost per step, 0 (none) to 1 (all). */
  readonly drag: number
  /** Radius of each bone's tip against the colliders, in model units. */
  readonly radius: number
}

/** Settings per chain family: the first matching name fragment wins. */
export interface SpringProfile {
  readonly chains: readonly (readonly [fragment: string, settings: SpringSettings])[]
  /** Capsules between two bones (by name fragment), radius in model units. */
  readonly colliders: readonly (readonly [from: string, to: string, radius: number])[]
}

/** Default chain settings: skirt, sleeves and long hair. */
export const DEFAULT_SPRING_PROFILE: SpringProfile = {
  chains: [
    ['Skirt', { stiffness: 1.2, gravity: 0.6, drag: 0.35, radius: 0.025 }],
    ['Sleeve', { stiffness: 0.6, gravity: 0.8, drag: 0.4, radius: 0.01 }],
    ['Hair', { stiffness: 0.8, gravity: 0.5, drag: 0.4, radius: 0.015 }],
  ],
  colliders: [
    ['L_UpperLeg', 'L_LowerLeg', 0.065],
    ['L_LowerLeg', 'L_Foot', 0.05],
    ['R_UpperLeg', 'R_LowerLeg', 0.065],
    ['R_LowerLeg', 'R_Foot', 0.05],
    ['C_Spine', 'C_Neck', 0.06],
    // Forearms and hands: the skirt moves aside for them too.
    ['L_LowerArm', 'L_Hand', 0.03],
    ['L_Hand', 'L_Middle3', 0.03],
    ['R_LowerArm', 'R_Hand', 0.03],
    ['R_Hand', 'R_Middle3', 0.03],
  ],
}

/** One simulated bone. */
interface Joint {
  readonly bone: Bone
  /** Child bone whose head is this bone's tip. */
  readonly child: Bone
  /** Rest rotation, relative to the parent. */
  readonly rest: Quaternion
  /** Tip direction in the bone's own space (unit). */
  readonly axis: Vector3
  /** Bone length, in model units (scaled to world each step). */
  readonly length: number
  readonly settings: SpringSettings
  /** Tip now and one step ago, in world units. */
  readonly tip: Vector3
  readonly previous: Vector3
}

/** A capsule of the body, between two bones' heads. */
interface Collider {
  readonly from: Object3D
  readonly to: Object3D
  readonly radius: number
}

const HEAD = new Vector3()
const NEXT = new Vector3()
const REST_DIR = new Vector3()
const DIR = new Vector3()
const A = new Vector3()
const B = new Vector3()
const CLOSEST = new Vector3()
const PARENT_ROT = new Quaternion()
const WORLD_ROT = new Quaternion()
const TURN = new Quaternion()
const SCALE = new Vector3()
const AWAY = new Vector3()
const AB = new Vector3()

/**
 * Closest point to `p` on the segment [a, b], written to `out`.
 *
 * @returns `out`.
 */
export function closestOnSegment(p: Vector3, a: Vector3, b: Vector3, out: Vector3): Vector3 {
  const ab = AB.subVectors(b, a)
  const len2 = ab.lengthSq()
  const t = len2 > 1e-12 ? Math.min(1, Math.max(0, out.subVectors(p, a).dot(ab) / len2)) : 0
  return out.copy(a).addScaledVector(ab, t)
}

/**
 * Push `p` out of the capsule [a, b] of radius `r`, in place.
 *
 * @returns Whether `p` was inside.
 */
export function pushOutOfCapsule(p: Vector3, a: Vector3, b: Vector3, r: number): boolean {
  closestOnSegment(p, a, b, CLOSEST)
  const away = AWAY.subVectors(p, CLOSEST)
  const d = away.length()
  if (d >= r) return false
  // On the axis itself: push out sideways, any direction.
  if (d < 1e-9) away.set(1, 0, 0)
  else away.divideScalar(d)
  p.copy(CLOSEST).addScaledVector(away, r)
  return true
}

/** Spring bone chains of one model. */
export class SpringBones {
  private readonly joints: Joint[] = []
  private readonly colliders: Collider[] = []
  private leftover = 0
  private ready = false

  /**
   * @param model The skinned model, at its rest pose (bones found by name).
   * @param profile Chain settings and body colliders.
   */
  constructor(
    private readonly model: Object3D,
    profile: SpringProfile = DEFAULT_SPRING_PROFILE,
  ) {
    const bones: Bone[] = []
    model.traverse((o) => {
      if (o instanceof Bone) bones.push(o)
    })
    for (const bone of bones) {
      if (!bone.name.startsWith(SPRING_PREFIX) || bone.name.endsWith('_end')) continue
      const child = bone.children.find((c): c is Bone => c instanceof Bone)
      const settings = profile.chains.find(([f]) => bone.name.includes(f))?.[1]
      if (!child || !settings) continue
      const length = child.position.length()
      if (length < 1e-6) continue
      this.joints.push({
        bone,
        child,
        rest: bone.quaternion.clone(),
        axis: child.position.clone().divideScalar(length),
        length,
        settings,
        tip: new Vector3(),
        previous: new Vector3(),
      })
    }
    // Root to tip: a parent is always simulated before its children.
    const depth = (o: Object3D): number => (o.parent ? depth(o.parent) + 1 : 0)
    this.joints.sort((a, b) => depth(a.bone) - depth(b.bone))
    const find = (fragment: string): Bone | undefined =>
      bones.find((b) => b.name.endsWith(fragment))
    for (const [from, to, radius] of profile.colliders) {
      const a = find(from)
      const b = find(to)
      if (a && b) this.colliders.push({ from: a, to: b, radius })
    }
  }

  /** Number of simulated bones (0: the model has none). */
  get count(): number {
    return this.joints.length
  }

  /** Forget the motion: the chains restart at rest (after a teleport). */
  reset(): void {
    this.ready = false
  }

  /**
   * Advance by `dt` seconds. Call after the pose of the frame is final
   * (mixer, foot IK) and the model's world matrices are up to date.
   */
  update(dt: number): void {
    if (this.joints.length === 0) return
    this.model.getWorldScale(SCALE)
    const scale = SCALE.x
    if (!this.ready) {
      this.restart()
      this.ready = true
      return
    }
    this.leftover = Math.min(this.leftover + dt, STEP * MAX_STEPS)
    let steps = 0
    while (this.leftover >= STEP) {
      this.leftover -= STEP
      steps++
    }
    if (steps === 0) {
      // No step: still re-aim the bones, the body moved under them.
      this.aimAll(scale)
      return
    }
    for (let s = 0; s < steps; s++) this.step(scale)
  }

  /** Put every tip at its rest place. */
  private restart(): void {
    for (const j of this.joints) {
      j.bone.quaternion.copy(j.rest)
      j.bone.updateMatrixWorld(true)
      j.child.getWorldPosition(j.tip)
      j.previous.copy(j.tip)
    }
  }

  /** One fixed step for every joint, root to tip. */
  private step(scale: number): void {
    for (const j of this.joints) {
      const { settings } = j
      this.restDirection(j)
      j.bone.getWorldPosition(HEAD)
      const length = j.length * scale
      // Verlet: inertia, pull to rest, gravity.
      NEXT.copy(j.tip)
        .addScaledVector(A.subVectors(j.tip, j.previous), 1 - settings.drag)
        .addScaledVector(REST_DIR, settings.stiffness * length * STEP)
      NEXT.y -= settings.gravity * STEP
      // Keep the length, then leave the body.
      B.subVectors(NEXT, HEAD).setLength(length)
      NEXT.copy(HEAD).add(B)
      for (const c of this.colliders) {
        c.from.getWorldPosition(A)
        c.to.getWorldPosition(B)
        if (pushOutOfCapsule(NEXT, A, B, (c.radius + settings.radius) * scale)) {
          B.subVectors(NEXT, HEAD).setLength(length)
          NEXT.copy(HEAD).add(B)
        }
      }
      j.previous.copy(j.tip)
      j.tip.copy(NEXT)
      this.aim(j)
    }
  }

  /** Re-aim every bone at its current tip (no simulation). */
  private aimAll(scale: number): void {
    for (const j of this.joints) {
      this.restDirection(j)
      j.bone.getWorldPosition(HEAD)
      B.subVectors(j.tip, HEAD).setLength(j.length * scale)
      j.tip.copy(HEAD).add(B)
      this.aim(j)
    }
  }

  /** World direction of the bone at rest under its parent, into REST_DIR (and PARENT_ROT). */
  private restDirection(j: Joint): void {
    const parent = j.bone.parent
    if (parent) parent.getWorldQuaternion(PARENT_ROT)
    else PARENT_ROT.identity()
    WORLD_ROT.multiplyQuaternions(PARENT_ROT, j.rest)
    REST_DIR.copy(j.axis).applyQuaternion(WORLD_ROT)
  }

  /** Turn the bone (from rest, see restDirection) so its tip points at `j.tip`. */
  private aim(j: Joint): void {
    DIR.subVectors(j.tip, HEAD).normalize()
    TURN.setFromUnitVectors(REST_DIR, DIR)
    WORLD_ROT.premultiply(TURN)
    j.bone.quaternion.copy(PARENT_ROT.invert().multiply(WORLD_ROT))
    j.bone.updateMatrixWorld(true)
  }
}
