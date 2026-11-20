import { Bone, Group, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { SpringBones, closestOnSegment, pushOutOfCapsule } from './springBones'

describe('capsule helpers', () => {
  it('clamps the closest point to the segment ends', () => {
    const a = new Vector3(0, 0, 0)
    const b = new Vector3(0, 1, 0)
    expect(closestOnSegment(new Vector3(1, 0.5, 0), a, b, new Vector3()).y).toBeCloseTo(0.5)
    expect(closestOnSegment(new Vector3(1, 3, 0), a, b, new Vector3()).y).toBeCloseTo(1)
  })

  it('pushes a point out to the capsule surface', () => {
    const p = new Vector3(0.05, 0.5, 0)
    expect(pushOutOfCapsule(p, new Vector3(0, 0, 0), new Vector3(0, 1, 0), 0.2)).toBe(true)
    expect(p.x).toBeCloseTo(0.2)
    expect(pushOutOfCapsule(p.set(1, 0.5, 0), new Vector3(), new Vector3(0, 1, 0), 0.2)).toBe(false)
  })
})

/** A model with one spring chain sticking out sideways from a body bone. */
function rig(): { model: Group; tip: Bone } {
  const model = new Group()
  const body = new Bone()
  body.name = 'J_Bip_C_Hips'
  const spring = new Bone()
  spring.name = 'Spring_Skirt0_1'
  const tip = new Bone()
  tip.name = 'Spring_Skirt0_end'
  tip.position.set(1, 0, 0)
  spring.add(tip)
  body.add(spring)
  model.add(body)
  model.updateMatrixWorld(true)
  return { model, tip }
}

describe('SpringBones', () => {
  it('finds the chains by name', () => {
    expect(new SpringBones(rig().model).count).toBe(1)
  })

  it('lets a chain sag under gravity and keeps its length', () => {
    const { model, tip } = rig()
    const springs = new SpringBones(model, {
      chains: [['Skirt', { stiffness: 0, gravity: 1, drag: 0.5, radius: 0 }]],
      colliders: [],
    })
    for (let i = 0; i < 120; i++) springs.update(1 / 60)
    const p = tip.getWorldPosition(new Vector3())
    expect(p.y).toBeLessThan(-0.5)
    expect(p.length()).toBeCloseTo(1, 5)
  })

  it('stays at rest without forces', () => {
    const { model, tip } = rig()
    const springs = new SpringBones(model, {
      chains: [['Skirt', { stiffness: 1, gravity: 0, drag: 0.5, radius: 0 }]],
      colliders: [],
    })
    for (let i = 0; i < 60; i++) springs.update(1 / 60)
    const p = tip.getWorldPosition(new Vector3())
    expect(p.x).toBeCloseTo(1, 5)
    expect(p.y).toBeCloseTo(0, 5)
  })
})
