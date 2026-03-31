import { createSignal, onCleanup, type Accessor } from 'solid-js'
import type { Collection } from '../collection.js'
import type { PathCollection } from '../path-collection.js'

type AnyCollection = Collection<any> | PathCollection<any>

/**
 * SolidJS adapter — returns a signal accessor that updates automatically.
 *
 * Usage:
 * ```tsx
 * import { createLiveQuery } from '@loewen-digital/flatdb/solid'
 *
 * function TodoList() {
 *   const todos = createLiveQuery(db.todos, { done: false })
 *   return <For each={todos()}>{todo => <p>{todo.text}</p>}</For>
 * }
 * ```
 */
export function createLiveQuery<T>(
  collection: AnyCollection,
  filter: Record<string, any> = {},
): Accessor<T[]> {
  const [data, setData] = createSignal<T[]>([])

  const unsub = collection.live(filter, (results: any[]) => {
    setData(() => results as T[])
  })

  onCleanup(() => {
    unsub()
  })

  return data
}
