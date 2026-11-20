import { describe, expect, it } from 'vitest'
import { SUPPORT_TOLERANCE, shownUnderCut } from './cutSupport'

describe('shownUnderCut', () => {
  it('shows everything when the cut is off', () => {
    expect(shownUnderCut(100, null)).toBe(true)
  })

  it('shows an object whose support is below the cut, even if it pokes above', () => {
    expect(shownUnderCut(2, 2.5)).toBe(true)
  })

  it('keeps a support exactly at the cut, within the tolerance', () => {
    expect(shownUnderCut(3, 3)).toBe(true)
    expect(shownUnderCut(3 + SUPPORT_TOLERANCE / 2, 3)).toBe(true)
  })

  it('hides an object whose support is cut away', () => {
    expect(shownUnderCut(3.5, 3)).toBe(false)
    expect(shownUnderCut(3 + SUPPORT_TOLERANCE * 2, 3)).toBe(false)
  })
})
