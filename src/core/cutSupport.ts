/**
 * Cut rule for map objects that stand on the scenery: actors, and later
 * furniture, spell effects, props and other gameplay elements.
 *
 * Layer: core (pure). The cut slider hides the scenery above a world
 * height. Such objects are never sliced by it: each one is shown whole, or
 * hidden whole, depending only on the surface it rests on. It disappears
 * if and only if that surface is cut away, i.e. lies above the cut height.
 * A surface exactly at the cut height is kept (the section cap draws it).
 */

/**
 * Tolerance on the comparison, in world units: a surface within it above
 * the cut still counts as kept (rounding of probed heights).
 */
export const SUPPORT_TOLERANCE = 1e-3

/**
 * Whether an object resting on a surface at `supportHeight` is shown under
 * the cut.
 *
 * @param supportHeight Height of the supporting surface (world units).
 * @param cutHeight Cut height (world units), or null when the cut is off.
 */
export function shownUnderCut(supportHeight: number, cutHeight: number | null): boolean {
  return cutHeight === null || supportHeight <= cutHeight + SUPPORT_TOLERANCE
}
