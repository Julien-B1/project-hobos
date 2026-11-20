/**
 * Arm adjustments on top of the animation clips: arm spacing for the
 * character's outfit, and follow-through so the arms swing loosely.
 *
 * Layer: render. Runs after the animation mixer, before the foot IK and the
 * spring bones, on the pose the clip produced. The clips can then be
 * shared between characters (the same walk on a slim fighter and on a
 * wizard in a wide skirt): what depends on the body or the outfit lives
 * here, per character, in an {@link ArmStyle}.
 *
 * For each arm:
 * 1. the upper arm is turned outwards about the body's forward axis
 *    (`abduction`), so the hands clear the hips and the skirt;
 * 2. the elbow bends a little more (`elbowFlex`), more so as the arm swings
 *    forward (`forwardFlex`), as in a relaxed walk;
 * 3. the forearm and the hand lag behind the upper arm's swing: the swing
 *    angle is followed by a smoothed copy (time constant `lag`), and the
 *    difference, times `followThrough`, turns the forearm (and half of it
 *    the hand) the other way. A stiff pendulum becomes a whip-like swing,
 *    and nothing changes when the arm is still.
 */
import { type Object3D, Quaternion, Vector3 } from 'three'
import { rotateWorld } from './footIk'

/** How a character holds and swings its arms (angles in radians). */
export interface ArmStyle {
  /** Upper arm turned away from the body. */
  readonly abduction: number
  /** Extra elbow bend, always. */
  readonly elbowFlex: number
  /** Extra elbow bend per radian of forward swing. */
  readonly forwardFlex: number
  /** Forearm counter-turn per radian of swing lag. */
  readonly followThrough: number
  /** Time constant of the lagging swing, in seconds. */
  readonly lag: number
}

/** No change: the clip's arms as they are. */
export const NEUTRAL_ARMS: ArmStyle = {
  abduction: 0,
  elbowFlex: 0,
  forwardFlex: 0,
  followThrough: 0,
  lag: 0.1,
}

/** One arm's bones and swing state. */
interface Arm {
  readonly upper: Object3D
  readonly lower: Object3D
  readonly hand: Object3D | null
  /** +1 for the left arm (model +X side), -1 for the right one. */
  readonly side: 1 | -1
  /** Smoothed swing angle (radians, forward positive). */
  lagged: number
  primed: boolean
}

/**
 * Name fragments of each side's arm bones: Mixamo (`mixamorig:LeftArm`)
 * and VRM-style (`J_Bip_L_UpperArm`).
 */
const ARM_SIDES = [
  ['Left', 'L', 1],
  ['Right', 'R', -1],
] as const

const FORWARD = new Vector3()
const LATERAL = new Vector3()
const MODEL_ROT = new Quaternion()
const INVERSE = new Quaternion()
const A = new Vector3()
const B = new Vector3()
const R = new Quaternion()

/** Arm adjustments for one rigged character. */
export class ArmPose {
  private readonly arms: Arm[] = []

  /**
   * @param model The skinned model (bones found by name), facing +Z.
   * @param style How this character holds its arms.
   */
  constructor(
    private readonly model: Object3D,
    private readonly style: ArmStyle,
  ) {
    const nodes: Object3D[] = []
    model.traverse((o) => {
      if (o.type === 'Bone') nodes.push(o)
    })
    const bone = (suffixes: readonly string[]): Object3D | null =>
      nodes.find((o) => suffixes.some((s) => o.name.endsWith(s))) ?? null
    for (const [mixamo, vrm, side] of ARM_SIDES) {
      const upper = bone([`${mixamo}Arm`, `${vrm}_UpperArm`])
      const lower = bone([`${mixamo}ForeArm`, `${vrm}_LowerArm`])
      const hand = bone([`${mixamo}Hand`, `${vrm}_Hand`])
      if (upper && lower) this.arms.push({ upper, lower, hand, side, lagged: 0, primed: false })
    }
  }

  /** Forget the swing history (after a teleport). */
  reset(): void {
    for (const arm of this.arms) arm.primed = false
  }

  /**
   * Adjust the arms of the current pose, `dt` seconds after the previous
   * call. The model's world matrices must be up to date. `weight` 0 to 1
   * scales the whole style (0 during action clips: their arms are keyed).
   */
  update(dt: number, weight = 1): void {
    const s = this.style
    if (this.arms.length === 0 || s === NEUTRAL_ARMS) return
    this.model.getWorldQuaternion(MODEL_ROT)
    INVERSE.copy(MODEL_ROT).invert()
    FORWARD.set(0, 0, 1).applyQuaternion(MODEL_ROT)
    LATERAL.set(1, 0, 0).applyQuaternion(MODEL_ROT)
    const k = dt > 0 ? 1 - Math.exp(-dt / s.lag) : 1
    for (const arm of this.arms) {
      // Swing: the upper arm's forward angle, in the model's side view.
      arm.upper.getWorldPosition(A)
      arm.lower.getWorldPosition(B)
      B.sub(A).applyQuaternion(INVERSE)
      // The swing angle only means something for an arm that hangs: a
      // raised arm (action clips) would make it jump.
      const hanging = -B.y > 0.3 * B.length()
      const swing = hanging ? Math.atan2(B.z, -B.y) : arm.lagged
      if (!arm.primed) {
        arm.lagged = swing
        arm.primed = true
      }
      arm.lagged += (swing - arm.lagged) * k
      const trail = Math.max(-0.5, Math.min(0.5, (arm.lagged - swing) * s.followThrough)) * weight

      // 1. Spacing: outwards about the forward axis.
      rotateWorld(arm.upper, R.setFromAxisAngle(FORWARD, arm.side * s.abduction * weight))
      arm.upper.updateMatrixWorld(true)

      // 2-3. Elbow: forward bend (negative turn about the lateral axis
      // brings a hanging forearm forward), plus the lag.
      const flex = (s.elbowFlex + s.forwardFlex * Math.max(0, swing)) * weight + trail
      rotateWorld(arm.lower, R.setFromAxisAngle(LATERAL, -flex))
      arm.lower.updateMatrixWorld(true)
      if (arm.hand) {
        rotateWorld(arm.hand, R.setFromAxisAngle(LATERAL, -trail * 0.5))
        arm.hand.updateMatrixWorld(true)
      }
    }
  }
}
