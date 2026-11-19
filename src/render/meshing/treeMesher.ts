/**
 * Tree mesher: draws the trees of the voxel map as trees.
 *
 * Layer: render (no Three.js import, unit-tested). Trees are detected with
 * `core/trees.ts` (a WOOD column topped by LEAVES, plus the LEAVES around).
 * Every voxel is meshed by the chunk that contains it, so edits rebuild
 * trees like anything else:
 * - **bark** (blocks layer): each trunk voxel becomes a segment of a round,
 *   tapered, slightly leaning trunk (7 sides, smooth normals), flared at the
 *   base and sunk a little into the ground; the top voxel carries three
 *   branches reaching into the canopy.
 * - **foliage** (foliage layer): each LEAVES voxel with an exposed face
 *   becomes one leaf card, a square textured with a leaf cluster mask
 *   (`leafTexture.ts`, alpha-tested), jittered in position and size and
 *   pushed out of the canopy. Cards always face the camera (the foliage
 *   shader spreads the 4 vertices, which all sit at the card centre, along
 *   the camera's right and up axes): never seen edge-on, they overlap into a
 *   full, fluffy canopy with leafy edges. In the shadow pass they face the
 *   sun the same way. Vertex colours carry a per-card tint and a fake
 *   ambient occlusion (darker low in the canopy and towards its core).
 *   Hidden interior leaves get no card.
 *
 * Foliage vertex data (`MeshData.weights`, 8 per vertex): leaf texture
 * coordinates (u, v), corner offset in the card plane (x, y, in [-1, 1]),
 * card half size (world units), canopy centre (x, y, z, world units; the
 * shader derives the lighting normal from it). Positions are card centres.
 */
import type { Chunk } from '@/core/chunk'
import { CHUNK_SIZE, VOXEL_HEIGHT } from '@/core/coords'
import { Material, isFoliageMaterial } from '@/core/materials'
import { hash01 } from '@/core/noise'
import {
  CANOPY_REACH,
  MAX_TRUNK_HEIGHT,
  canopyCenter,
  canopyTrunk,
  findTrunks,
  treeKind,
  type TreeKind,
  type Trunk,
} from '@/core/trees'
import { materialOf } from '@/core/voxel'
import type { VoxelMap } from '@/core/voxelMap'
import { MeshBuilder, cross, normalize, srgbHexToLinear, sub, type Vec3 } from './meshBuilder'
import { ATLAS_CELLS, AtlasRow } from '../leafTexture'
import { BlockLook, EMPTY_MESH, type ColorLookup, type MeshData } from './mesher'

/** Output of {@link TreeMesher.mesh}. */
export interface TreeMeshes {
  /** Trunks and branches (blocks layer). */
  readonly bark: MeshData
  /** Leaf cards (foliage layer). */
  readonly foliage: MeshData
  /** Trunks around the chunk, so other meshers can skip their voxels. */
  readonly trunks: readonly Trunk[]
}

/** Sides of a trunk and of a branch. */
const TRUNK_SIDES = 7
const BRANCH_SIDES = 5
/** Radius gained at the very base (root flare), as a factor. */
const ROOT_FLARE = 1.45
/** How far the trunk sinks into the ground and rises into the canopy, in world units. */
const TRUNK_SINK = 0.35
const TRUNK_RISE = 0.6

/** Trunk and bark look of a tree kind. World units. */
interface BarkStyle {
  /** Trunk radius at the base (before the flare), and its random extra. */
  readonly radius: number
  readonly radiusJitter: number
  /** Fraction of the radius lost from base to top. */
  readonly taper: number
  /** Horizontal lean at the top, at most. */
  readonly lean: number
  /** Branches from the trunk top into the canopy, their length and base radius. */
  readonly branches: number
  readonly branchLength: number
  readonly branchRadius: number
  /** Bark colour (sRGB hex) and, for birches, the colour of the dark marks. */
  readonly bark: number
  readonly marks?: number
}

/** Bark styles per tree kind. */
const BARK: Readonly<Record<TreeKind, BarkStyle>> = {
  oak: {
    radius: 0.24,
    radiusJitter: 0.06,
    taper: 0.45,
    lean: 0.35,
    branches: 3,
    branchLength: 1.3,
    branchRadius: 0.07,
    bark: 0x4a3423,
  },
  pine: {
    radius: 0.19,
    radiusJitter: 0.04,
    taper: 0.7,
    lean: 0.12,
    branches: 0,
    branchLength: 0,
    branchRadius: 0,
    bark: 0x5c3a2a,
  },
  birch: {
    radius: 0.13,
    radiusJitter: 0.03,
    taper: 0.35,
    lean: 0.4,
    branches: 2,
    branchLength: 1.0,
    branchRadius: 0.045,
    bark: 0xd8d3c6,
    marks: 0x2e2a26,
  },
  bush: {
    radius: 0.08,
    radiusJitter: 0.02,
    taper: 0.3,
    lean: 0.1,
    branches: 0,
    branchLength: 0,
    branchRadius: 0,
    bark: 0x4a3423,
  },
}

/** Leaf card look of a foliage material: atlas row and card edge length (world units). */
interface CardStyle {
  readonly row: number
  readonly size: number
  readonly sizeJitter: number
}

/** Leaf card styles per foliage material (broad leaves by default). */
const CARDS: Readonly<Record<number, CardStyle>> = {
  [Material.LEAVES]: { row: AtlasRow.BROADLEAF, size: 1.7, sizeJitter: 0.5 },
  [Material.NEEDLES]: { row: AtlasRow.NEEDLES, size: 1.5, sizeJitter: 0.4 },
  [Material.BIRCH_LEAVES]: { row: AtlasRow.BIRCH, size: 1.4, sizeJitter: 0.4 },
}
const DEFAULT_CARD: CardStyle = { row: AtlasRow.BROADLEAF, size: 1.7, sizeJitter: 0.5 }
/** Random offset of a card's centre from its voxel centre, in world units. */
const CARD_JITTER = 0.4
/** How far cards are pushed out of the canopy, in world units. */
const CARD_PUSH = 0.25
/**
 * Vertical stretch of the canopy ellipsoid (occlusion here, normals in the
 * foliage shader, see `FOLIAGE_CANOPY_FLATNESS`).
 */
const CANOPY_FLATNESS = 1.5

/** Largest distance from a card's centre to its corners, in world units. */
export const FOLIAGE_CARD_REACH = ((DEFAULT_CARD.size + DEFAULT_CARD.sizeJitter) / 2) * Math.SQRT2

/** Mesher for tree trunks and foliage; see the module comment. */
export class TreeMesher {
  /** @param colorOf Linear RGB colour of a material id (foliage materials are used). */
  constructor(private readonly colorOf: ColorLookup) {}

  /** Mesh the trees of one chunk. */
  mesh(map: VoxelMap, chunk: Chunk): TreeMeshes {
    if (!hasTreeVoxels(chunk)) return { bark: EMPTY_MESH, foliage: EMPTY_MESH, trunks: [] }
    const ox = chunk.cx * CHUNK_SIZE
    const oy = chunk.cy * CHUNK_SIZE
    const oz = chunk.cz * CHUNK_SIZE
    const last = CHUNK_SIZE - 1
    // Trunks whose voxels are in the chunk (tops up to a trunk length above)
    // or whose canopy may reach into it (tops a few cells around).
    const trunks = findTrunks(
      map,
      ox - CANOPY_REACH,
      ox + last + CANOPY_REACH,
      oy - 8,
      oy + last + MAX_TRUNK_HEIGHT,
      oz - CANOPY_REACH,
      oz + last + CANOPY_REACH,
    )

    const bark = new MeshBuilder()
    for (const t of trunks) {
      const inside = t.x >= ox && t.x <= ox + last && t.z >= oz && t.z <= oz + last
      if (!inside) continue
      for (let y = Math.max(t.baseY, oy); y <= Math.min(t.topY, oy + last); y++) {
        this.trunkSegment(bark, t, y)
      }
    }

    const foliage = new MeshBuilder()
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          const material = materialOf(chunk.get(lx, ly, lz))
          if (!isFoliageMaterial(material)) continue
          const x = ox + lx
          const y = oy + ly
          const z = oz + lz
          if (!isExposed(map, x, y, z)) continue
          this.leafCard(foliage, x, y, z, material, canopyTrunk(trunks, x, y, z))
        }
      }
    }
    return { bark: bark.toMeshData(), foliage: foliage.toMeshData(), trunks }
  }

  /** One trunk voxel as a tapered tube segment (plus branches on the top voxel). */
  private trunkSegment(out: MeshBuilder, t: Trunk, y: number): void {
    const style = BARK[treeKind(t)]
    const levels = t.topY + 1 - t.baseY
    const radius = style.radius + style.radiusJitter * hash01(t.x, t.z, 211)
    const leanX = (hash01(t.x, t.z, 223) - 0.5) * style.lean
    const leanZ = (hash01(t.x, t.z, 227) - 0.5) * style.lean
    // Axis point and radius at a height `level` (voxel levels, fractional).
    const ring = (level: number): { c: Vec3; r: number } => {
      const k = Math.min(1, Math.max(0, (level - t.baseY) / levels))
      const flare = 1 + (ROOT_FLARE - 1) * Math.max(0, 1 - k * levels) // first voxel only
      return {
        c: [t.x + 0.5 + leanX * k * k, level * VOXEL_HEIGHT, t.z + 0.5 + leanZ * k * k],
        r: radius * (1 - style.taper * k) * flare,
      }
    }
    const bottom = ring(y)
    const topRing = ring(y + 1)
    const c0: Vec3 = y === t.baseY ? [bottom.c[0], bottom.c[1] - TRUNK_SINK, bottom.c[2]] : bottom.c
    const c1: Vec3 =
      y === t.topY ? [topRing.c[0], topRing.c[1] + TRUNK_RISE, topRing.c[2]] : topRing.c
    const color = barkColor(style, t.x, y, t.z)
    tube(out, c0, c1, bottom.r, y === t.topY ? topRing.r * 0.6 : topRing.r, TRUNK_SIDES, color)

    if (y !== t.topY) return
    // Branches from the top of the trunk into the canopy.
    const start: Vec3 = [topRing.c[0], topRing.c[1] - 0.1, topRing.c[2]]
    const spin = hash01(t.x, t.z, 229) * Math.PI * 2
    // Branches never carry birch marks.
    const branchColor = barkColor({ ...style, marks: style.bark }, t.x, y, t.z)
    for (let i = 0; i < style.branches; i++) {
      const a = spin + (i * Math.PI * 2) / style.branches
      const dir = normalize([Math.cos(a), 0.8 + 0.4 * hash01(t.x + i, t.z, 233), Math.sin(a)])
      const length = style.branchLength
      const end: Vec3 = [
        start[0] + dir[0] * length,
        start[1] + dir[1] * length,
        start[2] + dir[2] * length,
      ]
      const r = style.branchRadius
      tube(out, start, end, r, r * 0.35, BRANCH_SIDES, branchColor)
    }
  }

  /**
   * One leaf card for an exposed foliage voxel of `material`; `trunk` is its
   * canopy's trunk, if any. The 4 vertices all sit at the card centre: the
   * foliage shader spreads them into a square facing the camera (see the
   * module comment).
   */
  private leafCard(
    out: MeshBuilder,
    x: number,
    y: number,
    z: number,
    material: number,
    trunk: Trunk | null,
  ): void {
    const style = CARDS[material] ?? DEFAULT_CARD
    const key = x * 7919 + y * 104729
    const h = (k: number): number => hash01(key, z, 301 + k)
    const centre = trunk ? canopyCenter(trunk) : { x: x + 0.5, level: y + 0.5, z: z + 0.5 }
    const cw: Vec3 = [centre.x, centre.level * VOXEL_HEIGHT, centre.z]

    // Card centre: voxel centre, jittered, pushed a little out of the canopy.
    const voxel: Vec3 = [x + 0.5, (y + 0.5) * VOXEL_HEIGHT, z + 0.5]
    const outward = trunk ? normalize(sub(voxel, cw)) : ([0, 1, 0] as Vec3)
    const p: Vec3 = [
      voxel[0] + (h(0) - 0.5) * CARD_JITTER + outward[0] * CARD_PUSH,
      voxel[1] + (h(1) - 0.5) * CARD_JITTER * 0.6 + outward[1] * CARD_PUSH,
      voxel[2] + (h(2) - 0.5) * CARD_JITTER + outward[2] * CARD_PUSH,
    ]
    const half = (style.size + style.sizeJitter * h(6)) / 2

    // Corner offsets in the card plane (camera right/up), randomly rotated.
    const spin = h(5) * Math.PI * 2
    const cs = Math.cos(spin)
    const sn = Math.sin(spin)
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([cx = 0, cy = 0]) => [cx * cs - cy * sn, cx * sn + cy * cs] as const)

    // Leaf texture: one of the clusters of the material's atlas row.
    const cell = 1 / ATLAS_CELLS
    const u0 = Math.floor(h(7) * ATLAS_CELLS) * cell
    const v0 = style.row * cell
    const uvs = [
      [u0, v0],
      [u0 + cell, v0],
      [u0 + cell, v0 + cell],
      [u0, v0 + cell],
    ]

    // Per-card tint and fake ambient occlusion (darker low in the canopy and
    // towards its core); a few cards lean yellow.
    const base = this.colorOf(material)
    const d = sub(p, cw)
    const low = Math.min(1, Math.max(0, d[1] / 1.5 + 0.6))
    const core = Math.min(1, Math.hypot(d[0], d[1] * CANOPY_FLATNESS, d[2]) / 2)
    const ao = trunk ? (0.62 + 0.38 * low) * (0.75 + 0.25 * core) : 0.9
    const k = (0.9 + 0.35 * h(8)) * ao
    const warm = h(9) > 0.75 ? ([1.12, 1.06, 0.75] as const) : ([1, 1, 1] as const)
    const color: Vec3 = [base[0] * k * warm[0], base[1] * k * warm[1], base[2] * k * warm[2]]

    out.rawPolygon(
      [p, p, p, p],
      [outward, outward, outward, outward],
      [color, color, color, color],
      corners.map(([ox, oy], i) => {
        const [u = 0, v = 0] = uvs[i] ?? []
        return [u, v, ox, oy, half, cw[0], cw[1], cw[2]]
      }),
    )
  }
}

/**
 * Bark colour of a trunk voxel, with a little variation; birches get dark
 * marks on some segments.
 */
function barkColor(style: BarkStyle, x: number, y: number, z: number): Vec3 {
  const marks = style.marks
  const c = srgbHexToLinear(
    marks !== undefined && hash01(x * 31 + y, z, 243) < 0.3 ? marks : style.bark,
  )
  const k = 0.85 + 0.3 * hash01(x * 31 + y, z, 241)
  return [c[0] * k, c[1] * k, c[2] * k]
}

/** Whether the chunk holds any WOOD or foliage voxel (trees are rare). */
function hasTreeVoxels(chunk: Chunk): boolean {
  for (let ly = 0; ly < CHUNK_SIZE; ly++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const m = materialOf(chunk.get(lx, ly, lz))
        if (m === Material.WOOD || isFoliageMaterial(m)) return true
      }
    }
  }
  return false
}

/** A leaf voxel is exposed when one of its 6 neighbours is not foliage or trunk. */
function isExposed(map: VoxelMap, x: number, y: number, z: number): boolean {
  const solid = (vx: number, vy: number, vz: number): boolean => {
    const m = materialOf(map.get(vx, vy, vz))
    return isFoliageMaterial(m) || m === Material.WOOD
  }
  return (
    !solid(x + 1, y, z) ||
    !solid(x - 1, y, z) ||
    !solid(x, y + 1, z) ||
    !solid(x, y - 1, z) ||
    !solid(x, y, z + 1) ||
    !solid(x, y, z - 1)
  )
}

/** Vertex data of bark: the bark pattern of the blocks shader. */
const BARK_LOOK = [BlockLook.BARK]

/**
 * Tapered tube from `a` (radius `ra`) to `b` (radius `rb`), open at both
 * ends, with radial (smooth) normals and outward-facing triangles.
 */
function tube(
  out: MeshBuilder,
  a: Vec3,
  b: Vec3,
  ra: number,
  rb: number,
  sides: number,
  color: Vec3,
): void {
  const axis = normalize(sub(b, a))
  const ref: Vec3 = Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1]
  // u x w = -axis: the quad order below then faces outwards.
  const u = normalize(cross(axis, ref))
  const w = cross(u, axis)
  const radial = (k: number): Vec3 => {
    const angle = (k / sides) * Math.PI * 2
    return add3(scale3(u, Math.cos(angle)), scale3(w, Math.sin(angle)))
  }
  for (let k = 0; k < sides; k++) {
    const n0 = radial(k)
    const n1 = radial(k + 1)
    out.rawPolygon(
      [
        add3(a, scale3(n0, ra)),
        add3(b, scale3(n0, rb)),
        add3(b, scale3(n1, rb)),
        add3(a, scale3(n1, ra)),
      ],
      [n0, n0, n1, n1],
      [color, color, color, color],
      [BARK_LOOK, BARK_LOOK, BARK_LOOK, BARK_LOOK],
    )
  }
}

/** a + b. */
function add3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

/** v * k. */
function scale3(v: Vec3, k: number): Vec3 {
  return [v[0] * k, v[1] * k, v[2] * k]
}
