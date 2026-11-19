/**
 * Watertightness check for meshes, tolerant to T-junctions (test helper).
 *
 * Layer: render (no Three.js import). Used by tests only.
 *
 * In a closed, consistently wound mesh, every directed triangle edge is
 * matched by edges running the opposite way along the same line, possibly
 * split differently (T-junctions). For each line, forward edges add +1 and
 * backward edges -1 over their extent; any stretch with a non-zero sum is an
 * open border (a gap or a missing face).
 */
import type { MeshData } from './mesher'

/** One stretch of an edge line that is not closed. */
export interface OpenStretch {
  readonly from: readonly [number, number, number]
  readonly to: readonly [number, number, number]
}

/**
 * Open stretches of the combined meshes. `ignore` filters stretches that are
 * expected to be open (e.g. the map floor, which is never meshed).
 */
export function openStretches(
  meshes: readonly MeshData[],
  ignore: (a: readonly number[], b: readonly number[]) => boolean = () => false,
): OpenStretch[] {
  const q = (v: number): number => Math.round(v * 1e4) / 1e4
  const lines = new Map<string, { p: number[]; d: number[]; spans: [number, number, number][] }>()

  for (const m of meshes) {
    const vertex = (i: number): number[] => [0, 1, 2].map((c) => m.positions[i * 3 + c] ?? 0)
    for (let t = 0; t < m.indices.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = vertex(m.indices[t + e] ?? 0)
        const b = vertex(m.indices[t + ((e + 1) % 3)] ?? 0)
        // Order the endpoints lexicographically so both orientations of the
        // same edge produce exactly the same line key.
        const forward =
          a[0] !== b[0]
            ? (a[0] ?? 0) < (b[0] ?? 0)
            : a[1] !== b[1]
              ? (a[1] ?? 0) < (b[1] ?? 0)
              : (a[2] ?? 0) < (b[2] ?? 0)
        const lo = forward ? a : b
        const hi = forward ? b : a
        const len = Math.hypot(...hi.map((v, c) => v - (lo[c] ?? 0)))
        if (len < 1e-9) continue
        const dir = hi.map((v, c) => q((v - (lo[c] ?? 0)) / len))
        const s0 = lo.reduce((acc, v, c) => acc + v * (dir[c] ?? 0), 0)
        const p0 = lo.map((v, c) => q(v - s0 * (dir[c] ?? 0)) + 0)
        const key = `${dir.join(',')}|${p0.join(',')}`
        const entry = lines.get(key) ?? { p: p0, d: dir, spans: [] }
        entry.spans.push([s0, s0 + len, forward ? 1 : -1])
        lines.set(key, entry)
      }
    }
  }

  const open: OpenStretch[] = []
  for (const { p, d, spans } of lines.values()) {
    const events = new Map<number, number>()
    for (const [s0, s1, w] of spans) {
      events.set(q(s0), (events.get(q(s0)) ?? 0) + w)
      events.set(q(s1), (events.get(q(s1)) ?? 0) - w)
    }
    const ts = [...events.keys()].sort((x, y) => x - y)
    let sum = 0
    for (let i = 0; i < ts.length - 1; i++) {
      sum += events.get(ts[i] ?? 0) ?? 0
      const t0 = ts[i] ?? 0
      const t1 = ts[i + 1] ?? 0
      if (sum === 0 || t1 - t0 < 1e-6) continue
      const from = p.map((v, c) => v + t0 * (d[c] ?? 0))
      const to = p.map((v, c) => v + t1 * (d[c] ?? 0))
      if (!ignore(from, to))
        open.push({ from: from as [number, number, number], to: to as [number, number, number] })
    }
  }
  return open
}
