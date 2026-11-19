/**
 * Cap mesher: fills the cross-section of what the cut plane slices.
 *
 * Layer: render (no Three.js import, unit-tested). The cut (see
 * `Engine.setCutHeight`) hides everything above a height; chunk meshes are
 * hollow shells, so without a cap one would look inside the ground. This
 * mesher builds the missing horizontal faces at the cut height:
 * - **terrain**: for every run crossing the height, the part of its faceted
 *   top that rises above the cut and of its (vaulted) underside that lies
 *   below it, clipped triangle by triangle from the mesh's own corner
 *   heights and laid flat at the cut height: the cap's outline is exactly
 *   the cut of the geometry, cave interiors stay open.
 * - **blocks**: one square per built voxel (not terrain, water, foliage or
 *   tree trunk) containing the height.
 * Colours are the material of the voxel at the cut, darkened; the cap
 * shader adds hatching.
 */
import { CHUNK_SIZE, VOXEL_HEIGHT } from '@/core/coords'
import { Material, isFoliageMaterial } from '@/core/materials'
import { TerrainField, facetDiagonal, type FacetCorners } from '@/core/terrainSurface'
import { findTrunks, isTrunkVoxel } from '@/core/trees'
import { isAir, materialOf, type Voxel } from '@/core/voxel'
import type { VoxelMap } from '@/core/voxelMap'
import { MeshBuilder, type Vec3 } from './meshBuilder'
import type { ColorLookup, MeshData } from './mesher'

/** Brightness of the cap relative to the material colour. */
const CAP_SHADE = 0.55

/** A point on the ground plane of a cell: local x and z in [0, 1]. */
type Point2 = readonly [number, number]

/** A function of the position in a cell, linear over the region it is used on. */
type Field = (x: number, z: number) => number

/**
 * Part of a convex polygon where `g` is positive or zero (Sutherland-Hodgman
 * clipping against the line g = 0; `g` must be linear over the polygon).
 */
export function clipPositive(polygon: readonly Point2[], g: Field): Point2[] {
  const out: Point2[] = []
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]
    const b = polygon[(i + 1) % polygon.length]
    if (!a || !b) continue
    const da = g(a[0], a[1])
    const db = g(b[0], b[1])
    // Points on the line count as inside (shared diagonals, flat levels).
    if (da >= -EPS) out.push(a)
    if ((da > EPS && db < -EPS) || (da < -EPS && db > EPS)) {
      const t = da / (da - db)
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
    }
  }
  return out.length >= 3 ? out : []
}

/** Tolerance of the clipping tests. */
const EPS = 1e-9

/** Corner positions of a cell, in `FacetCorners` order. */
const CORNERS: readonly Point2[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
]

/**
 * The two triangles of a faceted surface over a cell (split by
 * `facetDiagonal`): for each, its footprint, the half of the cell it covers
 * (as a function positive inside) and its height (levels) as a function of
 * the position.
 */
function facets(h: FacetCorners): { footprint: Point2[]; inside: Field; height: Field }[] {
  const [h00, h10, h11, h01] = h
  if (facetDiagonal(h) === 0) {
    return [
      {
        footprint: [CORNERS[0], CORNERS[1], CORNERS[2]] as Point2[],
        inside: (x, z) => x - z,
        height: (x, z) => h00 + (h10 - h00) * (x - z) + (h11 - h00) * z,
      },
      {
        footprint: [CORNERS[0], CORNERS[2], CORNERS[3]] as Point2[],
        inside: (x, z) => z - x,
        height: (x, z) => h00 + (h01 - h00) * (z - x) + (h11 - h00) * x,
      },
    ]
  }
  return [
    {
      footprint: [CORNERS[1], CORNERS[3], CORNERS[0]] as Point2[],
      inside: (x, z) => 1 - x - z,
      height: (x, z) => h00 + (h10 - h00) * x + (h01 - h00) * z,
    },
    {
      footprint: [CORNERS[1], CORNERS[2], CORNERS[3]] as Point2[],
      inside: (x, z) => x + z - 1,
      height: (x, z) => h11 + (h01 - h11) * (1 - x) + (h10 - h11) * (1 - z),
    },
  ]
}

/** Builds the cap of a whole map at a cut height. */
export class CapMesher {
  /**
   * @param isTerrain Which voxels are faceted ground.
   * @param colorOf Linear RGB colour of a material id.
   */
  constructor(
    private readonly isTerrain: (voxel: Voxel) => boolean,
    private readonly colorOf: ColorLookup,
  ) {}

  /** Cap of `map` at world height `height`. */
  mesh(map: VoxelMap, height: number): MeshData {
    const out = new MeshBuilder()
    const level = height / VOXEL_HEIGHT
    const voxelY = Math.floor(level)
    // Scan from below the floor so runs starting at level 0 have a finite bottom.
    const field = new TerrainField(map, this.isTerrain, -1, voxelY + 2 * CHUNK_SIZE)
    const columns = new Set<string>()
    for (const chunk of map.chunks()) columns.add(`${chunk.cx},${chunk.cz}`)

    for (const key of columns) {
      const [cx = 0, cz = 0] = key.split(',').map(Number)
      const ox = cx * CHUNK_SIZE
      const oz = cz * CHUNK_SIZE
      const trunks = findTrunks(
        map,
        ox,
        ox + CHUNK_SIZE - 1,
        voxelY,
        voxelY + CHUNK_SIZE,
        oz,
        oz + CHUNK_SIZE - 1,
      )
      for (let z = oz; z < oz + CHUNK_SIZE; z++) {
        for (let x = ox; x < ox + CHUNK_SIZE; x++) {
          this.terrainCap(out, map, field, x, z, level, height)
          this.blockCap(out, map, trunks, x, voxelY, z, height)
        }
      }
    }
    return out.toMeshData()
  }

  /**
   * Cap of the terrain runs of column (x, z): for each run, the region of
   * the cell where the cut height lies between its (vaulted) underside and
   * its faceted top, computed exactly from the same corner heights as the
   * mesh, so the cap's outline is the cut of the geometry.
   */
  private terrainCap(
    out: MeshBuilder,
    map: VoxelMap,
    field: TerrainField,
    x: number,
    z: number,
    level: number,
    height: number,
  ): void {
    for (const run of field.runsAt(x, z)) {
      if (!Number.isFinite(run.top)) continue
      const tops = field.cornerHeights(x, z, run)
      if (Math.max(...tops) <= level) continue
      const overhang = Number.isFinite(run.bottom)
      const bottoms = overhang ? field.cornerBottoms(x, z, run) : null
      if (bottoms && Math.min(...bottoms) >= level) continue // cut under the roof

      // Colour of the run's voxel at the cut (its lowest one under a vault).
      const lowest = overhang ? Math.ceil(run.bottom) : -Infinity
      const voxel = map.get(x, Math.max(Math.min(Math.floor(level), run.topY), lowest), z)
      const color = this.capColor(this.isTerrain(voxel) ? materialOf(voxel) : run.material)

      for (const top of facets(tops)) {
        const above = clipPositive(top.footprint, (px, pz) => top.height(px, pz) - level)
        if (above.length === 0) continue
        const pieces = bottoms
          ? facets(bottoms).map((under) =>
              clipPositive(
                clipPositive(above, under.inside),
                (px, pz) => level - under.height(px, pz),
              ),
            )
          : [above]
        for (const polygon of pieces) {
          if (polygon.length === 0) continue
          out.polygon(
            polygon.map(([px, pz]): Vec3 => [x + px, height, z + pz]),
            [0, 1, 0],
            color,
          )
        }
      }
    }
  }

  /** Cap of a built voxel (blocks layer) containing the cut height. */
  private blockCap(
    out: MeshBuilder,
    map: VoxelMap,
    trunks: Parameters<typeof isTrunkVoxel>[0],
    x: number,
    y: number,
    z: number,
    height: number,
  ): void {
    const voxel = map.get(x, y, z)
    const material = materialOf(voxel)
    if (isAir(voxel) || this.isTerrain(voxel)) return
    if (material === Material.WATER || isFoliageMaterial(material)) return
    if (isTrunkVoxel(trunks, x, y, z)) return
    // Nothing to fill when the cut grazes the voxel's bottom face.
    if (height <= y * VOXEL_HEIGHT + 1e-6) return
    out.polygon(
      [
        [x, height, z],
        [x, height, z + 1],
        [x + 1, height, z + 1],
        [x + 1, height, z],
      ],
      [0, 1, 0],
      this.capColor(material),
    )
  }

  /** Darkened colour of a material, for cut faces. */
  private capColor(material: number): Vec3 {
    const c = this.colorOf(material)
    return [c[0] * CAP_SHADE, c[1] * CAP_SHADE, c[2] * CAP_SHADE]
  }
}
