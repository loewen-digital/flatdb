import { describe, it, expect, afterAll } from 'vite-plus/test'
import 'fake-indexeddb/auto'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { z } from 'zod'
import { FsAdapter } from '../src/fs-adapter.js'
import { MemoryAdapter } from '../src/memory-adapter.js'
import { IndexedDBAdapter } from '../src/indexeddb-adapter.js'
import { R2Adapter } from '../src/r2-adapter.js'
import { Collection } from '../src/collection.js'
import { PathCollection } from '../src/path-collection.js'
import { flatdb, collection, UniqueConstraintError } from '../src/index.js'
import type { StorageAdapter } from '../src/types.js'
import { FakeR2Bucket } from './fake-r2-bucket.js'

const users = (adapter: StorageAdapter, unique = ['email']) =>
  new Collection(adapter, 'users', undefined, { unique })

const docFiles = async (adapter: StorageAdapter) =>
  (await adapter.list('users')).filter(
    (entry) => entry.endsWith('.json') && entry !== '_index.json',
  )

describe('unique fields', () => {
  it('rejects an insert that duplicates the value, with a distinct error', async () => {
    const adapter = new MemoryAdapter()
    const col = users(adapter)
    await col.insert({ email: 'a@example.com', name: 'A' })

    const error = await col.insert({ email: 'a@example.com', name: 'B' }).catch((e) => e)

    expect(error).toBeInstanceOf(UniqueConstraintError)
    expect(error).toMatchObject({
      name: 'UniqueConstraintError',
      collection: 'users',
      field: 'email',
      value: 'a@example.com',
    })
    expect(error.message).not.toContain('a@example.com')
    expect(await col.count()).toBe(1)
    expect(await docFiles(adapter)).toHaveLength(1)
  })

  it('rejects an update that would duplicate the value and changes nothing', async () => {
    const adapter = new MemoryAdapter()
    const col = users(adapter)
    await col.insert({ email: 'a@example.com' })
    const b = await col.insert({ email: 'b@example.com', name: 'B' })

    await expect(
      col.update({ _id: b._id }, { email: 'a@example.com', name: 'changed' }),
    ).rejects.toBeInstanceOf(UniqueConstraintError)

    expect(await col.findById(b._id)).toMatchObject({ email: 'b@example.com', name: 'B' })
    expect(JSON.parse((await adapter.read(`users/${b._id}.json`))!)).toEqual({
      email: 'b@example.com',
      name: 'B',
    })
  })

  it('lets a document keep its own value on update', async () => {
    const col = users(new MemoryAdapter())
    const a = await col.insert({ email: 'a@example.com', name: 'A' })

    expect(await col.update({ _id: a._id }, { name: 'A2' })).toBe(1)
    expect(await col.update({ _id: a._id }, { email: 'a@example.com' })).toBe(1)
    expect(await col.findById(a._id)).toMatchObject({ email: 'a@example.com', name: 'A2' })
  })

  it('rejects an update that gives several documents the same value', async () => {
    const col = users(new MemoryAdapter())
    await col.insert({ email: 'a@example.com', team: 'x' })
    await col.insert({ email: 'b@example.com', team: 'x' })

    await expect(col.update({ team: 'x' }, { email: 'same@example.com' })).rejects.toBeInstanceOf(
      UniqueConstraintError,
    )
    expect((await col.find()).map((d) => d.email as string).sort()).toEqual([
      'a@example.com',
      'b@example.com',
    ])
  })

  it('insertMany is all or nothing, duplicates inside the batch included', async () => {
    const adapter = new MemoryAdapter()
    const col = users(adapter)
    await col.insert({ email: 'a@example.com' })

    await expect(
      col.insertMany([
        { email: 'b@example.com' },
        { email: 'c@example.com' },
        { email: 'b@example.com' },
      ]),
    ).rejects.toBeInstanceOf(UniqueConstraintError)
    await expect(
      col.insertMany([{ email: 'd@example.com' }, { email: 'a@example.com' }]),
    ).rejects.toBeInstanceOf(UniqueConstraintError)

    expect(await col.count()).toBe(1)
    expect(await docFiles(adapter)).toHaveLength(1)
  })

  it('frees a value when its document is deleted or changed', async () => {
    const col = users(new MemoryAdapter())
    const a = await col.insert({ email: 'a@example.com' })
    const b = await col.insert({ email: 'b@example.com' })

    await col.delete({ _id: a._id })
    await col.update({ _id: b._id }, { email: 'b2@example.com' })

    await expect(col.insert({ email: 'a@example.com' })).resolves.toBeDefined()
    await expect(col.insert({ email: 'b@example.com' })).resolves.toBeDefined()
  })

  it('treats null and a missing field as no value', async () => {
    const col = users(new MemoryAdapter())
    await col.insert({ name: 'no email' })
    await col.insert({ name: 'no email either' })
    await col.insert({ email: null })
    await col.insert({ email: null })

    expect(await col.count()).toBe(4)
  })

  it('compares values as stored: 1 and "1" differ, equal objects collide', async () => {
    const col = users(new MemoryAdapter(), ['code'])
    await col.insert({ code: 1 })
    await col.insert({ code: '1' })
    await col.insert({ code: { a: 1 } })

    await expect(col.insert({ code: 1 })).rejects.toBeInstanceOf(UniqueConstraintError)
    await expect(col.insert({ code: { a: 1 } })).rejects.toBeInstanceOf(UniqueConstraintError)
  })

  it('supports dot paths and several fields', async () => {
    const col = users(new MemoryAdapter(), ['email', 'profile.handle'])
    await col.insert({ email: 'a@example.com', profile: { handle: 'ann' } })

    const byHandle = await col
      .insert({ email: 'b@example.com', profile: { handle: 'ann' } })
      .catch((e) => e)
    expect(byHandle).toMatchObject({ field: 'profile.handle', value: 'ann' })

    const byEmail = await col
      .insert({ email: 'a@example.com', profile: { handle: 'bob' } })
      .catch((e) => e)
    expect(byEmail).toMatchObject({ field: 'email' })

    await col.insert({ email: 'b@example.com', profile: { handle: 'bob' } })
    expect(await col.count()).toBe(2)
  })

  it('sees old documents through migrate', async () => {
    const adapter = new MemoryAdapter()
    await new Collection(adapter, 'users').insert({ mail: 'a@example.com' })

    const col = new Collection(adapter, 'users', undefined, {
      unique: ['email'],
      migrate: (doc) => (doc.mail ? { email: doc.mail } : doc),
    })

    await expect(col.insert({ email: 'a@example.com' })).rejects.toBeInstanceOf(
      UniqueConstraintError,
    )
  })

  it('works through flatdb() with a Zod schema', async () => {
    const db = flatdb(new MemoryAdapter(), {
      users: collection(z.object({ email: z.string().email(), name: z.string() }), {
        unique: ['email'],
      }),
    })
    const col = db.users

    await col.insert({ email: 'a@example.com', name: 'A' })
    await expect(col.insert({ email: 'a@example.com', name: 'B' })).rejects.toBeInstanceOf(
      UniqueConstraintError,
    )
  })

  it('leaves existing duplicates alone until one of them is written', async () => {
    const adapter = new MemoryAdapter()
    const before = new Collection(adapter, 'users')
    const first = await before.insert({ email: 'a@example.com' })
    await before.insert({ email: 'a@example.com' })

    const col = users(adapter)
    await expect(col.insert({ email: 'c@example.com' })).resolves.toBeDefined()
    await expect(col.update({ _id: first._id }, { name: 'A' })).rejects.toBeInstanceOf(
      UniqueConstraintError,
    )
  })

  it('is not offered in path mode', () => {
    expect(
      () => new PathCollection(new MemoryAdapter(), 'pages', undefined, { unique: ['slug'] }),
    ).toThrow(/path mode/)
    expect(() =>
      flatdb(new MemoryAdapter(), {
        pages: collection(undefined, { mode: 'path', unique: ['slug'] }),
      }),
    ).toThrow(/path mode/)
  })

  it('releases the value when the file of a new document cannot be written', async () => {
    class FailingDocs extends MemoryAdapter {
      fail = true
      override async write(p: string, data: string): Promise<void> {
        if (this.fail && !p.endsWith('_index.json')) throw new Error('disk full')
        return super.write(p, data)
      }
    }
    const adapter = new FailingDocs()
    const col = users(adapter)

    await expect(col.insert({ email: 'a@example.com' })).rejects.toThrow('disk full')
    expect(await users(adapter).count()).toBe(0)

    adapter.fail = false
    await expect(col.insert({ email: 'a@example.com' })).resolves.toBeDefined()
  })
})

const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'flatdb-unique-'))
afterAll(() => fs.rm(tmpRoot, { recursive: true, force: true }))

const adapters: [string, () => () => StorageAdapter][] = [
  [
    'FsAdapter',
    () => {
      const dir = path.join(tmpRoot, `${Date.now()}-${Math.random()}`)
      return () => new FsAdapter(dir) // one adapter per writer, as one flatdb() per request
    },
  ],
  [
    'MemoryAdapter',
    () => {
      const adapter = new MemoryAdapter()
      return () => adapter
    },
  ],
  [
    'IndexedDBAdapter',
    () => {
      const adapter = new IndexedDBAdapter(`unique-${Date.now()}-${Math.random()}`)
      return () => adapter
    },
  ],
  [
    'R2Adapter',
    () => {
      const bucket = new FakeR2Bucket()
      return () => new R2Adapter({ bucket })
    },
  ],
]

describe.each(adapters)('unique under concurrent writers on %s', (_name, setup) => {
  it('lets exactly one of many parallel inserts of the same value win', async () => {
    const open = setup()

    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_, n) => users(open()).insert({ email: 'same@example.com', n })),
    )

    const won = results.filter((r) => r.status === 'fulfilled')
    const lost = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]
    expect(won).toHaveLength(1)
    expect(lost).toHaveLength(11)
    for (const { reason } of lost) expect(reason).toBeInstanceOf(UniqueConstraintError)

    expect(await users(open()).count({ email: 'same@example.com' })).toBe(1)
    expect(await docFiles(open())).toHaveLength(1) // the losers wrote no file
  })

  it('a writer with a stale index still loses', async () => {
    const open = setup()
    const a = users(open())
    const b = users(open())
    await a.find()
    await b.find() // both hold the empty index

    await a.insert({ email: 'same@example.com' })
    await expect(b.insert({ email: 'same@example.com' })).rejects.toBeInstanceOf(
      UniqueConstraintError,
    )
    await expect(b.insert({ email: 'other@example.com' })).resolves.toBeDefined()
  })

  it('two parallel updates to the same value: one wins', async () => {
    const open = setup()
    const seed = users(open())
    const x = await seed.insert({ email: 'x@example.com' })
    const y = await seed.insert({ email: 'y@example.com' })

    const results = await Promise.allSettled([
      users(open()).update({ _id: x._id }, { email: 'taken@example.com' }),
      users(open()).update({ _id: y._id }, { email: 'taken@example.com' }),
    ])

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(await users(open()).count({ email: 'taken@example.com' })).toBe(1)
  })
})
