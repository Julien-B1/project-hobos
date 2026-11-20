/**
 * Animation library: clips made on one skeleton, played on any humanoid.
 *
 * Layer: render. The library file (`src/assets/animations/humanoid.glb`,
 * built by `make models`) holds a skeleton and its clips, no mesh. Each
 * character's own skeleton may use other bone names (Mixamo or VRM-style),
 * other rest orientations and other proportions. {@link retargetClip} bakes
 * a library clip for one character:
 *
 * - bones are matched through {@link HUMANOID_BONES} (a canonical name and
 *   its Mixamo and VRM-style suffixes);
 * - per frame, each library bone's turn away from its rest pose, in the
 *   model's space (`G(t) * G_rest^-1`), is applied to the matching bone's
 *   rest pose in the character's model space; local rotations follow from
 *   the parents (bones without a match keep their rest pose). Both rest
 *   stances may differ (the library is in T-pose, a character may be in
 *   A-pose): each character bone's rest pose is first turned so the bone
 *   points like the library's ({@link DIRECTION_CHILD}; a bone without a
 *   direction keeps its parent's correction);
 * - the hips' offset from rest is scaled by the ratio of hip heights;
 * - grounding: when the clip's lowest foot never comes down to the rest
 *   pose's lowest foot (a run clip whose feet float), the hips are lowered
 *   by the gap over the whole clip, so the feet touch the ground at the
 *   bottom of each stride. Clips are only ever lowered, never raised.
 *
 * Baking happens once per character and clip, at load.
 */
import {
  AnimationClip,
  AnimationMixer,
  type Object3D,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
  VectorKeyframeTrack,
} from 'three'

/** Canonical humanoid bones: [name, Mixamo suffix, VRM-style suffix]. */
export const HUMANOID_BONES: readonly (readonly [string, string, string])[] = [
  ['hips', 'Hips', 'C_Hips'],
  ['spine', 'Spine', 'C_Spine'],
  ['chest', 'Spine1', 'C_Chest'],
  ['upperChest', 'Spine2', 'C_UpperChest'],
  ['neck', 'Neck', 'C_Neck'],
  ['head', 'Head', 'C_Head'],
  ...(['Left', 'Right'] as const).flatMap((side) => {
    const s = side === 'Left' ? 'L' : 'R'
    const fingers = [
      ['Thumb', 'Thumb'],
      ['Index', 'Index'],
      ['Middle', 'Middle'],
      ['Ring', 'Ring'],
      ['Pinky', 'Little'],
    ].flatMap(([mixamo, vrm]) =>
      [1, 2, 3].map(
        (k) =>
          [
            `${side}${mixamo ?? ''}${k}`,
            `${side}Hand${mixamo ?? ''}${k}`,
            `${s}_${vrm ?? ''}${k}`,
          ] as const,
      ),
    )
    return [
      [`${side}Shoulder`, `${side}Shoulder`, `${s}_Shoulder`],
      [`${side}UpperArm`, `${side}Arm`, `${s}_UpperArm`],
      [`${side}LowerArm`, `${side}ForeArm`, `${s}_LowerArm`],
      [`${side}Hand`, `${side}Hand`, `${s}_Hand`],
      ...fingers,
      [`${side}UpperLeg`, `${side}UpLeg`, `${s}_UpperLeg`],
      [`${side}LowerLeg`, `${side}Leg`, `${s}_LowerLeg`],
      [`${side}Foot`, `${side}Foot`, `${s}_Foot`],
      [`${side}Toes`, `${side}ToeBase`, `${s}_ToeBase`],
    ] as const
  }),
]

/**
 * Child of each canonical bone that gives its direction (rest-pose
 * alignment); bones not listed take their parent's alignment.
 */
const DIRECTION_CHILD: ReadonlyMap<string, string> = new Map([
  ['hips', 'spine'],
  ['spine', 'chest'],
  ['chest', 'upperChest'],
  ['upperChest', 'neck'],
  ['neck', 'head'],
  ...(['Left', 'Right'] as const).flatMap((side) => [
    [`${side}Shoulder`, `${side}UpperArm`] as const,
    [`${side}UpperArm`, `${side}LowerArm`] as const,
    [`${side}LowerArm`, `${side}Hand`] as const,
    [`${side}Hand`, `${side}Middle1`] as const,
    ...['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'].flatMap((f) => [
      [`${side}${f}1`, `${side}${f}2`] as const,
      [`${side}${f}2`, `${side}${f}3`] as const,
    ]),
    [`${side}UpperLeg`, `${side}LowerLeg`] as const,
    [`${side}LowerLeg`, `${side}Foot`] as const,
    [`${side}Foot`, `${side}Toes`] as const,
  ]),
])

/** Sampling rate of baked clips, in frames per second. */
const BAKE_FPS = 30

/** Canonical bones whose heights define the feet's contact with the ground. */
const FEET = ['LeftFoot', 'RightFoot', 'LeftToes', 'RightToes']

/**
 * Bones of `root`'s skeleton by canonical name. A suffix matches the end of
 * a node name preceded by a non-letter or a lowercase letter
 * (`mixamorigHips`, `J_Bip_C_Hips`), so `LeftArm` never matches `LeftForeArm`.
 */
export function humanoidBones(root: Object3D): Map<string, Object3D> {
  const nodes: Object3D[] = []
  root.traverse((o) => {
    nodes.push(o)
  })
  const out = new Map<string, Object3D>()
  for (const [name, mixamo, vrm] of HUMANOID_BONES) {
    const found = nodes.find((o) =>
      [mixamo, vrm].some((suffix) => {
        if (!o.name.endsWith(suffix)) return false
        const before = o.name.charAt(o.name.length - suffix.length - 1)
        return before === '' || !/[A-Z]/.test(before)
      }),
    )
    if (found) out.set(name, found)
  }
  return out
}

/** Rotation of `o` in `root`'s space. */
function rotationIn(root: Object3D, o: Object3D, out: Quaternion): Quaternion {
  const inverse = root.getWorldQuaternion(new Quaternion()).invert()
  return out.copy(inverse.multiply(o.getWorldQuaternion(new Quaternion())))
}

/** Position of `o` in `root`'s space. */
function positionIn(root: Object3D, o: Object3D, out: Vector3): Vector3 {
  return root.worldToLocal(o.getWorldPosition(out))
}

/** Depth of `o` below `root`. */
function depth(o: Object3D, root: Object3D): number {
  let d = 0
  for (let p = o.parent; p && p !== root; p = p.parent) d++
  return d
}

/**
 * Bake `clip` (animating `source`, the library skeleton at rest) for
 * `target` (a character's model at rest). Returns a clip with the same name
 * whose tracks drive `target`'s bones.
 */
export function retargetClip(
  clip: AnimationClip,
  source: Object3D,
  target: Object3D,
): AnimationClip {
  source.updateMatrixWorld(true)
  target.updateMatrixWorld(true)
  const from = humanoidBones(source)
  const to = humanoidBones(target)
  const frames = Math.max(2, Math.round(clip.duration * BAKE_FPS) + 1)
  const stance = stanceCorrections(from, to, source, target)
  // Matched bones, parents first, with their rest poses in model space
  // (the character's turned to the library's stance).
  const pairs = [...to]
    .flatMap(([name, dst]) => {
      const src = from.get(name)
      return src
        ? [
            {
              src,
              dst,
              restSrcInverse: rotationIn(source, src, new Quaternion()).invert(),
              restDst: (stance.get(name) ?? new Quaternion()).multiply(
                rotationIn(target, dst, new Quaternion()),
              ),
              rotations: new Float32Array(frames * 4),
            },
          ]
        : []
    })
    .sort((a, b) => depth(a.dst, target) - depth(b.dst, target))
  const restLocal = new Map<Object3D, Quaternion>()
  target.traverse((o) => restLocal.set(o, o.quaternion.clone()))
  const hipsSrc = from.get('hips')
  const hipsDst = to.get('hips')
  const hipsRestSrc = hipsSrc ? positionIn(source, hipsSrc, new Vector3()) : new Vector3()
  const hipsRestDst = hipsDst ? positionIn(target, hipsDst, new Vector3()) : new Vector3()
  const hipRatio = hipsRestSrc.y > 1e-6 ? hipsRestDst.y / hipsRestSrc.y : 1
  const lowestFoot = (): number =>
    Math.min(
      ...FEET.map((n) => from.get(n))
        .filter((o): o is Object3D => o !== undefined)
        .map((o) => positionIn(source, o, new Vector3()).y),
    )
  const restFoot = lowestFoot()

  // Play the clip on the library skeleton and sample it; its rest pose is
  // put back afterwards (the next clip reads it).
  const saved: [Object3D, Quaternion, Vector3][] = []
  source.traverse((o) => saved.push([o, o.quaternion.clone(), o.position.clone()]))
  const mixer = new AnimationMixer(source)
  const action = mixer.clipAction(clip)
  action.play()
  const times = new Float32Array(frames)
  const hips = new Float32Array(frames * 3)
  let lowest = Infinity

  const global = new Map<Object3D, Quaternion>()
  const turn = new Quaternion()
  const offset = new Vector3()
  for (let f = 0; f < frames; f++) {
    const t = (clip.duration * f) / (frames - 1)
    times[f] = t
    mixer.setTime(t)
    source.updateMatrixWorld(true)
    lowest = Math.min(lowest, lowestFoot())
    global.clear()
    for (const p of pairs) {
      // Turn of the library bone from its rest pose, in model space...
      rotationIn(source, p.src, turn).multiply(p.restSrcInverse)
      // ...applied to the character bone's rest pose.
      const g = turn.multiply(p.restDst).clone()
      global.set(p.dst, g)
      // Local rotation: under the parent's global rotation at this frame.
      const parent = parentGlobal(p.dst, target, global, restLocal)
      const local = parent.invert().multiply(g)
      local.toArray(p.rotations, f * 4)
    }
    if (hipsSrc && hipsDst) {
      positionIn(source, hipsSrc, offset).sub(hipsRestSrc).multiplyScalar(hipRatio)
      offset.add(hipsRestDst)
      // Model space to the hips' parent space (parents are not animated).
      target.localToWorld(offset)
      hipsDst.parent?.worldToLocal(offset)
      offset.toArray(hips, f * 3)
    }
  }
  action.stop()
  mixer.uncacheRoot(source)
  for (const [o, quaternion, position] of saved) {
    o.quaternion.copy(quaternion)
    o.position.copy(position)
  }
  source.updateMatrixWorld(true)

  const tracks: (QuaternionKeyframeTrack | VectorKeyframeTrack)[] = pairs.map(
    (p) => new QuaternionKeyframeTrack(`${p.dst.name}.quaternion`, times, p.rotations),
  )
  if (hipsSrc && hipsDst) {
    // Grounding: lower the whole clip when its feet never reach the ground.
    const gap = lowest - restFoot
    if (gap > 0) groundHips(hips, gap * hipRatio, target, hipsDst)
    tracks.push(new VectorKeyframeTrack(`${hipsDst.name}.position`, times, hips))
  }
  return new AnimationClip(clip.name, clip.duration, tracks)
}

/**
 * Per canonical bone, the model-space turn that points the character's
 * rest bone like the library's (minimal rotation between both directions).
 * Bones without a direction take their nearest corrected ancestor's turn.
 */
function stanceCorrections(
  from: Map<string, Object3D>,
  to: Map<string, Object3D>,
  source: Object3D,
  target: Object3D,
): Map<string, Quaternion> {
  const out = new Map<string, Quaternion>()
  const a = new Vector3()
  const b = new Vector3()
  const direction = (bones: Map<string, Object3D>, root: Object3D, name: string, child: string) => {
    const bone = bones.get(name)
    const tip = bones.get(child)
    if (!bone || !tip) return null
    return positionIn(root, tip, a)
      .sub(positionIn(root, bone, b))
      .normalize()
      .clone()
  }
  // HUMANOID_BONES lists parents before children.
  const parentOf = (name: string): string | undefined => {
    for (const [p, c] of DIRECTION_CHILD) if (c === name) return p
    if (name.endsWith('3')) return name.replace(/3$/, '2')
    if (name.endsWith('Toes')) return name.replace(/Toes$/, 'Foot')
    return undefined
  }
  for (const [name] of HUMANOID_BONES) {
    const child = DIRECTION_CHILD.get(name)
    const ds = child ? direction(from, source, name, child) : null
    const dt = child ? direction(to, target, name, child) : null
    if (ds && dt) {
      out.set(name, new Quaternion().setFromUnitVectors(dt, ds))
      continue
    }
    const parent = parentOf(name)
    const inherited = parent ? out.get(parent) : undefined
    out.set(name, inherited ? inherited.clone() : new Quaternion())
  }
  return out
}

/**
 * Global rotation (model space) of `bone`'s parent at the frame being
 * baked: from `global` when the parent is already baked, else built from
 * its own parent and its rest local rotation.
 */
function parentGlobal(
  bone: Object3D,
  root: Object3D,
  global: Map<Object3D, Quaternion>,
  restLocal: Map<Object3D, Quaternion>,
): Quaternion {
  const chain: Object3D[] = []
  let p = bone.parent
  while (p && p !== root && !global.has(p)) {
    chain.push(p)
    p = p.parent
  }
  const baked = p && p !== root ? global.get(p) : undefined
  const out = baked ? baked.clone() : new Quaternion()
  for (let i = chain.length - 1; i >= 0; i--) {
    const o = chain[i]
    if (!o) continue
    out.multiply(restLocal.get(o) ?? o.quaternion)
  }
  return out
}

/** Lower the hips track by `drop` (model units, model space), in place. */
function groundHips(hips: Float32Array, drop: number, target: Object3D, hipsBone: Object3D): void {
  const parent = hipsBone.parent
  const a = new Vector3()
  const b = new Vector3()
  for (let i = 0; i < hips.length; i += 3) {
    a.fromArray(hips, i)
    if (parent) parent.localToWorld(a)
    target.worldToLocal(a)
    a.y -= drop
    b.copy(a)
    target.localToWorld(b)
    if (parent) parent.worldToLocal(b)
    b.toArray(hips, i)
  }
}
