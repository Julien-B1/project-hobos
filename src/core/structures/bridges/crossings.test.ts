import { describe, expect, it } from 'vitest'
import type { BridgeSpan } from './bridgeSpan'
import { CROSSING_RULES, crossingCandidates, pickCrossing } from './crossings'
import type { CrossingSite } from './riverCrossing'

const site = (length: number, waterWidth: number, depth: number, rise = 1): CrossingSite => {
  const span: BridgeSpan = {
    axis: 'x',
    from: 4,
    to: 4 + length - 1,
    side: 8,
    width: 1,
    deckY: 10 + rise - 1,
    bedLevel: 10 - depth,
    waterLevel: 10,
  }
  return { span, waterWidth, depth, flush: true }
}

describe('crossings', () => {
  it('offers light crossings on narrow, shallow streams only', () => {
    const narrow = crossingCandidates(site(5, 3, 1)).map((r) => r.kind)
    expect(narrow).toContain('fallen-log')
    expect(narrow).toContain('stepping-stones')
    const wide = crossingCandidates(site(14, 9, 3)).map((r) => r.kind)
    expect(wide).not.toContain('fallen-log')
    expect(wide).not.toContain('stepping-stones')
    expect(wide).toContain('stone-arch-bridge')
  })

  it('needs height above the water for a rope bridge', () => {
    expect(crossingCandidates(site(10, 6, 3, 1)).map((r) => r.kind)).not.toContain('rope-bridge')
    expect(crossingCandidates(site(10, 6, 3, 4)).map((r) => r.kind)).toContain('rope-bridge')
  })

  it('picks deterministically among the candidates, and varies with the seed', () => {
    const s = site(8, 4, 2)
    const kinds = new Set<string>()
    for (let seed = 0; seed < 40; seed++) {
      const a = pickCrossing(s, seed)
      expect(a).toEqual(pickCrossing(s, seed))
      if (a) {
        expect(crossingCandidates(s)).toContain(a)
        kinds.add(a.kind)
      }
    }
    expect(kinds.size).toBeGreaterThan(2)
    expect(CROSSING_RULES.length).toBe(7)
  })
})
