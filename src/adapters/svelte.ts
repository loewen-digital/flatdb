import type { Collection } from '../collection.js'
import type { PathCollection } from '../path-collection.js'

type AnyCollection = Collection<any> | PathCollection<any>

interface Readable<T> {
  subscribe(cb: (value: T) => void): () => void
}

/**
 * Svelte 5 adapter — returns a Svelte-compatible readable store.
 *
 * Usage:
 * ```svelte
 * <script>
 *   import { liveQuery } from '@loewen-digital/flatdb/svelte'
 *   const todos = liveQuery(db.todos, { done: false })
 * </script>
 * {#each $todos as todo}
 *   <p>{todo.text}</p>
 * {/each}
 * ```
 */
export function liveQuery<T>(
  collection: AnyCollection,
  filter: Record<string, any> = {},
): Readable<T[]> {
  return {
    subscribe(cb: (value: T[]) => void) {
      const unsub = collection.live(filter, (results: any[]) => {
        cb(results as T[])
      })
      return unsub
    },
  }
}
