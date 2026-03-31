import type { ZodType } from 'zod'
import type { StorageAdapter, CollectionOptions, CollectionDefinition } from './types.js'
import { FsAdapter } from './fs-adapter.js'
import { Collection } from './collection.js'

export function collection(schema?: ZodType, options: CollectionOptions = {}): CollectionDefinition {
  return { schema, options }
}

type CollectionMap<T extends Record<string, CollectionDefinition>> = {
  [K in keyof T]: Collection
}

export function flatdb<T extends Record<string, CollectionDefinition>>(
  pathOrAdapter: string | StorageAdapter,
  collections?: T,
): CollectionMap<T> {
  const adapter: StorageAdapter =
    typeof pathOrAdapter === 'string' ? new FsAdapter(pathOrAdapter) : pathOrAdapter

  const result = {} as any

  if (collections) {
    for (const [name, def] of Object.entries(collections)) {
      result[name] = new Collection(adapter, name, def.schema, def.options)
    }
  }

  return result as CollectionMap<T>
}
