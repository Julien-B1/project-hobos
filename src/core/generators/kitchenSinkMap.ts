/**
 * Kitchen-sink map: a hand-made (not procedural) sample board that holds
 * every element the engine supports, each in its own plot, to check them
 * all at a glance.
 *
 * Layer: core (pure TypeScript). Deterministic, fixed coordinates
 * ({@link KITCHEN_SINK_LAYOUT}). 40 x 32 cells (one cell = one 5 ft battle-map
 * square), flat grass at surface level 6, water surface at level 5.
 *
 * Three rows (x right, z down):
 *
 * ```
 *  row A, z 2..7    ground swatches:  dirt | sand | rock | stone | path | mound (wedges)
 *  row B, z 12..17  trees and builds: oak  birch  pine  bush | rock arch | brick ramp + platform
 *  row C, z 20..31  relief and water: hill + cave | pond + dock | canal, path, wooden bridge
 * ```
 *
 * Natural relief (hill, cave, rock arch) uses terrain materials, drawn
 * faceted: slopes all around, vertical faces only around the openings (see
 * the opening rule in `terrainSurface.ts`). Built structures use block
 * materials (wood, stone bricks) and keep sharp edges.
 */
import { Material } from '../materials'
import { Orientation, Shape, shapeForCornerMask } from '../shapes'
import { AIR, packVoxel, type Voxel } from '../voxel'
import { VoxelMap } from '../voxelMap'
import type { TreeKind } from '../trees'
import { growTree } from './treeGrowth'

/** Inclusive integer range. */
interface Range {
  readonly min: number
  readonly max: number
}

const r = (min: number, max: number): Range => ({ min, max })

/** A rectangular plot of ground with its top material. */
interface Swatch {
  readonly material: number
  readonly x: Range
  readonly z: Range
}

/** Exact layout of the kitchen-sink map (cells and surface levels, ranges inclusive). */
export const KITCHEN_SINK_LAYOUT = {
  size: { width: 40, depth: 32 },
  /** Base ground surface level (top voxel at 5). */
  groundTop: 6,
  /** Water surface level of the pond and the canal. */
  waterTop: 5,

  /** Row A: ground swatches. */
  swatches: [
    { material: Material.DIRT, x: r(2, 6), z: r(2, 7) },
    { material: Material.SAND, x: r(8, 12), z: r(2, 7) },
    { material: Material.ROCK, x: r(14, 18), z: r(2, 7) },
    { material: Material.STONE, x: r(20, 24), z: r(2, 7) },
    { material: Material.PATH, x: r(26, 30), z: r(2, 7) },
  ] as readonly Swatch[],
  /** Row A: low grass mound, slopes on its sides and corner wedges around. */
  mound: { x: r(34, 36), z: r(4, 5) },

  /** Row B: one tree of each kind. */
  trees: [
    { kind: 'oak', x: 3, z: 15 },
    { kind: 'birch', x: 9, z: 15 },
    { kind: 'pine', x: 15, z: 15 },
    { kind: 'bush', x: 20, z: 15 },
  ] as readonly { readonly kind: TreeKind; readonly x: number; readonly z: number }[],
  /** Row B: natural rock arch, a rock ridge with a passage through it along Z. */
  arch: { x: r(23, 28), z: r(13, 16), top: 13, passage: r(25, 26), ceilingLevel: 10 },
  /** Row B: stone-brick platform reached by a ramp of brick slopes climbing east. */
  platform: { x: r(34, 38), z: r(13, 16), top: 10 },
  ramp: { x: r(30, 33), z: r(14, 15) },

  /** Row C: grassy hill with a rock core, crossed by a cave along X. */
  hill: { x: r(2, 11), z: r(22, 30), top: 13 },
  cave: { z: r(25, 27), floorTop: 6, ceilingLevel: 10 },
  /** Row C: round pond (centre, radius in cells) with a wooden dock. */
  pond: { cx: 19, cz: 26, radius: 6 },
  dock: { x: r(14, 17), z: 26 },
  /** Row C: canal along Z with a path on its west bank, crossed by a wooden bridge. */
  canal: { x: r(33, 35), z: r(20, 31), profile: [4, 2, 4] as readonly number[] },
  path: { x: r(31, 32), z: r(20, 31) },
  bridge: { x: r(31, 36), z: r(24, 25), deckLevel: 8 },
  bridgeRampWest: { x: r(28, 30) },
  bridgeRampEast: { x: r(37, 39) },
}

const v = (material: number, shape: number = Shape.FULL, orientation = 0): Voxel =>
  packVoxel(material, shape, orientation)

/** Build the kitchen-sink map. Deterministic. */
export function createKitchenSinkMap(): VoxelMap {
  const L = KITCHEN_SINK_LAYOUT
  const map = new VoxelMap()
  const { width, depth } = L.size

  // 1. Ground with its swatches, pond and canal: one surface level per column.
  for (let z = 0; z < depth; z++)
    for (let x = 0; x < width; x++) {
      let h = L.groundTop
      let top: number = Material.GRASS
      for (const s of L.swatches) if (inside(x, z, s.x, s.z)) top = s.material
      if (inside(x, z, L.path.x, L.path.z)) top = Material.PATH
      if (inside(x, z, L.canal.x, L.canal.z)) h = L.canal.profile[x - L.canal.x.min] ?? h
      const d = Math.hypot(x - L.pond.cx, z - L.pond.cz)
      if (d < L.pond.radius) h = d < 2.5 ? 2 : d < 4 ? 3 : d < 5 ? 4 : 5
      if (h < L.groundTop) top = Material.SAND
      column(map, x, z, h, top)
      for (let y = h; y < L.waterTop; y++) map.set(x, y, z, v(Material.WATER))
    }

  // 2. Mound: a platform one level up, wedges around it (slopes, corners).
  const isMound = (x: number, z: number): boolean => inside(x, z, L.mound.x, L.mound.z)
  // Cells sharing each top corner (c00, c10, c11, c01) besides the cell itself.
  const cornerCells = [
    [
      [-1, 0],
      [0, -1],
      [-1, -1],
    ],
    [
      [1, 0],
      [0, -1],
      [1, -1],
    ],
    [
      [1, 0],
      [0, 1],
      [1, 1],
    ],
    [
      [-1, 0],
      [0, 1],
      [-1, 1],
    ],
  ] as const
  for (let z = L.mound.z.min - 1; z <= L.mound.z.max + 1; z++)
    for (let x = L.mound.x.min - 1; x <= L.mound.x.max + 1; x++) {
      if (isMound(x, z)) {
        map.set(x, L.groundTop, z, v(Material.GRASS))
        continue
      }
      let mask = 0
      cornerCells.forEach((cells, corner) => {
        if (cells.some(([dx, dz]) => isMound(x + dx, z + dz))) mask |= 1 << corner
      })
      const wedge = shapeForCornerMask(mask)
      if (wedge) map.set(x, L.groundTop, z, v(Material.GRASS, wedge.shape, wedge.orientation))
    }

  // 3. Trees.
  L.trees.forEach((t, i) => {
    growTree(map, t.x, L.groundTop, t.z, t.kind, (i * 0.37) % 1)
  })

  // 4. Rock arch: a ridge, then the passage carved through it.
  for (let z = L.arch.z.min; z <= L.arch.z.max; z++)
    for (let x = L.arch.x.min; x <= L.arch.x.max; x++) {
      column(map, x, z, L.arch.top, Material.ROCK, Material.ROCK)
      if (x >= L.arch.passage.min && x <= L.arch.passage.max) {
        for (let y = L.groundTop; y < L.arch.ceilingLevel; y++) map.set(x, y, z, AIR)
        map.set(x, L.groundTop - 1, z, v(Material.PATH))
      }
    }
  const brick = v(Material.STONE_BRICK)

  // 5. Brick platform and its ramp of slopes (high side east).
  for (let z = L.platform.z.min; z <= L.platform.z.max; z++)
    for (let x = L.platform.x.min; x <= L.platform.x.max; x++)
      for (let y = L.groundTop; y < L.platform.top; y++) map.set(x, y, z, brick)
  for (let k = 0; k <= L.ramp.x.max - L.ramp.x.min; k++)
    for (let z = L.ramp.z.min; z <= L.ramp.z.max; z++) {
      const x = L.ramp.x.min + k
      for (let y = L.groundTop; y < L.groundTop + k; y++) map.set(x, y, z, brick)
      map.set(x, L.groundTop + k, z, v(Material.STONE_BRICK, Shape.SLOPE, Orientation.EAST))
    }

  // 6. Hill and the cave through it.
  for (let z = L.hill.z.min; z <= L.hill.z.max; z++)
    for (let x = L.hill.x.min; x <= L.hill.x.max; x++) {
      column(map, x, z, L.hill.top, Material.GRASS, Material.ROCK)
      if (z >= L.cave.z.min && z <= L.cave.z.max) {
        for (let y = L.cave.floorTop; y < L.cave.ceilingLevel; y++) map.set(x, y, z, AIR)
        map.set(x, L.cave.floorTop - 1, z, v(Material.PATH))
      }
    }

  // 7. Wooden bridge over the path and the canal: ramps, then the deck.
  const wood = v(Material.WOOD)
  for (let k = 0; k <= L.bridgeRampWest.x.max - L.bridgeRampWest.x.min; k++)
    for (let z = L.bridge.z.min; z <= L.bridge.z.max; z++) {
      const west = L.bridgeRampWest.x.min + k
      const east = L.bridgeRampEast.x.max - k
      for (let y = L.groundTop; y < L.groundTop + k; y++) {
        map.set(west, y, z, wood)
        map.set(east, y, z, wood)
      }
      map.set(west, L.groundTop + k, z, v(Material.WOOD, Shape.SLOPE, Orientation.EAST))
      map.set(east, L.groundTop + k, z, v(Material.WOOD, Shape.SLOPE, Orientation.WEST))
    }
  for (let z = L.bridge.z.min; z <= L.bridge.z.max; z++)
    for (let x = L.bridge.x.min; x <= L.bridge.x.max; x++) map.set(x, L.bridge.deckLevel, z, wood)

  // 8. Dock: planks on the water surface of the pond.
  for (let x = L.dock.x.min; x <= L.dock.x.max; x++) map.set(x, L.waterTop, L.dock.z, wood)
  return map
}

/** Whether (x, z) lies in the box `xs` x `zs`. */
function inside(x: number, z: number, xs: Range, zs: Range): boolean {
  return x >= xs.min && x <= xs.max && z >= zs.min && z <= zs.max
}

/**
 * Fill column (x, z) up to surface level `top`: `core` voxels, two dirt
 * voxels (unless the core is rock), `topMaterial` on top.
 */
function column(
  map: VoxelMap,
  x: number,
  z: number,
  top: number,
  topMaterial: number,
  core: number = Material.STONE,
): void {
  const under = core === Material.STONE ? Material.DIRT : core
  for (let y = 0; y < top; y++) {
    const m = y === top - 1 ? topMaterial : y >= top - 3 ? under : core
    map.set(x, y, z, v(m))
  }
}
