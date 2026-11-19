import { describe, expect, it } from 'vitest'
import {
  clamp,
  dampTowards,
  groundAxes,
  nextSnapYaw,
  orbitPosition,
  worldPerPixel,
} from './cameraMath'

const DEG = Math.PI / 180

describe('orbitPosition', () => {
  it('places the camera on +Z, above the target, at yaw 0', () => {
    const p = orbitPosition({ x: 1, y: 2, z: 3 }, 0, 30 * DEG, 10)
    expect(p.x).toBeCloseTo(1)
    expect(p.y).toBeCloseTo(2 + 5)
    expect(p.z).toBeCloseTo(3 + 10 * Math.cos(30 * DEG))
  })

  it('keeps the requested distance to the target', () => {
    const t = { x: 4, y: 0, z: -2 }
    const p = orbitPosition(t, 1.234, 40 * DEG, 25)
    expect(Math.hypot(p.x - t.x, p.y - t.y, p.z - t.z)).toBeCloseTo(25)
  })
})

describe('groundAxes', () => {
  it('looks towards -Z with +X on the right at yaw 0', () => {
    const { forward, right } = groundAxes(0)
    expect(forward.x).toBeCloseTo(0)
    expect(forward.z).toBeCloseTo(-1)
    expect(right.x).toBeCloseTo(1)
    expect(right.z).toBeCloseTo(0)
  })

  it('forward points from the camera to the target for any yaw', () => {
    const yaw = 2.1
    const cam = orbitPosition({ x: 0, y: 0, z: 0 }, yaw, 0, 1)
    const { forward } = groundAxes(yaw)
    expect(forward.x).toBeCloseTo(-cam.x)
    expect(forward.z).toBeCloseTo(-cam.z)
  })
})

describe('nextSnapYaw', () => {
  const step = 45 * DEG

  it('moves one full step from an aligned goal', () => {
    expect(nextSnapYaw(0, step, 1)).toBeCloseTo(step)
    expect(nextSnapYaw(step, step, -1)).toBeCloseTo(0)
  })

  it('snaps an off-grid goal to the next grid line in the direction', () => {
    expect(nextSnapYaw(10 * DEG, step, 1)).toBeCloseTo(45 * DEG)
    expect(nextSnapYaw(10 * DEG, step, -1)).toBeCloseTo(0)
    expect(nextSnapYaw(-10 * DEG, step, -1)).toBeCloseTo(-45 * DEG)
  })
})

describe('dampTowards', () => {
  it('does not move with dt = 0 and converges over time', () => {
    expect(dampTowards(0, 10, 12, 0)).toBe(0)
    expect(dampTowards(0, 10, 12, 10)).toBeCloseTo(10)
  })

  it('is frame-rate independent', () => {
    const oneStep = dampTowards(0, 1, 5, 0.1)
    const twoSteps = dampTowards(dampTowards(0, 1, 5, 0.05), 1, 5, 0.05)
    expect(twoSteps).toBeCloseTo(oneStep)
  })
})

describe('clamp / worldPerPixel', () => {
  it('clamps into range', () => {
    expect(clamp(5, 0, 3)).toBe(3)
    expect(clamp(-1, 0, 3)).toBe(0)
    expect(clamp(2, 0, 3)).toBe(2)
  })

  it('matches the frustum height at the target distance', () => {
    // fov 90 deg: frustum height = 2 * d.
    expect(worldPerPixel(10, 90, 200)).toBeCloseTo(0.1)
  })
})
