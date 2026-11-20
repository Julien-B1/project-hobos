/**
 * Foot IK: plants an animated character's feet on uneven ground.
 *
 * Layer: render. Runs after the animation mixer, every frame, on the pose
 * it produced (the mixer rewrites the bones each frame, so nothing
 * accumulates). The clips are authored on flat ground; per foot:
 * 1. the ground under the animated foot is probed; the foot should stay
 *    as high above it as the clip holds it above the character's origin
 *    (the ground under the body's centre);
 * 2. the body is lowered by the largest drop any foot needs (a foot on
 *    lower ground could not reach it with a straight leg), smoothed over
 *    time;
 * 3. each leg (thigh, shin, foot) is bent with an analytic two-bone IK so
 *    its ankle lands on its target, the knee keeping its bending plane;
 * 4. a planted foot is turned to lie along the ground's slope.
 * Cost: two short ground probes and a few dozen vector operations per
 * frame.
 */
import { Quaternion, Vector3, type Object3D } from 'three/webgpu'

/** Ground under a point: world height and unit normal, or null when none. */
export type FootGroundProbe = (
  x: number,
  z: number,
  nearY: number,
) => { y: number; normal: Vector3 } | null

/** Largest drop of the body, in world units (beyond that the legs stay as animated). */
const MAX_DROP = 0.45

/** How fast the body's drop follows its target (1/s). */
const DROP_RATE = 12

/** How fast the feet lock onto the stance when the character stops (1/s). */
const LOCK_RATE = 6

/**
 * Rise of the ankle above its standing height beyond which a foot counts as
 * lifted (not turned to the slope), world units.
 */
const PLANTED_LIFT = 0.12

/** One leg's bones, hip to ankle. */
interface Leg {
  readonly thigh: Object3D
  readonly shin: Object3D
  readonly foot: Object3D
  /** Ball of the foot (toe base), to keep the front of the foot above ground. */
  readonly toe: Object3D | null
}

const A = new Vector3()
const B = new Vector3()
const C = new Vector3()
const U = new Vector3()
const V = new Vector3()
const AXIS = new Vector3()
const Q = new Quaternion()
const PARENT = new Quaternion()
const WORLD = new Quaternion()
const UP = new Vector3(0, 1, 0)
const S = new Vector3()
const BODY = new Quaternion()

/**
 * Name fragments of each side's leg bones: Mixamo (`mixamorig:LeftUpLeg`)
 * and VRM-style (`J_Bip_L_UpperLeg`, Tripo's other export).
 */
const LEG_SIDES = [
  ['Left', 'L'],
  ['Right', 'R'],
] as const

/** Foot placement for one rigged character (Mixamo or VRM-style bone names). */
export class FootIk {
  private readonly legs: readonly Leg[]
  /** Current body drop, world units (negative: lowered). */
  private drop = 0
  /** Blend of the IK, 0 (animation only) to 1. */
  private weight = 1
  /** Blend of the stance lock, 0 (feet as animated) to 1 (feet on the stance). */
  private lock = 0
  /** Standing stance, per leg: foot position and rotation in body space. */
  private stance: { position: Vector3; rotation: Quaternion }[] | null = null
  /** Standing heights above the ground of the ankle and of the toe base, world units. */
  private ankleRest = 0
  private toeRest = 0

  /**
   * @param model The skinned model (its bones are found by name).
   * @param body Object moved up and down by the body drop (the model).
   */
  constructor(
    model: Object3D,
    private readonly body: Object3D,
  ) {
    const nodes: Object3D[] = []
    model.traverse((o) => {
      nodes.push(o)
    })
    const bone = (suffixes: readonly string[]): Object3D | null =>
      nodes.find((o) => o.type === 'Bone' && suffixes.some((s) => o.name.endsWith(s))) ?? null
    const legs: Leg[] = []
    for (const [mixamo, vrm] of LEG_SIDES) {
      const thigh = bone([`${mixamo}UpLeg`, `${vrm}_UpperLeg`])
      const shin = bone([`${mixamo}Leg`, `${vrm}_LowerLeg`])
      const foot = bone([`${mixamo}Foot`, `${vrm}_Foot`])
      const toe = bone([`${mixamo}ToeBase`, `${vrm}_ToeBase`])
      if (thigh && shin && foot) legs.push({ thigh, shin, foot, toe })
    }
    this.legs = legs
  }

  /** Whether the rig has the expected leg bones. */
  get usable(): boolean {
    return this.legs.length === 2
  }

  /**
   * Record the standing stance: where the feet are, relative to the body,
   * in the current pose (call with the idle clip at its first frame).
   * While standing, the feet stay there whatever the idle clip does: idle
   * clips shuffle their feet, which looks like sliding.
   */
  captureStance(): void {
    this.body.updateMatrixWorld(true)
    this.body.getWorldQuaternion(BODY).invert()
    this.stance = this.legs.map((leg) => ({
      position: this.body.worldToLocal(leg.foot.getWorldPosition(new Vector3())),
      rotation: BODY.clone().multiply(leg.foot.getWorldQuaternion(new Quaternion())),
    }))
    // The body's origin is on the ground: heights above it are rest heights.
    const ground = this.body.getWorldPosition(S).y
    const leg = this.legs[0]
    if (leg) {
      this.ankleRest = leg.foot.getWorldPosition(A).y - ground
      this.toeRest = leg.toe ? leg.toe.getWorldPosition(A).y - ground : 0
    }
  }

  /**
   * Plant the feet. `originY` is the world height of the character's
   * origin (ground under its centre); `enabled` false (mid-hop) fades the
   * IK out; `standing` locks the feet on the stance (see
   * {@link captureStance}), faded in and out.
   */
  update(
    dt: number,
    originY: number,
    ground: FootGroundProbe,
    enabled: boolean,
    standing: boolean,
  ): void {
    if (!this.usable) return
    const fade = Math.min(1, dt * DROP_RATE)
    this.weight += ((enabled ? 1 : 0) - this.weight) * fade
    this.lock +=
      ((standing && enabled && this.stance ? 1 : 0) - this.lock) * Math.min(1, dt * LOCK_RATE)

    // Pose as animated, body not dropped: where each foot should go.
    this.body.position.y = 0
    this.body.updateMatrixWorld(true)
    this.body.getWorldQuaternion(BODY)
    const needs: {
      leg: Leg
      target: Vector3
      rotation: Quaternion
      normal: Vector3
      lift: number
    }[] = []
    let lowest = 0
    this.legs.forEach((leg, i) => {
      const target = leg.foot.getWorldPosition(new Vector3())
      const rotation = leg.foot.getWorldQuaternion(new Quaternion())
      const stance = this.stance?.[i]
      if (stance && this.lock > 0) {
        target.lerp(this.body.localToWorld(S.copy(stance.position)), this.lock)
        rotation.slerp(WORLD.copy(BODY).multiply(stance.rotation), this.lock)
      }
      const lift = target.y - originY
      const hit = ground(target.x, target.z, originY)
      if (hit) {
        const offset = Math.max(-MAX_DROP, Math.min(MAX_DROP, hit.y - originY)) * this.weight
        target.y += offset
        lowest = Math.min(lowest, offset)
      }
      needs.push({ leg, target, rotation, normal: hit?.normal ?? UP, lift })
    })
    this.drop += (lowest - this.drop) * fade
    this.body.position.y = this.drop
    this.body.updateMatrixWorld(true)

    for (const { leg, target, rotation, normal, lift } of needs) {
      const planted = Math.max(0, 1 - (lift - this.ankleRest) / PLANTED_LIFT) * this.weight
      this.place(leg, target, rotation, normal, planted)
      // The front of the foot must not sink: raise the ankle when the toe
      // base is below its standing height over the ground under it.
      if (!leg.toe || this.weight < 0.5) continue
      const toe = leg.toe.getWorldPosition(C)
      const hit = ground(toe.x, toe.z, target.y)
      if (!hit) continue
      const deficit = hit.y + this.toeRest - toe.y
      if (deficit <= 1e-3) continue
      target.y += deficit
      this.place(leg, target, rotation, normal, planted)
    }
  }

  /**
   * Put a leg's ankle on `target` and orient its foot: its own orientation
   * (animated or locked), not the one the bent leg would give it, turned
   * along the slope (`normal`) by the `planted` weight.
   */
  private place(
    leg: Leg,
    target: Vector3,
    rotation: Quaternion,
    normal: Vector3,
    planted: number,
  ): void {
    this.solve(leg, target)
    Q.setFromUnitVectors(UP, normal).slerp(WORLD.identity(), 1 - planted)
    setWorldQuaternion(leg.foot, Q.multiply(rotation))
    leg.foot.updateMatrixWorld(true)
  }

  /**
   * Two-bone IK with a pole: the knee is placed explicitly, in the plane
   * through hip and target that holds the animated knee, on the front side
   * (it can never bend backwards), at the distance the bone lengths give;
   * then the thigh is swung onto the knee and the shin onto the target.
   */
  private solve(leg: Leg, target: Vector3): void {
    leg.thigh.getWorldPosition(A)
    leg.shin.getWorldPosition(B)
    leg.foot.getWorldPosition(C)
    const upper = A.distanceTo(B)
    const lower = B.distanceTo(C)
    const reach = Math.min(
      Math.max(A.distanceTo(target), Math.abs(upper - lower) + 1e-4),
      upper + lower - 1e-4,
    )
    // Hip-to-target direction.
    U.subVectors(target, A).normalize()
    // Pole: the animated knee's side of the hip-to-ankle line, pushed to the
    // body's front (a straight leg has no side, a backward one is wrong).
    this.body.getWorldQuaternion(WORLD)
    AXIS.set(0, 0, 1).applyQuaternion(WORLD) // body forward
    V.subVectors(B, A)
    S.subVectors(C, A).normalize()
    V.addScaledVector(S, -V.dot(S)) // knee offset from the hip-ankle line
    if (V.dot(AXIS) < 0) V.addScaledVector(AXIS, -V.dot(AXIS)) // drop its backward part
    V.addScaledVector(AXIS, 0.02).addScaledVector(U, -V.dot(U)).normalize()
    // Knee position: along hip-target, then out towards the pole.
    const along = (upper * upper - lower * lower + reach * reach) / (2 * reach)
    const out = Math.sqrt(Math.max(0, upper * upper - along * along))
    const knee = S.copy(A).addScaledVector(U, along).addScaledVector(V, out)

    // Thigh: hip-to-knee onto the new knee.
    U.subVectors(B, A).normalize()
    V.subVectors(knee, A).normalize()
    rotateWorld(leg.thigh, Q.setFromUnitVectors(U, V))
    leg.thigh.updateMatrixWorld(true)
    // Shin: knee-to-ankle onto the target.
    leg.shin.getWorldPosition(B)
    leg.foot.getWorldPosition(C)
    U.subVectors(C, B).normalize()
    V.subVectors(target, B).normalize()
    rotateWorld(leg.shin, Q.setFromUnitVectors(U, V))
    leg.shin.updateMatrixWorld(true)
  }
}

/** Give `bone` the world rotation `q`. */
function setWorldQuaternion(bone: Object3D, q: Quaternion): void {
  const parent = bone.parent
  if (parent) parent.getWorldQuaternion(PARENT)
  else PARENT.identity()
  bone.quaternion.copy(PARENT.invert().multiply(q))
}

/** Apply a world-space rotation `r` to `bone` (about its own origin). */
function rotateWorld(bone: Object3D, r: Quaternion): void {
  const parent = bone.parent
  if (parent) parent.getWorldQuaternion(PARENT)
  else PARENT.identity()
  // local' = parent^-1 * r * parent * local
  WORLD.copy(PARENT).invert().multiply(r).multiply(PARENT)
  bone.quaternion.premultiply(WORLD)
}
