import { describe, it, expect, beforeEach } from 'vitest'
import { z } from 'zod'
import { MemoryAdapter } from '../src/memory-adapter.js'
import { Collection } from '../src/collection.js'
import { liveQuery } from '../src/adapters/svelte.js'

describe('Svelte adapter: liveQuery()', () => {
  let adapter: MemoryAdapter
  let col: Collection

  beforeEach(() => {
    adapter = new MemoryAdapter()
    col = new Collection(adapter, 'todos')
  })

  it('returns a Svelte-compatible readable store', () => {
    const store = liveQuery(col)
    expect(store).toHaveProperty('subscribe')
    expect(typeof store.subscribe).toBe('function')
  })

  it('emits initial results via subscribe', async () => {
    await col.insert({ text: 'A', done: false })

    const store = liveQuery(col)
    const results: any[][] = []

    const unsub = store.subscribe((value) => {
      results.push(value)
    })

    await new Promise(r => setTimeout(r, 50))
    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results[results.length - 1]).toHaveLength(1)

    unsub()
  })

  it('re-emits when data changes', async () => {
    const store = liveQuery(col, { done: false })
    const results: any[][] = []

    const unsub = store.subscribe((value) => {
      results.push(value)
    })

    await new Promise(r => setTimeout(r, 50))
    expect(results[results.length - 1]).toHaveLength(0)

    await col.insert({ text: 'A', done: false })
    await new Promise(r => setTimeout(r, 50))
    expect(results[results.length - 1]).toHaveLength(1)

    await col.insert({ text: 'B', done: false })
    await new Promise(r => setTimeout(r, 50))
    expect(results[results.length - 1]).toHaveLength(2)

    unsub()
  })

  it('respects filter', async () => {
    await col.insert({ text: 'A', done: true })

    const store = liveQuery(col, { done: false })
    const results: any[][] = []

    const unsub = store.subscribe((value) => {
      results.push(value)
    })

    await new Promise(r => setTimeout(r, 50))
    expect(results[results.length - 1]).toHaveLength(0) // done:true filtered out

    unsub()
  })

  it('unsubscribe stops notifications', async () => {
    const store = liveQuery(col)
    const results: any[][] = []

    const unsub = store.subscribe((value) => {
      results.push(value)
    })

    await new Promise(r => setTimeout(r, 50))
    unsub()
    const countAfterUnsub = results.length

    await col.insert({ text: 'A' })
    await new Promise(r => setTimeout(r, 50))

    expect(results.length).toBe(countAfterUnsub)
  })

  it('forwards onError', async () => {
    const strict = new Collection(adapter, 'strict', z.object({ text: z.string() }))
    await adapter.write('strict/_index.json', JSON.stringify({ x: { text: 1 } }))
    const errors: unknown[] = []
    const store = liveQuery(strict, {}, e => errors.push(e))
    const unsub = store.subscribe(() => {})

    await new Promise(r => setTimeout(r, 50))
    expect(errors).toHaveLength(1)
    expect(errors[0]).toBeInstanceOf(z.ZodError)
    unsub()
  })
})
