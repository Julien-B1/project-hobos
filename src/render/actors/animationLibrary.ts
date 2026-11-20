/**
 * Animation library: one skeleton and one set of clips for every character.
 *
 * Layer: render. Every character model is built on the reference humanoid
 * skeleton (`tooling/blender/humanoid.py`: Mixamo bone names, T-pose rest,
 * the same rest axes for every bone), and the library file
 * (`src/assets/animations/humanoid.glb`, built by `make models`) holds that
 * skeleton with every clip and the weapon sockets, no mesh. A clip is
 * therefore played on any character as it is: the same tracks, the same
 * local rotations. Only sizes differ between characters:
 *
 * - {@link adaptClips}: the hips' position track is scaled to the
 *   character's hip height (longer or shorter legs);
 * - {@link addSockets}: the weapon sockets (nodes named `Socket_*` under
 *   the library's bones: the right hand's grip, the sheaths) are copied
 *   under the character's own bones, their offsets scaled the same way.
 *
 * {@link ClipRule} is what the game knows about a clip beyond its tracks
 * (`humanoid.clips.json`, written with the library from
 * `tooling/blender/combat_clips.py`).
 */
import { AnimationClip, Object3D, Vector3, VectorKeyframeTrack } from 'three'

/** Name prefix of the weapon sockets. */
export const SOCKET_PREFIX = 'Socket_'

/** What the game knows about a library clip (times in seconds). */
export interface ClipRule {
  /** Weapon the clip is played with in hand (a draw comes first if needed). */
  readonly weapon?: string
  /** The clip takes the weapon from its sheath (played backwards: puts it back). */
  readonly draw?: boolean
  /** When the right hand takes the weapon from its sheath. */
  readonly grab?: number
  /** Period (start, end) in which the weapon comes to its exact place in the hand. */
  readonly settle?: readonly number[]
  /** Clip played next. */
  readonly then?: string
  /** The clip stays on its last frame (a defeat). */
  readonly hold?: boolean
  /** The clip loops and is a standing pose. */
  readonly loop?: boolean
  /** False when the feet must not be planted by the game (lying down). */
  readonly foot_ik?: boolean
  /** Period (start, end) of the incantation effects. */
  readonly cast?: readonly number[]
}

/** Rules by clip name. */
export type ClipRules = Readonly<Record<string, ClipRule>>

/** The hips bone under `root` (reference skeleton), or null. */
export function hipsOf(root: Object3D): Object3D | null {
  let found: Object3D | null = null
  root.traverse((o) => {
    if (!found && o.name.endsWith('Hips')) found = o
  })
  return found
}

/** Height of a node above `root`'s origin, in `root`'s units. */
function heightIn(root: Object3D, node: Object3D): number {
  root.updateMatrixWorld(true)
  return root.worldToLocal(node.getWorldPosition(new Vector3())).y
}

/**
 * Size of `model` against the library skeleton: ratio of the hips' rest
 * heights (1 when either has no hips).
 */
export function sizeRatio(library: Object3D, model: Object3D): number {
  const a = hipsOf(library)
  const b = hipsOf(model)
  if (!a || !b) return 1
  const reference = heightIn(library, a)
  return reference > 1e-6 ? heightIn(model, b) / reference : 1
}

/**
 * Library clips for one character: the same clips, with the hips' moves
 * around their rest position scaled by `ratio` (see {@link sizeRatio}).
 * Both skeletons must be at rest.
 */
export function adaptClips(
  clips: readonly AnimationClip[],
  library: Object3D,
  model: Object3D,
  ratio: number,
): AnimationClip[] {
  const from = hipsOf(library)
  const to = hipsOf(model)
  if (!from || !to) return [...clips]
  const name = `${from.name}.position`
  const restFrom = from.position
  const restTo = to.position
  return clips.map((clip) => {
    const tracks = clip.tracks.map((track) => {
      if (track.name !== name) return track
      const values = Float32Array.from(track.values)
      for (let i = 0; i < values.length; i += 3) {
        values[i] = restTo.x + ((values[i] ?? 0) - restFrom.x) * ratio
        values[i + 1] = restTo.y + ((values[i + 1] ?? 0) - restFrom.y) * ratio
        values[i + 2] = restTo.z + ((values[i + 2] ?? 0) - restFrom.z) * ratio
      }
      return new VectorKeyframeTrack(`${to.name}.position`, Float32Array.from(track.times), values)
    })
    return new AnimationClip(clip.name, clip.duration, tracks)
  })
}

/**
 * Copy the library's weapon sockets under the same bones of `model`
 * (offsets scaled by `ratio`). Returns the new nodes by name.
 */
export function addSockets(
  library: Object3D,
  model: Object3D,
  ratio: number,
): Map<string, Object3D> {
  const bones = new Map<string, Object3D>()
  model.traverse((o) => {
    if (!bones.has(o.name)) bones.set(o.name, o)
  })
  const sockets = new Map<string, Object3D>()
  library.traverse((o) => {
    if (!o.name.startsWith(SOCKET_PREFIX) || !o.parent) return
    const bone = bones.get(o.parent.name)
    if (!bone) return
    const socket = new Object3D()
    socket.name = o.name
    socket.position.copy(o.position).multiplyScalar(ratio)
    socket.quaternion.copy(o.quaternion)
    bone.add(socket)
    sockets.set(o.name, socket)
  })
  return sockets
}
