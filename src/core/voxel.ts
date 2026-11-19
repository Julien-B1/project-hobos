/**
 * Voxel encoding: one voxel fits in 16 bits.
 *
 * Layer: core (pure TypeScript).
 *
 * Bit layout (most significant first):
 *
 * ```
 *  15            8 7       4 3       0
 * +---------------+---------+---------+
 * |   material    |  shape  | orient. |
 * +---------------+---------+---------+
 * ```
 *
 * - material (8 bits, 0-255): 0 means air, see `materials.ts`;
 * - shape (4 bits, 0-15): see `shapes.ts` (full block, slope, ...);
 * - orientation (4 bits, 0-15): meaning depends on the shape; for slopes it is
 *   the compass direction of the high side.
 *
 * Any voxel whose material is 0 is air, whatever its shape/orientation bits;
 * the canonical air value is {@link AIR}.
 */

/** A packed voxel value (unsigned 16-bit integer). */
export type Voxel = number

/** Canonical air voxel. */
export const AIR: Voxel = 0

/**
 * Pack material, shape and orientation into a voxel.
 *
 * @throws RangeError when a field does not fit in its bit range.
 */
export function packVoxel(material: number, shape = 0, orientation = 0): Voxel {
  if (!isUint(material, 0xff) || !isUint(shape, 0xf) || !isUint(orientation, 0xf)) {
    throw new RangeError(`Voxel field out of range: m=${material} s=${shape} o=${orientation}`)
  }
  return (material << 8) | (shape << 4) | orientation
}

/** Material id (0 = air). */
export function materialOf(voxel: Voxel): number {
  return (voxel >> 8) & 0xff
}

/** Shape id. */
export function shapeOf(voxel: Voxel): number {
  return (voxel >> 4) & 0xf
}

/** Orientation id. */
export function orientationOf(voxel: Voxel): number {
  return voxel & 0xf
}

/** True when the voxel is air (material 0). */
export function isAir(voxel: Voxel): boolean {
  return materialOf(voxel) === 0
}

/** True when `value` is an integer in [0, max]. */
function isUint(value: number, max: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= max
}
