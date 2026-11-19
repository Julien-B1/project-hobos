/**
 * Blocks material: built structures and tree trunks (TSL node material).
 *
 * Layer: render. Vertex colours give the base colour; a per-vertex "look"
 * (`BlockLook`, weight channel 0, set by the meshers) picks a procedural
 * pattern drawn in world space, so blocks read as a material instead of
 * flat colour:
 * - planks (wood): boards half a cell wide with seams, butt joints, a
 *   per-board tint and a grain stretched along the boards;
 * - bricks (dressed stone): courses half a voxel high, staggered joints,
 *   mortar lines and a per-brick tint;
 * - bark: vertical streaks;
 * - wood: grain only (beams and single planks of structures);
 * - masonry: irregular courses of large stones; stone: mottled, no joints;
 * - rope: fine diagonal strands;
 * - plain: a light noise variation.
 * Cost per pixel: 1 fetch of the shared noise texture and a few dozen ALU.
 * The battle-map grid is drawn on top faces (`gridOverlay.ts`).
 */
import {
  abs,
  attribute,
  cross,
  dFdx,
  dFdy,
  float,
  floor,
  fract,
  max,
  normalize,
  positionWorld,
  select,
  sin,
  smoothstep,
  texture,
  vec2,
  vertexColor,
} from 'three/tsl'
import { FrontSide, MeshStandardNodeMaterial, type DataTexture, type Node } from 'three/webgpu'
import { applyGrid, type GridOpacity } from './gridOverlay'
import { BlockLook } from './meshing/mesher'

/** Width of a plank and length between butt joints, in world units. */
const PLANK_WIDTH = 0.5
const PLANK_LENGTH = 2
/** Height of a brick course and length of a brick, in world units. */
const BRICK_HEIGHT = 0.25
const BRICK_LENGTH = 0.5

/** Cheap hash of a float to [0, 1) (a few ALU, good enough for tints). */
function hash(x: Node<'float'>): Node<'float'> {
  return fract(sin(x.mul(12.9898)).mul(43758.5453))
}

/** Create the material of the blocks layer. */
export function createBlocksMaterial(
  noise: DataTexture,
  grid: GridOpacity,
): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0 })
  material.name = 'blocks'
  // Shadows cast by the front faces (Three's default for front-sided
  // materials is the back faces): with back faces, the depth stored right
  // next to an object's foot is its shaded side, almost at the ground's own
  // depth, and the shadow bias left a lit strip between object and shadow.
  material.shadowSide = FrontSide

  const look = attribute('weightsA', 'vec4').x
  const is = (id: number): Node<'bool'> => abs(look.sub(id)).lessThan(0.5)
  const p = positionWorld
  // Face plane from the geometric normal: (x, z) on tops, (horizontal, y) on sides.
  const f = abs(normalize(cross(dFdx(p), dFdy(p))))
  const uv = select(
    f.y.greaterThan(0.6),
    p.xz,
    select(f.x.greaterThan(f.z), vec2(p.z, p.y), vec2(p.x, p.y)),
  )

  // One noise fetch, stretched according to the look (grain, streaks...).
  const woody = is(BlockLook.PLANKS).or(is(BlockLook.WOOD))
  const noiseUv = select(
    woody,
    vec2(uv.x.mul(0.06), uv.y.mul(0.9)),
    select(
      is(BlockLook.BRICKS),
      uv.mul(0.35),
      select(
        is(BlockLook.BARK),
        vec2(p.x.add(p.z).mul(1.2), p.y.mul(0.12)),
        p.xz.add(p.y).div(6.7),
      ),
    ),
  )
  const grain = texture(noise, noiseUv).g

  // Planks: boards along the face's first axis.
  const row = uv.y.div(PLANK_WIDTH)
  const board = hash(floor(row))
  const seam = smoothstep(0.44, 0.5, abs(fract(row).sub(0.5)))
  const joint = smoothstep(0.49, 0.5, abs(fract(uv.x.div(PLANK_LENGTH).add(board.mul(7))).sub(0.5)))
  const planks = board
    .mul(0.3)
    .add(0.8)
    .mul(grain.mul(0.4).add(0.8))
    .mul(float(1).sub(max(seam, joint).mul(0.45)))

  // Bricks: staggered courses.
  const course = uv.y.div(BRICK_HEIGHT)
  const courseId = floor(course)
  const along = uv.x.div(BRICK_LENGTH).add(fract(courseId.mul(0.5)))
  const mortar = max(
    smoothstep(0.4, 0.5, abs(fract(course).sub(0.5))),
    smoothstep(0.45, 0.5, abs(fract(along).sub(0.5))),
  )
  const brick = hash(floor(along).add(courseId.mul(7.3)))
  const bricks = brick
    .mul(0.25)
    .add(0.85)
    .mul(grain.mul(0.3).add(0.85))
    .mul(float(1).sub(mortar.mul(0.4)))

  // Masonry: courses 0.3 high, stones of varying length per course.
  const mCourse = uv.y.div(0.3)
  const mCourseId = floor(mCourse)
  const mLength = hash(mCourseId.mul(3.1)).mul(0.35).add(0.5)
  const mAlong = uv.x.div(mLength).add(hash(mCourseId).mul(5))
  const mJoint = max(
    smoothstep(0.42, 0.5, abs(fract(mCourse).sub(0.5))),
    smoothstep(0.44, 0.5, abs(fract(mAlong).sub(0.5))),
  )
  const stoneTint = hash(floor(mAlong).add(mCourseId.mul(11.7)))
  const masonry = stoneTint
    .mul(0.3)
    .add(0.8)
    .mul(grain.mul(0.35).add(0.82))
    .mul(float(1).sub(mJoint.mul(0.5)))
  const stone = grain.mul(0.45).add(0.75)
  // Rope: fine diagonal strands.
  const strand = abs(fract(p.x.add(p.y).add(p.z).mul(14)).sub(0.5))
  const rope = smoothstep(0.05, 0.3, strand).mul(0.35).add(0.7)
  const bark = grain.mul(0.8).add(0.6)
  const plain = grain.mul(0.2).add(0.9)
  // Plain wood: the planks' grain and tint, without seams or joints.
  const timber = grain.mul(0.4).add(0.8)
  // Pattern by look, as a chain of selects (one branch per look).
  const looks: [number, Node<'float'>][] = [
    [BlockLook.PLANKS, planks],
    [BlockLook.WOOD, timber],
    [BlockLook.BRICKS, bricks],
    [BlockLook.BARK, bark],
    [BlockLook.MASONRY, masonry],
    [BlockLook.STONE, stone],
    [BlockLook.ROPE, rope],
  ]
  const pattern = looks.reduceRight<Node<'float'>>(
    (rest, [id, value]) => select(is(id), value, rest),
    plain,
  )
  material.colorNode = applyGrid(vertexColor().rgb.mul(pattern), p, f.y, grid)
  return material
}
