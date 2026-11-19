/**
 * Bridges showcase map: a long river crossed once by every kind of
 * crossing, to review them side by side.
 *
 * Layer: core (pure TypeScript). Deterministic, fixed layout
 * ({@link BRIDGES_LAYOUT}): 100 x 24 cells, grass at surface level 6, a
 * river along X with its water surface at level 5. Each crossing slot gets
 * the river width and depth that suit its kind (narrow and shallow for a
 * log or a ford, wide and deep for an arch or a rope bridge), a path
 * across the map leading to it, and the crossing itself, placed as a
 * structure when its kind is registered (slots of kinds not written yet
 * stay plain banks).
 */
import { Material } from '../materials'
import { packVoxel } from '../voxel'
import { VoxelMap } from '../voxelMap'
import type { BridgeSpan } from '../structures/bridges/bridgeSpan'
import { defaultStructureKinds } from '../structures/kinds'
import type { StructureRegistry } from '../structures/registry'
import { StructureSet } from '../structures/structureSet'

/** One crossing slot: kind, position along the river, river width and depth there. */
export interface CrossingSlot {
  /** Structure kind id. */
  readonly kind: string
  /** Cell X of the slot's centre line. */
  readonly x: number
  /** River width at the slot, in cells. */
  readonly riverWidth: number
  /** Water depth at the slot, in levels. */
  readonly depth: number
  /** Width of the crossing (and of its path), in cells. */
  readonly width: number
  /** Ground surface level of the banks at the slot (default: `groundTop`). */
  readonly ground?: number
}

/** Exact layout of the bridges showcase map. */
export const BRIDGES_LAYOUT = {
  size: { width: 100, depth: 24 },
  /** Ground surface level (top voxel at 5). */
  groundTop: 6,
  /** Water surface level of the river. */
  waterTop: 5,
  /** Centre line of the river (cell Z, before its gentle meander). */
  riverZ: 12,
  /** Cells of bank slope on each side of the water. */
  bank: 2,
  /** Crossing slots, west to east. */
  slots: [
    { kind: 'fallen-log', x: 8, riverWidth: 3, depth: 2, width: 1 },
    { kind: 'stepping-stones', x: 21, riverWidth: 5, depth: 1, width: 1 },
    { kind: 'ford', x: 34, riverWidth: 6, depth: 1, width: 3 },
    { kind: 'wood-beam-bridge', x: 47, riverWidth: 6, depth: 3, width: 2 },
    { kind: 'slab-bridge', x: 60, riverWidth: 8, depth: 3, width: 2 },
    { kind: 'stone-arch-bridge', x: 73, riverWidth: 8, depth: 3, width: 3 },
    // A gorge: high banks, so the rope bridge can sag above the water.
    { kind: 'rope-bridge', x: 88, riverWidth: 10, depth: 4, width: 1, ground: 12 },
  ] as readonly CrossingSlot[],
}

/**
 * River half-width (cells), depth (levels) and centre line, and ground
 * level of the banks, at column x, eased between slots.
 */
function riverAt(x: number): { halfWidth: number; depth: number; centre: number; ground: number } {
  const slots = BRIDGES_LAYOUT.slots
  const first = slots[0]
  const last = slots[slots.length - 1]
  let a = first
  let b = last
  for (let i = 0; i + 1 < slots.length; i++) {
    const s = slots[i]
    const n = slots[i + 1]
    if (s && n && x >= s.x && x <= n.x) {
      a = s
      b = n
    }
  }
  if (!a || !b) throw new Error('bridges layout has no slot')
  const t = b.x === a.x ? 0 : Math.min(1, Math.max(0, (x - a.x) / (b.x - a.x)))
  // Hold each slot's profile over a few cells around it, ease in between.
  const eased = smooth(Math.min(1, Math.max(0, (t - 0.25) / 0.5)))
  const width = a.riverWidth + (b.riverWidth - a.riverWidth) * eased
  const depth = a.depth + (b.depth - a.depth) * eased
  const groundA = a.ground ?? BRIDGES_LAYOUT.groundTop
  const groundB = b.ground ?? BRIDGES_LAYOUT.groundTop
  const ground = Math.round(groundA + (groundB - groundA) * eased)
  // A gentle meander, straight at every slot (sin is 0 at slot centres).
  const centre = BRIDGES_LAYOUT.riverZ + Math.sin(t * Math.PI) * 1.5
  return { halfWidth: width / 2, depth, centre, ground }
}

/** Smoothstep on [0, 1]. */
function smooth(t: number): number {
  return t * t * (3 - 2 * t)
}

/** Build the bridges showcase map and its structures. Deterministic. */
export function createBridgesWorld(kinds: StructureRegistry = defaultStructureKinds()): {
  map: VoxelMap
  structures: StructureSet
} {
  const L = BRIDGES_LAYOUT
  const map = new VoxelMap()
  const v = (m: number): number => packVoxel(m)
  /** Surface level of each column, `tops[x][z]`. */
  const tops: number[][] = []

  for (let x = 0; x < L.size.width; x++) {
    const river = riverAt(x)
    const column: number[] = []
    tops.push(column)
    for (let z = 0; z < L.size.depth; z++) {
      const d = Math.abs(z + 0.5 - river.centre)
      // Bed in the channel, bank slopes up to the ground beside it.
      let top: number = river.ground
      if (d <= river.halfWidth) top = L.waterTop - Math.max(1, Math.round(river.depth))
      else if (d <= river.halfWidth + L.bank) {
        const k = (d - river.halfWidth) / L.bank
        top = Math.round(L.waterTop - 1 + (river.ground - L.waterTop + 1) * k)
      }
      const onPath = L.slots.some(
        (s) => Math.abs(x + 0.5 - (s.x + s.width / 2)) <= s.width / 2 + 0.5,
      )
      for (let y = 0; y < top; y++) {
        const surface = y === top - 1
        const material = !surface
          ? y >= top - 3
            ? Material.DIRT
            : Material.STONE
          : top < river.ground
            ? top <= L.waterTop
              ? Material.SAND
              : Material.ROCK
            : onPath
              ? Material.PATH
              : Material.GRASS
        map.set(x, y, z, v(material))
      }
      for (let y = top; y < L.waterTop; y++) map.set(x, y, z, v(Material.WATER))
      column.push(top)
    }
  }

  // Crossings: one structure per slot whose kind exists, bank to bank.
  const structures = new StructureSet()
  for (const slot of L.slots) {
    if (!kinds.has(slot.kind)) continue
    const river = riverAt(slot.x)
    // Ends: the first cells of flat ground on each side, across the slot's width.
    const flat = (z: number): boolean => {
      for (let x = slot.x; x < slot.x + slot.width; x++) {
        if ((tops[x]?.[z] ?? 0) < river.ground) return false
      }
      return true
    }
    let from = Math.floor(river.centre)
    while (from > 0 && !flat(from)) from--
    let to = Math.ceil(river.centre)
    while (to < L.size.depth - 1 && !flat(to)) to++
    const span: BridgeSpan = {
      axis: 'z',
      from,
      to,
      side: slot.x,
      width: slot.width,
      deckY: river.ground - 1,
      bedLevel: L.waterTop - Math.max(1, Math.round(river.depth)),
      waterLevel: L.waterTop,
    }
    structures.place({ id: `crossing-${slot.kind}`, kind: slot.kind, params: span }, map, kinds)
  }
  return { map, structures }
}
