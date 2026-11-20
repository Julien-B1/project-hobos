/**
 * A character's weapon: in its sheath or in the right hand.
 *
 * Layer: render. The weapon is not animated by clips: it sits on one of the
 * character's weapon sockets (`animationLibrary.ts`: the right hand's grip,
 * or its sheath on the body), whose axes are X the weapon's flat direction
 * and Y its axis towards the head (a sword's blade, a staff's head). The
 * object lives in world space and is placed every frame from the socket's
 * world matrix, after the pose of the frame is final.
 *
 * Which socket holds it follows the clip being played ({@link ClipRule}):
 * a draw clip takes it from the sheath at its `grab` time (and gives it back
 * when played backwards); any other clip of the weapon needs it in hand.
 * A change of holder never snaps: the weapon keeps its place and eases to
 * the new socket, during the clip's `settle` period for a draw (the staff,
 * taken above the shoulder, slides in the hand to be held by its middle),
 * in {@link SWITCH_BLEND} seconds otherwise.
 */
import { Group, Matrix4, Mesh, type Object3D, Quaternion, Vector3 } from 'three'
import type { ClipRule } from './animationLibrary'

/** Kinds of weapons. */
export type WeaponKind = 'sword' | 'staff'

/** Socket of the right hand's grip. */
export const GRIP_SOCKET = 'Socket_Grip_R'

/** Shape of a weapon model (1 unit long, along +Y, flat along X). */
interface WeaponShape {
  /** Height of the grip's centre in the model. */
  readonly grip: number
  /** Whether the head (blade tip, staff head) is up the model (+Y) or down. */
  readonly headUp: boolean
  /** Length the model is scaled to, in character model units. */
  readonly length: number
  /** Height in the model of the point that lights up (incantation). */
  readonly glow: number
  /** Socket of its sheath. */
  readonly sheath: string
}

/** Shapes of the weapon models (`assets-src/models/`). */
export const WEAPON_SHAPES: Readonly<Record<WeaponKind, WeaponShape>> = {
  // Hilt at the top of the model, blade down.
  sword: { grip: 0.855, headUp: false, length: 0.6, glow: 0.3, sheath: 'Socket_Sheath_Sword' },
  // Held by the middle, head (the orb) at the top.
  staff: { grip: 0.5, headUp: true, length: 1, glow: 0.92, sheath: 'Socket_Sheath_Staff' },
}

/** Blend to a new holder outside a draw clip's own period, in seconds. */
const SWITCH_BLEND = 0.25

const HOLDER = new Matrix4()
const OFFSET = new Matrix4()
const INVERSE = new Matrix4()
const POSITION = new Vector3()
const ROTATION = new Quaternion()
const SCALE = new Vector3()
const ONE = new Vector3(1, 1, 1)
const IDENTITY = new Quaternion()

/** Offset of the weapon from its holder's socket, fading to none. */
interface Offset {
  readonly position: Vector3
  readonly rotation: Quaternion
}

const smooth = (x: number): number => {
  const t = Math.min(1, Math.max(0, x))
  return t * t * (3 - 2 * t)
}

/** One weapon of one character. Add {@link Weapon.object} to the scene. */
export class Weapon {
  /** Scene object, in world space. */
  readonly object = new Group()
  /** Model matrix inside a socket: grip on the socket, scaled to length. */
  private readonly local = new Matrix4()
  private holder: 'sheath' | 'hand' = 'sheath'
  /** Offset left by the last change of holder. */
  private offset: Offset | null = null
  /** Offset of the last draw (replayed backwards when sheathing). */
  private drawOffset: Offset | null = null
  private sinceSwitch = SWITCH_BLEND

  /**
   * @param model The weapon's model (glTF scene).
   * @param kind Its kind (shape and sheath).
   * @param sheath Socket of its sheath on the character.
   * @param hand Socket of the right hand's grip.
   */
  constructor(
    model: Object3D,
    readonly kind: WeaponKind,
    private readonly sheath: Object3D,
    private readonly hand: Object3D,
  ) {
    const shape = WEAPON_SHAPES[kind]
    this.object.name = `weapon-${kind}`
    this.object.matrixAutoUpdate = false
    this.object.add(model)
    // Model to socket: grip at the origin, head along +Y, scaled.
    const flip = new Matrix4().makeRotationX(shape.headUp ? 0 : Math.PI)
    this.local
      .makeScale(shape.length, shape.length, shape.length)
      .multiply(flip)
      .multiply(new Matrix4().makeTranslation(0, -shape.grip, 0))
    model.traverse((o) => {
      if (o instanceof Mesh) o.frustumCulled = false
    })
  }

  /** Whether the weapon is in the hand. */
  get inHand(): boolean {
    return this.holder === 'hand'
  }

  /** Put the weapon in the hand or in its sheath at once (no blend). */
  place(holder: 'sheath' | 'hand'): void {
    this.holder = holder
    this.offset = null
    this.sinceSwitch = SWITCH_BLEND
  }

  /**
   * Place the weapon for this frame. Call once the character's pose is
   * final and its world matrices are up to date.
   *
   * @param dt Seconds since the previous frame.
   * @param rule Rule of the clip being played, if any.
   * @param time Time in that clip, in seconds.
   */
  update(dt: number, rule: ClipRule | undefined, time: number): void {
    const mine = rule?.weapon === this.kind
    let want = this.holder
    if (mine && rule.draw) want = time >= (rule.grab ?? 0) ? 'hand' : 'sheath'
    else if (mine) want = 'hand'
    if (want !== this.holder) {
      // Keep the weapon where it is: express it from the new socket.
      const now = this.holderMatrix(rule, time)
      const next = (want === 'hand' ? this.hand : this.sheath).matrixWorld
      OFFSET.copy(INVERSE.copy(next).invert()).multiply(now)
      const offset = { position: new Vector3(), rotation: new Quaternion() }
      OFFSET.decompose(offset.position, offset.rotation, SCALE)
      this.offset = offset
      if (want === 'hand') this.drawOffset = offset
      this.holder = want
      this.sinceSwitch = 0
    }
    this.sinceSwitch += dt
    this.object.matrix.copy(this.holderMatrix(rule, time)).multiply(this.local)
    this.object.matrixWorld.copy(this.object.matrix)
    this.object.updateMatrixWorld(true)
  }

  /** World position of the point that lights up, into `out`. */
  glowPoint(out: Vector3): Vector3 {
    return out.set(0, WEAPON_SHAPES[this.kind].glow, 0).applyMatrix4(this.object.matrixWorld)
  }

  /** World matrix of the weapon's grip frame now: socket, plus the fading offset. */
  private holderMatrix(rule: ClipRule | undefined, time: number): Matrix4 {
    const socket = this.holder === 'hand' ? this.hand : this.sheath
    HOLDER.copy(socket.matrixWorld)
    let offset = this.offset
    let left = 1 - smooth(this.sinceSwitch / SWITCH_BLEND)
    if (this.holder === 'hand' && rule?.weapon === this.kind && rule.draw && rule.settle) {
      // In a draw, the clip's own period drives the settling (both ways).
      const [from = 0, to = from] = rule.settle
      offset = this.drawOffset
      left = 1 - smooth((time - from) / Math.max(1e-3, to - from))
    }
    if (!offset || left <= 0) return HOLDER
    POSITION.copy(offset.position).multiplyScalar(left)
    ROTATION.copy(IDENTITY).slerp(offset.rotation, left)
    return HOLDER.multiply(OFFSET.compose(POSITION, ROTATION, ONE))
  }
}
