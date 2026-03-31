import { ref, onUnmounted, type Ref } from 'vue'
import type { Collection } from '../collection.js'
import type { PathCollection } from '../path-collection.js'

type AnyCollection = Collection<any> | PathCollection<any>

/**
 * Vue 3 adapter — returns a reactive ref() that updates automatically.
 *
 * Usage:
 * ```vue
 * <script setup>
 * import { useLiveQuery } from '@loewen-digital/flatdb/vue'
 * const todos = useLiveQuery(db.todos, { done: false })
 * </script>
 * <template>
 *   <p v-for="todo in todos" :key="todo._id">{{ todo.text }}</p>
 * </template>
 * ```
 */
export function useLiveQuery<T>(
  collection: AnyCollection,
  filter: Record<string, any> = {},
): Ref<T[]> {
  const data = ref<T[]>([]) as Ref<T[]>

  const unsub = collection.live(filter, (results: any[]) => {
    data.value = results as T[]
  })

  onUnmounted(() => {
    unsub()
  })

  return data
}
