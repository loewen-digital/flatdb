import { describe, it, expect, afterAll, vi } from 'vite-plus/test'
import 'fake-indexeddb/auto'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { FsAdapter } from '../src/fs-adapter.js'
import { flatdb, collection } from '../src/flatdb.js'
import { MemoryAdapter } from '../src/memory-adapter.js'
import { IndexedDBAdapter } from '../src/indexeddb-adapter.js'
import { R2Adapter } from '../src/r2-adapter.js'
import { Collection } from '../src/collection.js'
import { PathCollection } from '../src/path-collection.js'
import type { StorageAdapter } from '../src/types.js'
import { FakeR2Bucket } from './fake-r2-bucket.js'

const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'flatdb-concurrency-'))
afterAll(() => fs.rm(tmpRoot, { recursive: true, force: true }))

const adapters: [string, () => StorageAdapter][] = [
  ['FsAdapter', () => new FsAdapter(path.join(tmpRoot, `${Date.now()}-${Math.random()}`))],
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
    await Promise.all(writers.map((w) => w.find()))

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

    const names = (await new Collection(adapter, 'users').find())
      .map((d) => d.name as string)
      .sort()
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

describe('a burst of writers, one database per request', () => {
  it('FsAdapter: every document of 40 parallel flatdb() instances is in the index', async () => {
    const dir = path.join(tmpRoot, 'burst')
    const open = () => flatdb(new FsAdapter(dir), { users: collection() })

    await Promise.all(Array.from({ length: 40 }, (_, n) => open().users.insert({ n })))

    const files = (await fs.readdir(path.join(dir, 'users'))).filter((f) => f !== '_index.json')
    const index = JSON.parse(await fs.readFile(path.join(dir, 'users', '_index.json'), 'utf-8'))
    expect(files).toHaveLength(40)
    expect(Object.keys(index).sort()).toEqual(files.map((f) => f.replace(/\.json$/, '')).sort())
    expect(await open().users.count()).toBe(40)
  })

  it('MemoryAdapter: 40 parallel collections on one adapter keep every entry', async () => {
    const adapter = new MemoryAdapter()

    await Promise.all(
      Array.from({ length: 40 }, (_, n) => new Collection(adapter, 'users').insert({ n })),
    )

    expect(await new Collection(adapter, 'users').count()).toBe(40)
  })
})

describe('index write conflicts', () => {
  it('gives up after repeated conflicts with a clear error', async () => {
    class Hostile extends MemoryAdapter {
      attempts = 0
      override async writeIf(): Promise<string | null> {
        this.attempts++
        return null
      }
    }
    const random = vi.spyOn(Math, 'random').mockReturnValue(0) // no waiting between attempts
    const adapter = new Hostile()
    try {
      await expect(new Collection(adapter, 'users').insert({ name: 'X' })).rejects.toThrow(
        /another writer/,
      )
      expect(adapter.attempts).toBe(20)
    } finally {
      random.mockRestore()
    }
  })

  it('waits between attempts, longer after every lost race', async () => {
    const delays: number[] = []
    const timer = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      fn: () => void,
      ms = 0,
    ) => {
      delays.push(ms)
      queueMicrotask(fn)
      return 0
    }) as typeof setTimeout)
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5)
    let refusals = 3
    class Contended extends MemoryAdapter {
      override async writeIf(p: string, data: string, version: string | null) {
        return refusals-- > 0 ? null : super.writeIf(p, data, version)
      }
    }
    try {
      const adapter = new Contended()
      await new Collection(adapter, 'users').insert({ name: 'X' })
      expect(delays).toEqual([2, 4, 8])
      expect(await new Collection(adapter, 'users').count()).toBe(1)
    } finally {
      timer.mockRestore()
      random.mockRestore()
    }
  })

  it('uses conditional puts on R2 and retries once per lost race', async () => {
    const bucket = new FakeR2Bucket()
    const a = new Collection(new R2Adapter({ bucket }), 'users')
    const b = new Collection(new R2Adapter({ bucket }), 'users')
    await a.find()
    await b.find()

    await a.insert({ name: 'A' })
    await b.insert({ name: 'B' })

    const conditional = bucket.calls.filter((c) => c === 'put users/_index.json onlyIf')
    expect(conditional).toHaveLength(3) // a: create; b: create fails, then compare-and-swap
    expect(bucket.calls.filter((c) => c === 'put users/_index.json')).toHaveLength(0)
    expect(await new Collection(new R2Adapter({ bucket }), 'users').count()).toBe(2)
  })
})
