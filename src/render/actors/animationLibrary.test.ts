import {
  AnimationClip,
  Bone,
  Group,
  Object3D,
  QuaternionKeyframeTrack,
  VectorKeyframeTrack,
} from 'three'
import { describe, expect, it } from 'vitest'
import { adaptClips, addSockets, hipsOf, sizeRatio } from './animationLibrary'

/** A skeleton with hips at `height` and one arm bone; `socket` adds a weapon socket on the arm. */
function skeleton(height: number, socket = false): Group {
  const root = new Group()
  const hips = new Bone()
  hips.name = 'mixamorigHips'
  hips.position.set(0, height, 0)
  const arm = new Bone()
  arm.name = 'mixamorigRightHand'
  arm.position.set(0.2, 0.3, 0)
  hips.add(arm)
  if (socket) {
    const grip = new Object3D()
    grip.name = 'Socket_Grip_R'
    grip.position.set(0.04, 0, 0.01)
    grip.quaternion.set(0, 0.6, 0, 0.8)
    arm.add(grip)
  }
  root.add(hips)
  root.updateMatrixWorld(true)
  return root
}

describe('animation library', () => {
  it('finds the hips and the size ratio of a model', () => {
    const library = skeleton(0.6)
    const model = skeleton(0.54)
    expect(hipsOf(model)?.name).toBe('mixamorigHips')
    expect(sizeRatio(library, model)).toBeCloseTo(0.9)
  })

  it('scales the hips moves around the rest position and keeps the rotations', () => {
    const library = skeleton(0.6)
    const model = skeleton(0.54)
    const clip = new AnimationClip('bob', 1, [
      new VectorKeyframeTrack('mixamorigHips.position', [0, 1], [0, 0.6, 0, 0.1, 0.5, 0]),
      new QuaternionKeyframeTrack(
        'mixamorigRightHand.quaternion',
        [0, 1],
        [0, 0, 0, 1, 0, 1, 0, 0],
      ),
    ])
    const [adapted] = adaptClips([clip], library, model, 0.9)
    const hips = adapted?.tracks[0]?.values
    // Rest stays the model's rest; the 0.1 dip and the 0.1 side step scale by 0.9.
    expect(Array.from(hips ?? [])).toEqual(
      [0, 0.54, 0, 0.09, 0.45, 0].map((v) => expect.closeTo(v, 5) as number),
    )
    expect(adapted?.tracks[1]).toBe(clip.tracks[1])
  })

  it('copies the weapon sockets under the same bones, offsets scaled', () => {
    const library = skeleton(0.6, true)
    const model = skeleton(0.54)
    const sockets = addSockets(library, model, 0.9)
    const grip = sockets.get('Socket_Grip_R')
    expect(grip?.parent?.name).toBe('mixamorigRightHand')
    expect(grip?.position.x).toBeCloseTo(0.036)
    expect(grip?.quaternion.y).toBeCloseTo(0.6)
  })
})
