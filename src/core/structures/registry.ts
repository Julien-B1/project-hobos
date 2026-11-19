/**
 * Registry of structure kinds, by id.
 *
 * Layer: core (pure TypeScript). The set of kinds is data, not code paths:
 * placing a structure looks its kind up here, so new kinds plug in without
 * changing the code that places or draws structures.
 */
import type { StructureKind } from './structure'

/** Kinds of structures known to a map, by id. */
export class StructureRegistry<K extends { readonly id: string } = StructureKind> {
  private readonly byId = new Map<string, K>()

  /** @param entries Initial entries (ids must be unique). */
  constructor(entries: readonly K[] = []) {
    for (const entry of entries) this.register(entry)
  }

  /** Add an entry. Throws on a duplicate id. */
  register(entry: K): this {
    if (this.byId.has(entry.id)) throw new Error(`duplicate structure kind: ${entry.id}`)
    this.byId.set(entry.id, entry)
    return this
  }

  /** The entry of `id`. Throws when unknown. */
  get(id: string): K {
    const entry = this.byId.get(id)
    if (!entry) throw new Error(`unknown structure kind: ${id}`)
    return entry
  }

  /** Whether `id` is registered. */
  has(id: string): boolean {
    return this.byId.has(id)
  }

  /** Registered ids, in registration order. */
  get ids(): string[] {
    return [...this.byId.keys()]
  }
}
