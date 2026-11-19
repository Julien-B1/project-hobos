/**
 * Scatter mesher: small decorations on the ground that make a map look
 * alive (grass tufts, flowers, fallen leaves, pebbles, rocks, reeds, algae).
 *
 * Layer: render (no Three.js import, unit-tested). Decoration only: nothing
 * here exists in the voxel map, game logic never sees it, picking ignores
 * it. Everything is derived deterministically from the voxels (hash of the
 * cell), so a map always gets the same scatter, and an edit rebuilds it with
 * the chunk.
 *
 * For every terrain run top owned by the chunk (not covered by a block or a
 * trunk), a few random points of the cell get items chosen from the ground
 * material at that point (the blended corner weights), the water depth and
 * the nearby trees. Items stand on the faceted surface (`facetHeightAt`).
 *
 * Two outputs:
 * - **cards** (scatter layer): alpha-tested cards from the foliage atlas
 *   (`leafTexture.ts`). All 4 vertices sit at the item's base point; the
 *   scatter shader spreads them. Vertex data (`MeshData.weights`): texture
 *   coordinates (u, v), corner (x in [-1, 1], y in [0, 1] upright or [-1, 1]
 *   flat), half width, height (world units), sway amount, mode (0 upright,
 *   turning around the vertical to face the camera; 1 flat on the ground,
 *   corners already rotated).
 * - **props** (props layer): small rocks (jittered icosahedra): smooth
 *   pebbles and a few stones on rocky ground only, and faceted boulders at
 *   the foot of rock faces (cliffs, cave mouths, arches).
 *
 * Density is deliberately low: one candidate point per cell, most left
 * empty.
 */
import type { Chunk } from '@/core/chunk'
import { CHUNK_SIZE, VOXEL_HEIGHT } from '@/core/coords'
import { Material } from '@/core/materials'
import { hash01 } from '@/core/noise'
import {
  TERRAIN_CHANNELS,
  TerrainField,
  facetHeightAt,
  type FacetCorners,
  type TerrainRun,
} from '@/core/terrainSurface'
import { CANOPY_REACH, findTrunks, treeKind, type Trunk } from '@/core/trees'
import { isAir, materialOf, type Voxel } from '@/core/voxel'
import type { VoxelMap } from '@/core/voxelMap'
import { ATLAS_CELLS, AtlasRow, ScatterCell } from '../leafTexture'
import { MeshBuilder, normalize, srgbHexToLinear, type Vec3 } from './meshBuilder'
import type { MeshData } from './mesher'
import { waterSurfaceNear } from './terrainMesher'

/** Output of {@link ScatterMesher.mesh}. */
export interface ScatterMeshes {
  readonly cards: MeshData
  readonly props: MeshData
}

/** Card modes, see the module comment. */
const UPRIGHT = 0
const FLAT = 1

/** Random points tried per cell. */
const POINTS_PER_CELL = 1

/** Channels of `TERRAIN_CHANNELS`. */
const GRASS = TERRAIN_CHANNELS.indexOf(Material.GRASS)
const DIRT = TERRAIN_CHANNELS.indexOf(Material.DIRT)
const ROCK = TERRAIN_CHANNELS.indexOf(Material.ROCK)
const STONE = TERRAIN_CHANNELS.indexOf(Material.STONE)

/** Facets rising more than this (levels, between corners) get no upright cards. */
const STEEP_RISE = 4

/** Colours (sRGB hex). */
const FALLEN_LEAF_TINTS = [0x8a5a2b, 0xb07a2a, 0x9c8a3a, 0x6f6a2c]
const ROCK_TINTS = [0x7d7770, 0x8f8a82, 0x6b665f]

/** Mesher for ground decorations; see the module comment. */
export class ScatterMesher {
  /** @param isTerrain Which voxels are terrain (the faceted ground). */
  constructor(private readonly isTerrain: (voxel: Voxel) => boolean) {}

  /** Mesh the decorations of one chunk. */
  mesh(map: VoxelMap, chunk: Chunk): ScatterMeshes {
    const ox = chunk.cx * CHUNK_SIZE
    const oy = chunk.cy * CHUNK_SIZE
    const oz = chunk.cz * CHUNK_SIZE
    const field = new TerrainField(map, this.isTerrain, oy - CHUNK_SIZE, oy + 2 * CHUNK_SIZE - 1)
    const trunks = findTrunks(
      map,
      ox - CANOPY_REACH,
      ox + CHUNK_SIZE - 1 + CANOPY_REACH,
      oy - 4,
      oy + 2 * CHUNK_SIZE,
      oz - CANOPY_REACH,
      oz + CHUNK_SIZE - 1 + CANOPY_REACH,
    )
    const cards = new MeshBuilder()
    const props = new MeshBuilder()
    for (let z = oz; z < oz + CHUNK_SIZE; z++) {
      for (let x = ox; x < ox + CHUNK_SIZE; x++) {
        for (const run of field.runsAt(x, z)) {
          if (!Number.isFinite(run.top) || run.topY < oy || run.topY >= oy + CHUNK_SIZE) continue
          const above = map.get(x, run.topY + 1, z)
          if (!isAir(above) && materialOf(above) !== Material.WATER) continue // covered
          const cell: Cell = {
            x,
            z,
            run,
            heights: field.cornerHeights(x, z, run),
            weights: field.cornerWeights(x, z, run),
            water: waterSurfaceNear(map, x, z, run),
            tree: nearestTree(trunks, x, z, run.topY),
          }
          for (let i = 0; i < POINTS_PER_CELL; i++) this.decorate(cards, props, cell, i)
          this.boulders(props, map, field, cell, !isAir(above))
        }
      }
    }
    return { cards: cards.toMeshData(), props: props.toMeshData() }
  }

  /**
   * Boulders at the foot of rock faces: for each edge of the cell beyond
   * which rock rises by at least {@link BOULDER_RISE} levels (a cliff, the
   * side of a cave mouth or of an arch), a faceted block may rest against
   * it, sunk into the ground. They break the straight lines of the terrain
   * around openings and cliffs without changing it: the ground, the cut and
   * picking keep the exact base geometry. Under water (`wet`) none.
   */
  private boulders(
    props: MeshBuilder,
    map: VoxelMap,
    field: TerrainField,
    cell: Cell,
    wet: boolean,
  ): void {
    if (wet) return
    const { x, z, run, heights } = cell
    const roofed = field.runsAt(x, z).some((r) => r.bottom > run.topY)
    CELL_EDGES.forEach((edge, e) => {
      const nx = x + edge.dx
      const nz = z + edge.dz
      const rises = field
        .runsAt(nx, nz)
        .some((r) => r.bottom <= run.top && r.top - run.top >= BOULDER_RISE)
      if (!rises) return
      const face = materialOf(map.get(nx, run.topY + 1, nz))
      if (face !== Material.ROCK && face !== Material.STONE) return
      const h = (k: number): number => hash01(x * 92821 + e, z * 31 + run.topY, 701 + k)
      // Fewer and smaller inside a cave or under an arch, to keep the way clear.
      if (h(0) > (roofed ? 0.3 : 0.65)) return
      const t = 0.15 + 0.7 * h(1)
      const inset = 0.12
      const fx = edge.a[0] + (edge.b[0] - edge.a[0]) * t - edge.dx * inset
      const fz = edge.a[1] + (edge.b[1] - edge.a[1]) * t - edge.dz * inset
      const ground = facetHeightAt(heights, fx, fz) * VOXEL_HEIGHT
      const radius = roofed ? 0.2 + 0.12 * h(2) : 0.3 + 0.3 * h(2)
      rock(props, [x + fx, ground, z + fz], radius, (k) => h(10 + k), true)
    })
  }

  /** Place the items of random point `i` of a cell. */
  private decorate(cards: MeshBuilder, props: MeshBuilder, cell: Cell, i: number): void {
    const { x, z, run, heights } = cell
    const h = (k: number): number => hash01(x * 92821 + i * 7, z * 31 + run.topY, 601 + k)
    const fx = 0.12 + 0.76 * h(0)
    const fz = 0.12 + 0.76 * h(1)
    const ground = facetHeightAt(heights, fx, fz) * VOXEL_HEIGHT
    const base: Vec3 = [x + fx, ground, z + fz]
    const depth = cell.water === null ? -Infinity : cell.water * VOXEL_HEIGHT - ground
    const roll = h(2)
    const steep = Math.max(...heights) - Math.min(...heights) > STEEP_RISE

    if (depth > 0.35) {
      // Under water: algae on the bed.
      if (roll < 0.07) {
        const tall = Math.min(depth * 0.8, 0.5 + 0.4 * h(3))
        upright(cards, base, ScatterCell.ALGAE, 0.35 + 0.15 * h(4), tall, 0.5, h(5))
      }
      return
    }
    if (depth > -0.4) {
      // Shore and shallows: reeds.
      if (roll < 0.14 && !steep) {
        upright(cards, base, ScatterCell.REEDS, 0.35 + 0.15 * h(4), 1.0 + 0.5 * h(3), 0.6, h(5))
      }
      return
    }

    const channel = dominantChannel(cell.weights, fx, fz)
    // Fallen leaves: only right under a tree's canopy, on soft ground.
    if (cell.tree && roll < 0.25 && channel !== ROCK && channel !== STONE) {
      fallenLeaf(cards, base, cell.tree, h)
      return
    }
    const r = cell.tree ? (roll - 0.25) / 0.75 : roll
    if (channel === GRASS) {
      if (steep) return
      if (r < 0.025) upright(cards, base, ScatterCell.FLOWERS, 0.3, 0.45 + 0.2 * h(3), 1, h(5))
      else if (r < 0.14)
        upright(cards, base, ScatterCell.GRASS, 0.3 + 0.12 * h(4), 0.4 + 0.3 * h(3), 1, h(5))
    } else if (channel === DIRT) {
      if (r < 0.04 && !steep) upright(cards, base, ScatterCell.GRASS, 0.22, 0.3, 1, h(5))
    } else if (channel === ROCK || channel === STONE) {
      // Stones only on rocky ground.
      if (r < 0.03) rock(props, base, 0.3 + 0.25 * h(3), h)
      else if (r < 0.2) rock(props, base, 0.05 + 0.08 * h(3), h)
    }
  }
}

/** The 4 edges of a cell: neighbour offset and the edge's two ends (cell-local x, z). */
const CELL_EDGES = [
  { dx: 1, dz: 0, a: [1, 0], b: [1, 1] },
  { dx: -1, dz: 0, a: [0, 0], b: [0, 1] },
  { dx: 0, dz: 1, a: [0, 1], b: [1, 1] },
  { dx: 0, dz: -1, a: [0, 0], b: [1, 0] },
] as const

/** Rise (levels) of a neighbouring rock face from which boulders gather at its foot. */
const BOULDER_RISE = 4

/** What the decoration of a cell depends on. */
interface Cell {
  readonly x: number
  readonly z: number
  readonly run: TerrainRun
  readonly heights: FacetCorners
  readonly weights: (readonly number[])[]
  /** Water surface level near the run, or null. */
  readonly water: number | null
  /** A tree whose canopy covers the cell, or null. */
  readonly tree: Trunk | null
}

/**
 * A real tree (not a bush) within 2 cells whose top is above the run: the
 * cell lies under its canopy.
 */
function nearestTree(trunks: readonly Trunk[], x: number, z: number, topY: number): Trunk | null {
  let best: Trunk | null = null
  let bestDistance = 2
  for (const t of trunks) {
    if (t.topY <= topY || treeKind(t) === 'bush') continue
    const d = Math.hypot(t.x - x, t.z - z)
    if (d <= bestDistance) {
      best = t
      bestDistance = d
    }
  }
  return best
}

/** Channel with the largest weight at (fx, fz), bilinear between the corners. */
function dominantChannel(weights: (readonly number[])[], fx: number, fz: number): number {
  const k = [(1 - fx) * (1 - fz), fx * (1 - fz), fx * fz, (1 - fx) * fz]
  let best = 0
  let bestWeight = -1
  for (let c = 0; c < TERRAIN_CHANNELS.length; c++) {
    let w = 0
    for (let corner = 0; corner < 4; corner++) w += (weights[corner]?.[c] ?? 0) * (k[corner] ?? 0)
    if (w > bestWeight) {
      best = c
      bestWeight = w
    }
  }
  return best
}

/** Texture coordinates of an atlas cell (u0, v0) and the cell size. */
function atlasCell(row: number, cell: number): { u0: number; v0: number; size: number } {
  const size = 1 / ATLAS_CELLS
  return { u0: cell * size, v0: row * size, size }
}

/**
 * An upright card from the scatter row, rooted at `base`: `half` width,
 * `height` (world units), wind `sway` (0..1), tint brightness from `t`.
 */
function upright(
  out: MeshBuilder,
  base: Vec3,
  cell: number,
  half: number,
  height: number,
  sway: number,
  t: number,
): void {
  const { u0, v0, size } = atlasCell(AtlasRow.SCATTER, cell)
  const k = 0.88 + 0.24 * t
  const color: Vec3 = [k, k, k]
  const corners = [
    [-1, 0, u0, v0],
    [1, 0, u0 + size, v0],
    [1, 1, u0 + size, v0 + size],
    [-1, 1, u0, v0 + size],
  ] as const
  out.rawPolygon(
    [base, base, base, base],
    [UP, UP, UP, UP],
    [color, color, color, color],
    corners.map(([cx, cy, u, v]) => [u, v, cx, cy, half, height, sway, UPRIGHT]),
  )
}

/** Straight up, for card normals (the shader lights cards as ground). */
const UP: Vec3 = [0, 1, 0]

/** A flat leaf cluster on the ground under a tree, tinted like dead leaves. */
function fallenLeaf(out: MeshBuilder, base: Vec3, tree: Trunk, h: (k: number) => number): void {
  const row =
    tree.foliage === Material.BIRCH_LEAVES
      ? AtlasRow.BIRCH
      : tree.foliage === Material.NEEDLES
        ? AtlasRow.NEEDLES
        : AtlasRow.BROADLEAF
  const { u0, v0, size } = atlasCell(row, Math.floor(h(6) * ATLAS_CELLS))
  const tint = srgbHexToLinear(
    FALLEN_LEAF_TINTS[Math.floor(h(7) * FALLEN_LEAF_TINTS.length)] ?? 0x8a5a2b,
  )
  const half = 0.3 + 0.2 * h(8)
  const a = h(9) * Math.PI * 2
  const cs = Math.cos(a)
  const sn = Math.sin(a)
  const corners = [
    [-1, -1, u0, v0],
    [1, -1, u0 + size, v0],
    [1, 1, u0 + size, v0 + size],
    [-1, 1, u0, v0 + size],
  ] as const
  out.rawPolygon(
    [base, base, base, base],
    [UP, UP, UP, UP],
    [tint, tint, tint, tint],
    corners.map(([cx, cy, u, v]) => [u, v, cx * cs - cy * sn, cx * sn + cy * cs, half, 0, 0, FLAT]),
  )
}

/** Icosahedron vertices (unit sphere) and faces. */
const PHI = (1 + Math.sqrt(5)) / 2
const ICO_VERTICES: readonly Vec3[] = (
  [
    [-1, PHI, 0],
    [1, PHI, 0],
    [-1, -PHI, 0],
    [1, -PHI, 0],
    [0, -1, PHI],
    [0, 1, PHI],
    [0, -1, -PHI],
    [0, 1, -PHI],
    [PHI, 0, -1],
    [PHI, 0, 1],
    [-PHI, 0, -1],
    [-PHI, 0, 1],
  ] as const
).map((v) => normalize(v))
const ICO_FACES: readonly (readonly [number, number, number])[] = [
  [0, 11, 5],
  [0, 5, 1],
  [0, 1, 7],
  [0, 7, 10],
  [0, 10, 11],
  [1, 5, 9],
  [5, 11, 4],
  [11, 10, 2],
  [10, 7, 6],
  [7, 1, 8],
  [3, 9, 4],
  [3, 4, 2],
  [3, 2, 6],
  [3, 6, 8],
  [3, 8, 9],
  [4, 9, 5],
  [2, 4, 11],
  [6, 2, 10],
  [8, 6, 7],
  [9, 8, 1],
]

/**
 * A low-poly rock of radius about `radius` (world units) half sunk into the
 * ground at `base`: an icosahedron with jittered vertices, squashed and
 * turned at random, tinted grey. Pebbles are smooth-shaded (rounded);
 * `faceted` boulders are flat-shaded, like cut rock.
 */
function rock(
  out: MeshBuilder,
  base: Vec3,
  radius: number,
  h: (k: number) => number,
  faceted = false,
): void {
  const tints = ROCK_TINTS
  const flatten = 0.5 + 0.3 * h(10)
  const stretch = 0.8 + 0.5 * h(11)
  const a = h(12) * Math.PI * 2
  const cs = Math.cos(a)
  const sn = Math.sin(a)
  const centre: Vec3 = [base[0], base[1] + radius * flatten * 0.35, base[2]]
  const points = ICO_VERTICES.map((v, i): Vec3 => {
    const r =
      radius * (0.8 + 0.4 * hash01(Math.round(base[0] * 977) + i, Math.round(base[2] * 977), 613))
    const px = v[0] * r * stretch
    const pz = v[2] * r
    return [
      centre[0] + px * cs - pz * sn,
      centre[1] + v[1] * r * flatten,
      centre[2] + px * sn + pz * cs,
    ]
  })
  const tint = srgbHexToLinear(tints[Math.floor(h(13) * tints.length)] ?? 0x7d7770)
  for (const [i0, i1, i2] of ICO_FACES) {
    const p0 = points[i0]
    const p1 = points[i1]
    const p2 = points[i2]
    if (!p0 || !p1 || !p2) continue
    const outward: Vec3 = [
      (p0[0] + p1[0] + p2[0]) / 3 - centre[0],
      (p0[1] + p1[1] + p2[1]) / 3 - centre[1],
      (p0[2] + p1[2] + p2[2]) / 3 - centre[2],
    ]
    // Rounded normals, biased upwards: the buried underside must not give
    // the visible sides downward normals (they would get no sky light).
    const normals = [p0, p1, p2].map((p) =>
      normalize([
        p[0] - centre[0],
        Math.max(0, (p[1] - centre[1]) / flatten) + radius * 0.6,
        p[2] - centre[2],
      ]),
    )
    if (faceted) out.polygon([p0, p1, p2], outward, tint)
    else out.smoothPolygon([p0, p1, p2], normals, outward, tint)
  }
}
