/**
 * Battle-map grid drawn in the ground shaders.
 *
 * Layer: render. The grid is not geometry: the terrain, blocks and water
 * materials darken their colour along the cell borders (integer x and z in
 * world units, 1 cell = 1 battle-map square), so the lines follow the ground
 * exactly, slopes included, and cost no draw call.
 *
 * Lines are thin (a fraction of a cell, never under about 0.75 pixel) and
 * translucent. They are box-filtered: the shader integrates the line
 * pattern over the pixel footprint (screen derivatives) instead of
 * thresholding it, so lines stay anti-aliased at every zoom and never turn
 * into moiré when cells get small; the grid is never hidden by the zoom.
 * Only near-vertical faces (walls, cliff faces) drop it.
 *
 * Cost per pixel: a few ALU and screen derivatives (`fwidth`).
 */
import { float, floor, fract, fwidth, max, min, mix, smoothstep, uniform, vec2 } from 'three/tsl'
import type { Node, UniformNode } from 'three/webgpu'

/** Line width, in cells (world units), at close zoom. */
const LINE_WIDTH = 0.022
/** Smallest line width, in pixels. */
const MIN_LINE_PIXELS = 0.75
/** How much a line darkens the ground at full coverage (0..1). */
const LINE_STRENGTH = 0.38

/** Facing (|normal y|) below which the grid fades out, and above which it is full. */
const FACING_FROM = 0.12
const FACING_FULL = 0.3

/** `smoothstep` on numbers (same curve as the shader's). */
function smoothstepNumber(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/** Shared grid opacity uniform: 1 shows the grid, 0 hides it. */
export type GridOpacity = UniformNode<'float'>

/** Create the grid opacity uniform (visible by default). */
export function createGridOpacity(visible = true): GridOpacity {
  return uniform(visible ? 1 : 0)
}

/**
 * Darken `color` along the grid lines.
 *
 * @param position World position of the pixel.
 * @param up How much the surface faces up (0..1, e.g. |geometric normal y|),
 *   per pixel, or a number for surfaces that always face the same way
 *   (water: 1).
 */
export function applyGrid(
  color: Node<'vec3'>,
  position: Node<'vec3'>,
  up: Node<'float'> | number,
  opacity: GridOpacity,
): Node<'vec3'> {
  // Cells covered by one pixel along x and z (the filter footprint).
  const w = max(fwidth(position.xz), vec2(1e-4))
  const width = max(float(LINE_WIDTH), max(w.x, w.y).mul(MIN_LINE_PIXELS))
  // Pulse train: 1 on [k, k + width), centred on the integers by the shift.
  const p = position.xz.add(width.mul(0.5))
  // Integral of the pulse train from 0 to x.
  const integral = (x: Node<'vec2'>): Node<'vec2'> =>
    floor(x)
      .mul(width)
      .add(min(fract(x), width))
  // Mean coverage of the lines over the pixel footprint, per axis.
  const cover = integral(p.add(w.mul(0.5)))
    .sub(integral(p.sub(w.mul(0.5))))
    .div(w)
  const line = float(1).sub(float(1).sub(cover.x).mul(float(1).sub(cover.y)))
  // A constant `up` is resolved here: `smoothstep` of literals only is
  // rejected by Firefox's WebGPU shader compiler (Naga: abstract types
  // outside a constant expression).
  const facing =
    typeof up === 'number'
      ? float(smoothstepNumber(FACING_FROM, FACING_FULL, up))
      : smoothstep(FACING_FROM, FACING_FULL, up)
  const amount = line.mul(facing).mul(opacity).mul(LINE_STRENGTH)
  // Darken, with a small floor so lines still read on dark ground.
  return mix(color, color.mul(0.35).add(0.012), amount)
}
