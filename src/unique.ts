import { getNestedValue } from './query.js'

/** Thrown when a write would store a second document with the same value in a unique field. */
export class UniqueConstraintError extends Error {
  override readonly name = 'UniqueConstraintError'

  constructor(
    readonly collection: string,
    readonly field: string,
    /** The duplicated value. Not part of the message, so it stays out of logs. */
    readonly value: unknown,
  ) {
    super(`${collection}: a document with this "${field}" already exists`)
  }
}

/**
 * The value as it is stored, as comparison key. `null` and a missing field have
 * none: any number of documents may leave a unique field empty.
 */
function keyOf(doc: Record<string, any>, field: string): string | undefined {
  const value = getNestedValue(doc, field)
  return value == null ? undefined : JSON.stringify(value)
}

/**
 * Throws when one of `incoming` would duplicate a unique value, of another
 * incoming document or of an entry in `index`. Entries that `incoming` replaces
 * do not count. `view` maps a stored entry to its current shape (lazy migration).
 */
export function assertUnique(
  collection: string,
  fields: string[],
  index: Record<string, Record<string, any>>,
  incoming: Record<string, Record<string, any>>,
  view: (entry: Record<string, any>) => Record<string, any>,
): void {
  const others = Object.entries(index)
    .filter(([id]) => !(id in incoming))
    .map(([, entry]) => view(entry))

  for (const field of fields) {
    const taken = new Set<string>()
    for (const doc of others) {
      const key = keyOf(doc, field)
      if (key !== undefined) taken.add(key)
    }
    for (const doc of Object.values(incoming)) {
      const key = keyOf(doc, field)
      if (key === undefined) continue
      if (taken.has(key)) {
        throw new UniqueConstraintError(collection, field, getNestedValue(doc, field))
      }
      taken.add(key)
    }
  }
}
