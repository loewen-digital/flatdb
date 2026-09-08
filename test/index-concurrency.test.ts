import { describe, it, expect } from 'vitest'
import 'fake-indexeddb/auto'
import { MemoryAdapter } from '../src/memory-adapter.js'
import { IndexedDBAdapter } from '../src/indexeddb-adapter.js'
import { R2Adapter } from '../src/r2-adapter.js'
import { Collection } from '../src/collection.js'
import { PathCollection } from '../src/path-collection.js'
import type { StorageAdapter } from '../src/types.js'
import { FakeR2Bucket } from './fake-r2-bucket.js'

const adapters: [string, () => StorageAdapter][] = [
  ['MemoryAdapter', () => new MemoryAdapter()],
  ['IndexedDBAdapter', () => new IndexedDBAdapter(`concurrency-${Date.now()}-${Math.random()}`)],
  ['R2Adapter', () => new R2Adapter({ bucket: new FakeR2Bucket() })],
]

describe.each(adapters)('concurrent index writes on %s', (_name, make) => {
  it('two writers with stale caches both land in the index', async () => {
    const adapter = make()
    const a = new Collection(adapter, 'users')
    const b = new Collection(adapter, 'users')
    await a.find()
    await b.find() // both hold the empty index

    await a.insert({ name: 'A' })
    await b.insert({ name: 'B' }) // b's version is stale: reload, re-apply, write

    expect(await new Collection(adapter, 'users').count()).toBe(2)
    expect(await b.count()).toBe(2)
  })

  it('interleaved inserts keep every document', async () => {
    const adapter = make()
    const writers = [0, 1, 2, 3].map(() => new Collection(adapter, 'items'))
    await Promise.all(writers.map(w => w.find()))

    await Promise.all(writers.map((w, i) => w.insert({ n: i })))

    expect(await new Collection(adapter, 'items').count()).toBe(4)
  })

  it('update and delete re-apply their change on conflict', async () => {
    const adapter = make()
    const a = new Collection(adapter, 'users')
    const b = new Collection(adapter, 'users')
    const x = await a.insert({ name: 'X' })
    const y = await a.insert({ name: 'Y' })
    await b.find() // b caches X and Y
    await a.insert({ name: 'Z' }) // a moves the index on

    expect(await b.update({ _id: x._id }, { name: 'X2' })).toBe(1)
    expect(await b.delete({ _id: y._id })).toBe(1)

    const names = (await new Collection(adapter, 'users').find()).map(d => d.name).sort()
    expect(names).toEqual(['X2', 'Z'])
  })

  it('path mode: insert, move and delete survive a concurrent writer', async () => {
    const adapter = make()
    const a = new PathCollection(adapter, 'pages')
    const b = new PathCollection(adapter, 'pages')
    await a.insert('draft', { title: 'Draft' })
    await b.find()
    await a.insert('other', { title: 'Other' }) // b is stale now

    await b.move('draft', 'published')
    await b.insert('news', { title: 'News' }) // a is stale now
    await a.delete('other')

    const fresh = new PathCollection(adapter, 'pages')
    expect(await fresh.count()).toBe(2)
    expect((await fresh.get('published'))!.title).toBe('Draft')
    expect((await fresh.get('news'))!.title).toBe('News')
    expect(await fresh.get('other')).toBeNull()
  })

  it('rebuildIndex goes through the same path', async () => {
    const adapter = make()
    const col = new Collection(adapter, 'users')
    await col.insert({ name: 'A' })
    await adapter.write('users/manual.json', JSON.stringify({ name: 'Manual' }))

    await col.rebuildIndex()
    expect(await new Collection(adapter, 'users').count()).toBe(2)
  })
})

describe('index write conflicts', () => {
  it('gives up after repeated conflicts with a clear error', async () => {
    class Hostile extends MemoryAdapter {
      override async writeIf(): Promise<string | null> {
        return null
      }
    }
    const col = new Collection(new Hostile(), 'users')
    await expect(col.insert({ name: 'X' })).rejects.toThrow(/another writer/)
  })

  it('uses conditional puts on R2 and retries once per lost race', async () => {
    const bucket = new FakeR2Bucket()
    const a = new Collection(new R2Adapter({ bucket }), 'users')
    const b = new Collection(new R2Adapter({ bucket }), 'users')
    await a.find()
    await b.find()

    await a.insert({ name: 'A' })
    await b.insert({ name: 'B' })

    const conditional = bucket.calls.filter(c => c === 'put users/_index.json onlyIf')
    expect(conditional).toHaveLength(3) // a: create; b: create fails, then compare-and-swap
    expect(bucket.calls.filter(c => c === 'put users/_index.json')).toHaveLength(0)
    expect(await new Collection(new R2Adapter({ bucket }), 'users').count()).toBe(2)
  })
})
