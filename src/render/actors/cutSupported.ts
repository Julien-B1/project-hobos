/**
 * Objects that stand on the scenery and follow the cut as a whole (see
 * `core/cutSupport.ts`): characters now, furniture, spell effects and
 * props later.
 *
 * Layer: render. Their materials have no cut mask: they are never sliced.
 * The engine shows or hides each one every frame from the height of the
 * surface it rests on.
 */
import { shownUnderCut } from '../../core/cutSupport'

/** A map object hidden whole when the surface it rests on is cut away. */
export interface CutSupported {
  /** Height of the surface the object rests on, in world units. */
  readonly supportHeight: number
  /** Whether the object is drawn (and pickable). */
  shown: boolean
}

/** Show or hide each object for the cut height (world units, null: no cut). */
export function applyCut(objects: Iterable<CutSupported>, cutHeight: number | null): void {
  for (const o of objects) {
    const shown = shownUnderCut(o.supportHeight, cutHeight)
    if (o.shown !== shown) o.shown = shown
  }
}
