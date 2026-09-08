import type { ZodType } from 'zod'
import type { StorageAdapter, CollectionOptions, CollectionDefinition } from './types.js'
import { FsAdapter } from './fs-adapter.js'
import { IndexedDBAdapter } from './indexeddb-adapter.js'
import { Collection } from './collection.js'
import { PathCollection } from './path-collection.js'
import type { RefResolver } from './ref.js'

export interface FlatDbOptions {
  watch?: boolean
}

export function collection(schema?: ZodType, options: CollectionOptions = {}): CollectionDefinition {
  return { schema, options }
}

type CollectionMap<T extends Record<string, CollectionDefinition>> = {
  [K in keyof T]: Collection | PathCollection
}

export type FlatDb<T extends Record<string, CollectionDefinition>> = CollectionMap<T> & {
  /**
   * Stops file watchers and closes the adapter's connection when it has one.
   * Safe to call more than once; the collections stay usable afterwards.
   */
  close(): Promise<void>
}

export function flatdb<T extends Record<string, CollectionDefinition>>(
  pathOrAdapter: string | StorageAdapter,
  collections?: T,
  options?: FlatDbOptions,
): FlatDb<T> {
  let adapter: StorageAdapter
  if (typeof pathOrAdapter === 'string') {
    if (pathOrAdapter.startsWith('idb://')) {
      adapter = new IndexedDBAdapter(pathOrAdapter.slice(6))
    } else {
      adapter = new FsAdapter(pathOrAdapter)
    }
  } else {
    adapter = pathOrAdapter
  }

  if (collections && 'close' in collections) {
    throw new Error('flatdb(): "close" is reserved for db.close(); rename the collection')
  }

  const result = {} as any
  const watchers: Promise<() => void>[] = []

  if (collections) {
    for (const [name, def] of Object.entries(collections)) {
      const mode = def.options.mode ?? 'auto'
      if (mode === 'path') {
        result[name] = new PathCollection(adapter, name, def.schema, def.options)
      } else {
        result[name] = new Collection(adapter, name, def.schema, def.options)
      }
    }

    // Wire up ref resolver across all collections
    const resolver: RefResolver = async (collectionName, id) => {
      const col = result[collectionName]
      if (!col) return null
      if (col instanceof PathCollection) {
        return col.get(id)
      }
      return col.findById(id)
    }

    for (const col of Object.values(result)) {
      (col as any)._resolveRef = resolver
    }

    // Wire up fs.watch if enabled
    if (options?.watch && adapter.watch) {
      for (const [name, col] of Object.entries(result) as [string, Collection | PathCollection][]) {
        // The directory has to exist before it can be watched
        const watcher = adapter.mkdir(name).then(() =>
          adapter.watch!(name, () => {
            // Invalidate index cache and re-notify subscribers
            ;(col as any).indexCache = null
            ;(col as any).emitter?.emit()
          }),
        )
        watcher.catch(error => console.error(`[flatdb] could not watch "${name}"`, error))
        watchers.push(watcher)
      }
    }
  }

  result.close = async () => {
    for (const watcher of await Promise.allSettled(watchers.splice(0))) {
      if (watcher.status === 'fulfilled') watcher.value()
    }
    await adapter.close?.()
  }

  return result as FlatDb<T>
}
