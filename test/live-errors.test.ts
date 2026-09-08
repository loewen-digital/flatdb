import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { MemoryAdapter } from '../src/memory-adapter.js'
import { Collection } from '../src/collection.js'
import { PathCollection } from '../src/path-collection.js'

const tick = () => new Promise(r => setTimeout(r, 20))

/** Replaces the index so the next read fails schema validation (or succeeds again). */
async function setIndex(adapter: MemoryAdapter, col: object, name: string, index: object) {
  await adapter.write(`${name}/_index.json`, JSON.stringify(index))
  ;(col as any).invalidateCache()
}

/** What flatdb()'s watch wiring does after an external change. */
const emit = (col: object) => (col as any).emitter.emit()
const listeners = (col: object): number => (col as any).emitter.listenerCount

describe('live query errors: Collection', () => {
  const schema = z.object({ name: z.string() })

  it('live() hands a failing re-query to onError and keeps the subscription', async () => {
    const adapter = new MemoryAdapter()
    const col = new Collection(adapter, 'users', schema)
    await col.insert({ name: 'Max' })

    const results: any[][] = []
    const errors: unknown[] = []
    const unsub = col.live(r => results.push(r), e => errors.push(e))
    await tick()
    expect(results).toHaveLength(1)

    await setIndex(adapter, col, 'users', { bad: { name: 123 } })
    emit(col)
    await tick()
    expect(errors).toHaveLength(1)
    expect(errors[0]).toBeInstanceOf(z.ZodError)
    expect(results).toHaveLength(1)

    await setIndex(adapter, col, 'users', { ok: { name: 'Fixed' } })
    emit(col)
    await tick()
    expect(results).toHaveLength(2)
    expect(results[1][0].name).toBe('Fixed')
    unsub()
  })

  it('live() reports a failing initial query', async () => {
    const adapter = new MemoryAdapter()
    const col = new Collection(adapter, 'users', schema)
    await setIndex(adapter, col, 'users', { bad: { name: 123 } })

    const errors: unknown[] = []
    const unsub = col.live({}, () => {}, e => errors.push(e))
    await tick()
    expect(errors).toHaveLength(1)
    unsub()
  })

  it('live() without onError logs and keeps running', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const adapter = new MemoryAdapter()
    const col = new Collection(adapter, 'users', schema)
    await setIndex(adapter, col, 'users', { bad: { name: 123 } })

    const unsub = col.live(() => {})
    await tick()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][1]).toBeInstanceOf(z.ZodError)
    expect(listeners(col)).toBe(1)
    unsub()
    spy.mockRestore()
  })

  it('a throwing callback reaches onError', async () => {
    const adapter = new MemoryAdapter()
    const col = new Collection(adapter, 'users', schema)
    const errors: unknown[] = []
    const unsub = col.live(() => { throw new Error('boom') }, e => errors.push(e))
    await tick()
    expect((errors[0] as Error).message).toBe('boom')
    unsub()
  })

  it('liveById() reports errors', async () => {
    const adapter = new MemoryAdapter()
    const col = new Collection(adapter, 'users', schema)
    const user = await col.insert({ name: 'Max' })

    const errors: unknown[] = []
    const unsub = col.liveById(user._id, () => {}, e => errors.push(e))
    await tick()
    await setIndex(adapter, col, 'users', { [user._id]: { name: 123 } })
    emit(col)
    await tick()
    expect(errors).toHaveLength(1)
    unsub()
  })

  it('watch() rejects the pending next() and ends', async () => {
    const adapter = new MemoryAdapter()
    const col = new Collection(adapter, 'users', schema)
    await col.insert({ name: 'Max' })

    const it = col.watch()[Symbol.asyncIterator]()
    expect((await it.next()).value).toHaveLength(1)

    const next = it.next()
    await setIndex(adapter, col, 'users', { bad: { name: 123 } })
    emit(col)
    await expect(next).rejects.toBeInstanceOf(z.ZodError)
    expect((await it.next()).done).toBe(true)
    expect(listeners(col)).toBe(0)
  })

  it('watch() rejects the first next() when the initial query fails', async () => {
    const adapter = new MemoryAdapter()
    const col = new Collection(adapter, 'users', schema)
    await setIndex(adapter, col, 'users', { bad: { name: 123 } })

    const it = col.watch()[Symbol.asyncIterator]()
    await expect(it.next()).rejects.toBeInstanceOf(z.ZodError)
    expect(listeners(col)).toBe(0)
  })

  it('for await surfaces the error and break unsubscribes', async () => {
    const adapter = new MemoryAdapter()
    const col = new Collection(adapter, 'users', schema)
    await col.insert({ name: 'Max' })

    const seen: number[] = []
    for await (const docs of col.watch()) {
      seen.push(docs.length)
      break
    }
    expect(seen).toEqual([1])
    expect(listeners(col)).toBe(0)

    await setIndex(adapter, col, 'users', { bad: { name: 123 } })
    await expect((async () => {
      for await (const _ of col.watch()) { /* never */ }
    })()).rejects.toBeInstanceOf(z.ZodError)
    expect(listeners(col)).toBe(0)
  })
})

describe('live query errors: PathCollection', () => {
  const schema = z.object({ title: z.string() })

  it('live() and liveByPath() report errors and stay subscribed', async () => {
    const adapter = new MemoryAdapter()
    const col = new PathCollection(adapter, 'pages', schema)
    await col.insert('about', { title: 'About' })

    const results: any[][] = []
    const docs: any[] = []
    const errors: unknown[] = []
    const unsubs = [
      col.live(r => results.push(r), e => errors.push(e)),
      col.liveByPath('about', d => docs.push(d), e => errors.push(e)),
    ]
    await tick()
    expect(results).toHaveLength(1)
    expect(docs).toHaveLength(1)

    await setIndex(adapter, col, 'pages', { about: { title: 1 } })
    emit(col)
    await tick()
    expect(errors).toHaveLength(2)
    expect(listeners(col)).toBe(2)

    await setIndex(adapter, col, 'pages', { about: { title: 'Back' } })
    emit(col)
    await tick()
    expect(results).toHaveLength(2)
    expect(docs[1].title).toBe('Back')
    unsubs.forEach(u => u())
  })

  it('watch() ends with the error', async () => {
    const adapter = new MemoryAdapter()
    const col = new PathCollection(adapter, 'pages', schema)
    await col.insert('about', { title: 'About' })

    const it = col.watch()[Symbol.asyncIterator]()
    expect((await it.next()).value).toHaveLength(1)

    const next = it.next()
    await setIndex(adapter, col, 'pages', { about: { title: 1 } })
    emit(col)
    await expect(next).rejects.toBeInstanceOf(z.ZodError)
    expect((await it.next()).done).toBe(true)
    expect(listeners(col)).toBe(0)
  })
})
