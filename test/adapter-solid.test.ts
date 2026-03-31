import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock SolidJS primitives before importing the adapter
let cleanupFn: (() => void) | null = null
vi.mock('solid-js', () => ({
  createSignal: (initial: any) => {
    let value = initial
    const getter = () => value
    const setter = (fn: (prev: any) => any) => {
      value = typeof fn === 'function' ? fn(value) : fn
    }
    return [getter, setter]
  },
  onCleanup: (fn: () => void) => {
    cleanupFn = fn
  },
}))

import { MemoryAdapter } from '../src/memory-adapter.js'
import { Collection } from '../src/collection.js'
import { createLiveQuery } from '../src/adapters/solid.js'

describe('Solid adapter: createLiveQuery()', () => {
  let adapter: MemoryAdapter
  let col: Collection

  beforeEach(() => {
    adapter = new MemoryAdapter()
    col = new Collection(adapter, 'todos')
    cleanupFn = null
  })

  it('returns an accessor function', () => {
    const todos = createLiveQuery(col)
    expect(typeof todos).toBe('function')
    expect(todos()).toEqual([])
  })

  it('updates signal when data changes', async () => {
    const todos = createLiveQuery(col)

    await new Promise(r => setTimeout(r, 50))
    expect(todos()).toHaveLength(0)

    await col.insert({ text: 'A' })
    await new Promise(r => setTimeout(r, 50))
    expect(todos()).toHaveLength(1)
  })

  it('respects filter', async () => {
    await col.insert({ text: 'A', done: true })

    const todos = createLiveQuery(col, { done: false })
    await new Promise(r => setTimeout(r, 50))

    expect(todos()).toHaveLength(0)
  })

  it('registers onCleanup', () => {
    createLiveQuery(col)
    expect(cleanupFn).not.toBeNull()
  })

  it('cleanup stops updates', async () => {
    const todos = createLiveQuery(col)

    await new Promise(r => setTimeout(r, 50))
    cleanupFn!()

    await col.insert({ text: 'A' })
    await new Promise(r => setTimeout(r, 50))

    expect(todos()).toHaveLength(0)
  })
})
