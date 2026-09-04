import { describe, it, expect, beforeEach } from 'vitest'
import { z } from 'zod'
import { R2Adapter, type R2BucketLike } from '../src/r2-adapter.js'
import { Collection } from '../src/collection.js'
import { flatdb, collection } from '../src/index.js'

/** In-memory fake of an R2 bucket binding, with configurable page size to exercise cursor pagination. */
class FakeR2Bucket implements R2BucketLike {
  store = new Map<string, string>()
  headCalls = 0
  getCalls = 0

  constructor(private pageSize = 1000, private withHead = true) {}

  async get(key: string) {
    this.getCalls++
    const value = this.store.get(key)
    if (value === undefined) return null
    return { text: async () => value }
  }

  async put(key: string, value: string) {
    this.store.set(key, value)
  }

  async delete(key: string) {
    this.store.delete(key)
  }

  get head() {
    if (!this.withHead) return undefined
    return async (key: string) => {
      this.headCalls++
      return this.store.has(key) ? {} : null
    }
  }

  async list(options?: { prefix?: string; cursor?: string; limit?: number }) {
    const prefix = options?.prefix ?? ''
    const allKeys = [...this.store.keys()].filter(k => k.startsWith(prefix)).sort()
    const start = options?.cursor ? Number(options.cursor) : 0
    const end = Math.min(start + this.pageSize, allKeys.length)
    const truncated = end < allKeys.length
    return {
      objects: allKeys.slice(start, end).map(key => ({ key })),
      truncated,
      cursor: truncated ? String(end) : undefined,
    }
  }
}

describe('R2Adapter', () => {
  let bucket: FakeR2Bucket
  let adapter: R2Adapter

  beforeEach(() => {
    bucket = new FakeR2Bucket()
    adapter = new R2Adapter({ bucket })
  })

  it('write and read a file', async () => {
    await adapter.write('test.json', '{"hello":"world"}')
    expect(await adapter.read('test.json')).toBe('{"hello":"world"}')
  })

  it('read returns null for missing file', async () => {
    expect(await adapter.read('missing.json')).toBeNull()
  })

  it('delete removes a file', async () => {
    await adapter.write('test.json', '{}')
    await adapter.delete('test.json')
    expect(await adapter.read('test.json')).toBeNull()
  })

  it('delete is silent for missing file', async () => {
    await expect(adapter.delete('missing.json')).resolves.toBeUndefined()
  })

  it('exists uses head when available', async () => {
    expect(await adapter.exists('test.json')).toBe(false)
    await adapter.write('test.json', '{}')
    expect(await adapter.exists('test.json')).toBe(true)
    expect(bucket.headCalls).toBeGreaterThan(0)
    expect(bucket.getCalls).toBe(0)
  })

  it('exists falls back to get when head is unavailable', async () => {
    const noHeadBucket = new FakeR2Bucket(1000, false)
    const noHeadAdapter = new R2Adapter({ bucket: noHeadBucket })

    expect(await noHeadAdapter.exists('test.json')).toBe(false)
    await noHeadBucket.put('test.json', '{}')
    expect(await noHeadAdapter.exists('test.json')).toBe(true)
    expect(noHeadBucket.getCalls).toBeGreaterThan(0)
  })

  it('exists is true for an implicit directory prefix', async () => {
    expect(await adapter.exists('dir')).toBe(false)
    await adapter.write('dir/file.json', '{}')
    expect(await adapter.exists('dir')).toBe(true)
    expect(await adapter.exists('dir/')).toBe(true)
  })

  it('mkdir is a no-op', async () => {
    await expect(adapter.mkdir('x/y/z')).resolves.toBeUndefined()
  })

  it('list returns direct children of a directory, deduplicated', async () => {
    await adapter.write('dir/a.json', '{}')
    await adapter.write('dir/b.json', '{}')
    await adapter.write('dir/sub/c.json', '{}')
    const entries = await adapter.list('dir')
    expect(entries.sort()).toEqual(['a.json', 'b.json', 'sub'])
  })

  it('list returns empty array for missing directory', async () => {
    expect(await adapter.list('missing')).toEqual([])
  })

  it('list paginates through the bucket cursor until truncated is false', async () => {
    const smallPageBucket = new FakeR2Bucket(2)
    const paginatedAdapter = new R2Adapter({ bucket: smallPageBucket })

    for (let i = 0; i < 7; i++) {
      await smallPageBucket.put(`dir/doc-${i}.json`, '{}')
    }

    const entries = await paginatedAdapter.list('dir')
    expect(entries.sort()).toEqual(
      Array.from({ length: 7 }, (_, i) => `doc-${i}.json`).sort(),
    )
  })

  it('move renames a file (copy then delete)', async () => {
    await adapter.write('old.json', '{"v":1}')
    await adapter.move('old.json', 'new.json')
    expect(await adapter.read('old.json')).toBeNull()
    expect(await adapter.read('new.json')).toBe('{"v":1}')
  })

  it('move renames a directory', async () => {
    await adapter.write('dir/a.json', '{"a":1}')
    await adapter.write('dir/sub/b.json', '{"b":2}')
    await adapter.move('dir', 'newdir')
    expect(await adapter.read('dir/a.json')).toBeNull()
    expect(await adapter.read('newdir/a.json')).toBe('{"a":1}')
    expect(await adapter.read('newdir/sub/b.json')).toBe('{"b":2}')
  })

  describe('prefix option', () => {
    it('namespaces all keys under the bucket prefix', async () => {
      const prefixed = new R2Adapter({ bucket, prefix: 'content' })
      await prefixed.write('a.json', '{}')

      expect(bucket.store.has('content/a.json')).toBe(true)
      expect(await prefixed.read('a.json')).toBe('{}')
      expect(await adapter.read('content/a.json')).toBe('{}')
    })

    it('normalises trailing slashes on the prefix', async () => {
      const prefixed = new R2Adapter({ bucket, prefix: 'content///' })
      await prefixed.write('a.json', '{}')
      expect(bucket.store.has('content/a.json')).toBe(true)
    })
  })

  describe('collection round-trip', () => {
    it('runs find with a filter after inserts, backed by the automatic _index.json', async () => {
      const col = new Collection(adapter, 'users')
      await col.insertMany([
        { name: 'A', role: 'admin' },
        { name: 'B', role: 'user' },
        { name: 'C', role: 'admin' },
      ])

      const admins = await col.find({ role: 'admin' })
      expect(admins).toHaveLength(2)
      expect(bucket.store.has('users/_index.json')).toBe(true)
    })

    it('full CRUD workflow through flatdb()', async () => {
      const db = flatdb(adapter, {
        users: collection(z.object({ name: z.string(), email: z.string() })),
      })

      const user = await db.users.insert({ name: 'Max', email: 'max@example.com' })
      expect(user._id).toBeDefined()

      await db.users.update({ _id: user._id }, { name: 'Maximilian' })
      const updated = await db.users.findById(user._id)
      expect(updated!.name).toBe('Maximilian')

      await db.users.delete({ _id: user._id })
      expect(await db.users.findById(user._id)).toBeNull()
    })
  })
})
