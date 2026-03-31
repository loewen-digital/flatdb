import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock Vue's ref and onUnmounted before importing the adapter
let cleanupFn: (() => void) | null = null
vi.mock('vue', () => ({
  ref: (initial: any) => {
    const r = { value: initial }
    return r
  },
  onUnmounted: (fn: () => void) => {
    cleanupFn = fn
  },
}))

import { MemoryAdapter } from '../src/memory-adapter.js'
import { Collection } from '../src/collection.js'
import { useLiveQuery } from '../src/adapters/vue.js'

describe('Vue adapter: useLiveQuery()', () => {
  let adapter: MemoryAdapter
  let col: Collection

  beforeEach(() => {
    adapter = new MemoryAdapter()
    col = new Collection(adapter, 'todos')
    cleanupFn = null
  })

  it('returns a ref with initial empty array', () => {
    const result = useLiveQuery(col)
    expect(result).toHaveProperty('value')
    expect(result.value).toEqual([])
  })

  it('updates ref.value when data changes', async () => {
    const result = useLiveQuery(col)

    await new Promise(r => setTimeout(r, 50))
    expect(result.value).toHaveLength(0)

    await col.insert({ text: 'A' })
    await new Promise(r => setTimeout(r, 50))
    expect(result.value).toHaveLength(1)
  })

  it('respects filter', async () => {
    await col.insert({ text: 'A', done: true })

    const result = useLiveQuery(col, { done: false })
    await new Promise(r => setTimeout(r, 50))

    expect(result.value).toHaveLength(0)
  })

  it('registers onUnmounted cleanup', () => {
    useLiveQuery(col)
    expect(cleanupFn).not.toBeNull()
  })

  it('cleanup stops updates', async () => {
    const result = useLiveQuery(col)

    await new Promise(r => setTimeout(r, 50))
    cleanupFn!()

    await col.insert({ text: 'A' })
    await new Promise(r => setTimeout(r, 50))

    // Should still be empty since we cleaned up
    expect(result.value).toHaveLength(0)
  })
})
