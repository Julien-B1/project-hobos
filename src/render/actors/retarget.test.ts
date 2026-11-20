import {
  AnimationClip,
  AnimationMixer,
  Bone,
  Group,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
} from 'three'
import { describe, expect, it } from 'vitest'
import { humanoidBones, retargetClip } from './retarget'

/** Hips, spine and a left arm: VRM-style names, or Mixamo names with rolled bones. */
function skeleton(kind: 'vrm' | 'mixamo'): Group {
  const names =
    kind === 'vrm'
      ? ['J_Bip_C_Hips', 'J_Bip_C_Spine', 'J_Bip_L_UpperArm', 'J_Bip_L_LowerArm']
      : ['mixamorigHips', 'mixamorigSpine', 'mixamorigLeftArm', 'mixamorigLeftForeArm']
  const root = new Group()
  let parent: Group | Bone = root
  const offsets = [
    new Vector3(0, 0.6, 0),
    new Vector3(0, 0.1, 0),
    new Vector3(0.1, 0.15, 0),
    new Vector3(0.12, 0, 0),
  ]
  names.forEach((name, i) => {
    const bone = new Bone()
    bone.name = name
    bone.position.copy(offsets[i] ?? new Vector3())
    // Another roll on every Mixamo bone: the retarget must not care.
    if (kind === 'mixamo') {
      const roll = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.7)
      bone.quaternion.copy(roll)
      bone.position.applyQuaternion(roll.clone().invert())
      if (parent instanceof Bone) bone.position.applyQuaternion(roll)
    }
    parent.add(bone)
    parent = bone
  })
  root.updateMatrixWorld(true)
  return root
}

/** World position of the forearm (the tip of the upper arm). */
function elbow(root: Group): Vector3 {
  const bones = humanoidBones(root)
  return (bones.get('LeftLowerArm') as Bone).getWorldPosition(new Vector3())
}

describe('humanoidBones', () => {
  it('matches Mixamo and VRM names without confusing arm and forearm', () => {
    const mixamo = humanoidBones(skeleton('mixamo'))
    expect(mixamo.get('LeftUpperArm')?.name).toBe('mixamorigLeftArm')
    expect(mixamo.get('LeftLowerArm')?.name).toBe('mixamorigLeftForeArm')
    expect(humanoidBones(skeleton('vrm')).get('hips')?.name).toBe('J_Bip_C_Hips')
  })
})

describe('retargetClip', () => {
  it.each([false, true])('reproduces the arm pose on another skeleton (A-pose: %s)', (aPose) => {
    const source = skeleton('vrm')
    const target = skeleton('mixamo')
    if (aPose) {
      // Character at rest in A-pose: upper arm turned 1 rad down.
      const arm = humanoidBones(target).get('LeftUpperArm') as Bone
      arm.quaternion.premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -1))
      target.updateMatrixWorld(true)
    }
    const raise = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -1.2)
    const clip = new AnimationClip('raise', 1, [
      new QuaternionKeyframeTrack(
        'J_Bip_L_UpperArm.quaternion',
        [0, 1],
        [0, 0, 0, 1, ...raise.toArray()],
      ),
    ])
    const baked = retargetClip(clip, source, target)
    // Source pose at t = 1.
    const sourceMixer = new AnimationMixer(source)
    sourceMixer.clipAction(clip).play()
    sourceMixer.setTime(1)
    source.updateMatrixWorld(true)
    const expected = elbow(source).sub(
      (humanoidBones(source).get('LeftUpperArm') as Bone).getWorldPosition(new Vector3()),
    )
    // Target pose at t = 1.
    const targetMixer = new AnimationMixer(target)
    targetMixer.clipAction(baked).play()
    targetMixer.setTime(1)
    target.updateMatrixWorld(true)
    const got = elbow(target).sub(
      (humanoidBones(target).get('LeftUpperArm') as Bone).getWorldPosition(new Vector3()),
    )
    expect(got.normalize().dot(expected.normalize())).toBeCloseTo(1, 4)
  })
})
