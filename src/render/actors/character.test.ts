import { describe, expect, it } from 'vitest'
import { RUN_SPEED, WALK_SPEED, gaitFor } from './character'

describe('gaitFor', () => {
  it('walks 1 or 2 cells and runs farther', () => {
    expect(gaitFor(0)).toBe('idle')
    expect(gaitFor(1)).toBe('walk')
    expect(gaitFor(2)).toBe('walk')
    expect(gaitFor(3)).toBe('run')
  })

  it('runs 1.8 times as fast as it walks', () => {
    expect(RUN_SPEED / WALK_SPEED).toBeCloseTo(1.8)
  })
})
