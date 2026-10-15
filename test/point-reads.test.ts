import { createHash } from 'node:crypto'
import { describe, it, expect, beforeEach } from 'vite-plus/test'
import { z } from 'zod'
import { R2Adapter } from '../src/r2-adapter.js'
import { MemoryAdapter } from '../src/memory-adapter.js'
import { Collection } from '../src/collection.js'
import { UniqueConstraintError } from '../src/unique.js'
import { FakeR2Bucket } from './fake-r2-bucket.js'

const sessionSchema = z.object({ token: z.string(), user: z.string() })

/** Key of the lookup object for `value` in `field`, as the collection names it. */
function lookupKey(collection: string, field: string, value: unknown): string {
  const hash = createHash('sha256').update(JSON.stringify(value)).digest('hex')
  return `${collection}/_unique/${field}/${hash}.json`
}

describe('point reads on R2', () => {
  let bucket: FakeR2Bucket
  let adapter: R2Adapter

  beforeEach(() => {
    bucket = new FakeR2Bucket()
    adapter = new R2Adapter({ bucket })
  })

  /** A new instance, as each Worker request opens one; the call log starts empty. */
  function fresh(options: ConstructorParameters<typeof Collection>[3] = { unique: ['token'] }) {
    bucket.calls.length = 0
    return new Collection(adapter, 'sessions', sessionSchema, options)
  }

  describe('findById', () => {
    it('reads the document file, not the index, and returns the same document', async () => {
      const writer = new Collection(adapter, 'sessions', sessionSchema)
      const { _id } = await writer.insert({ token: 't1', user: 'ann' })
      const fromIndex = await new Collection(adapter, 'sessions', sessionSchema)
        .find()
        .then((docs) => docs[0])

      const col = fresh({})
      expect(await col.findById(_id)).toEqual(fromIndex)
      expect(bucket.calls).toEqual([`get sessions/${_id}.json`])
    })

    it('returns null for a missing document after one read', async () => {
      const col = fresh({})
      expect(await col.findById('nope')).toBeNull()
      expect(bucket.calls).toEqual(['get sessions/nope.json'])
    })

    it('refuses IDs that could leave the collection without reading anything', async () => {
      bucket.objects.set('users/admin.json', JSON.stringify({ token: 'x', user: 'root' }))
      const col = fresh({})
      expect(await col.findById('../users/admin')).toBeNull()
      expect(await col.findById('')).toBeNull()
      expect(bucket.calls).toEqual([])
    })

    it('answers from the cached index once it is loaded', async () => {
      const col = fresh({})
      const { _id } = await col.insert({ token: 't1', user: 'ann' })
      bucket.calls.length = 0
      expect((await col.findById(_id))?.user).toBe('ann')
      expect(bucket.calls).toEqual([])
    })

    it('applies migrate and the schema like a read through the index', async () => {
      const writer = new Collection(adapter, 'sessions')
      const { _id } = await writer.insert({ token: 't1', owner: 'ann' })
      const col = fresh({ migrate: (doc) => ({ user: doc.owner, ...doc }) })
      expect(await col.findById(_id)).toEqual({ _id, token: 't1', user: 'ann' })
    })
  })

  describe('findOne on a unique field', () => {
    it('goes value → lookup → document in two reads', async () => {
      const { _id } = await fresh().insert({ token: 't1', user: 'ann' })

      const col = fresh()
      expect(await col.findOne({ token: 't1' })).toEqual({ _id, token: 't1', user: 'ann' })
      expect(bucket.calls).toEqual([
        `get ${lookupKey('sessions', 'token', 't1')}`,
        `get sessions/${_id}.json`,
      ])

      bucket.calls.length = 0
      expect((await fresh().findOne({ token: { $eq: 't1' } }))?._id).toBe(_id)
      expect(bucket.calls).not.toContain('get sessions/_index.json')
    })

    it('answers a miss from the lookups without loading the index', async () => {
      await fresh().insert({ token: 't1', user: 'ann' })

      const col = fresh()
      expect(await col.findOne({ token: 'forged' })).toBeNull()
      expect(bucket.calls).toEqual([
        `get ${lookupKey('sessions', 'token', 'forged')}`,
        'get sessions/_unique/_ready.json',
      ])
    })

    it('keeps the index path for other filters', async () => {
      await fresh().insert({ token: 't1', user: 'ann' })
      for (const filter of [
        { user: 'ann' },
        { token: 't1', user: 'ann' },
        { token: { $ne: 'x' } },
      ]) {
        const col = fresh()
        expect((await col.findOne(filter))?.token).toBe('t1')
        expect(bucket.calls).toEqual(['get sessions/_index.json'])
      }
    })

    it('follows an update of the unique field and drops the old lookup', async () => {
      const writer = fresh()
      const { _id } = await writer.insert({ token: 'old', user: 'ann' })
      await writer.update({ _id }, { token: 'new' })

      expect(bucket.objects.has(lookupKey('sessions', 'token', 'old'))).toBe(false)
      expect(await fresh().findOne({ token: 'old' })).toBeNull()
      expect((await fresh().findOne({ token: 'new' }))?._id).toBe(_id)
    })

    it('drops the lookup when the document is deleted', async () => {
      const writer = fresh()
      await writer.insert({ token: 't1', user: 'ann' })
      await writer.delete({ token: 't1' })

      expect(bucket.objects.has(lookupKey('sessions', 'token', 't1'))).toBe(false)
      expect(await fresh().findOne({ token: 't1' })).toBeNull()
    })

    it('does not trust a lookup whose document no longer has the value', async () => {
      const writer = fresh()
      const a = await writer.insert({ token: 'a', user: 'ann' })
      await writer.insert({ token: 'b', user: 'bob' })
      // A stale lookup, e.g. left by an interrupted update
      bucket.objects.set(lookupKey('sessions', 'token', 'b'), JSON.stringify({ id: a._id }))

      expect(await fresh().findOne({ token: 'b' })).toBeNull()
    })

    it('does not delete a lookup another document has taken over', async () => {
      const writer = fresh()
      const a = await writer.insert({ token: 'a', user: 'ann' })
      const b = await writer.insert({ token: 'b', user: 'bob' })
      bucket.objects.set(lookupKey('sessions', 'token', 'a'), JSON.stringify({ id: b._id }))

      await writer.delete({ _id: a._id })
      expect(bucket.objects.get(lookupKey('sessions', 'token', 'a'))).toBe(
        JSON.stringify({ id: b._id }),
      )
    })
  })

  describe('collections without complete lookups', () => {
    /** Data written before lookups existed: documents and index, no `_unique/`. */
    async function legacy() {
      const writer = new Collection(new R2Adapter({ bucket }), 'sessions', sessionSchema)
      const docs = await writer.insertMany([
        { token: 't1', user: 'ann' },
        { token: 't2', user: 'bob' },
      ])
      for (const key of bucket.objects.keys()) {
        if (key.includes('/_unique/')) bucket.objects.delete(key)
      }
      return docs
    }

    it('fall back to the index until rebuildIndex() completes them', async () => {
      const [ann] = await legacy()

      const col = fresh()
      expect((await col.findOne({ token: 't1' }))?._id).toBe(ann._id)
      expect(bucket.calls).toContain('get sessions/_index.json')

      await fresh().rebuildIndex()
      expect(bucket.objects.get('sessions/_unique/_ready.json')).toBe(
        JSON.stringify({ fields: ['token'] }),
      )
      const after = fresh()
      expect((await after.findOne({ token: 't1' }))?._id).toBe(ann._id)
      expect(await after.findOne({ token: 'nope' })).toBeNull()
      expect(bucket.calls).not.toContain('get sessions/_index.json')
    })

    it('fall back for a unique field added after the collection was marked complete', async () => {
      await fresh().insert({ token: 't1', user: 'ann' })

      const col = fresh({ unique: ['token', 'user'] })
      expect((await col.findOne({ user: 'ann' }))?.token).toBe('t1')
      expect(bucket.calls).toContain('get sessions/_index.json')
    })

    it('mark a collection complete only when its index was empty', async () => {
      await legacy()
      await fresh().insert({ token: 't3', user: 'cy' })
      expect(bucket.objects.has('sessions/_unique/_ready.json')).toBe(false)
    })
  })

  it('keeps lookups complete under parallel writers from separate instances', async () => {
    const docs = await Promise.all(
      Array.from({ length: 20 }, (_, n) =>
        new Collection(adapter, 'sessions', sessionSchema, { unique: ['token'] }).insert({
          token: `t${n}`,
          user: `u${n}`,
        }),
      ),
    )

    for (const doc of docs) {
      const col = fresh()
      expect(await col.findOne({ token: doc.token })).toEqual(doc)
      expect(bucket.calls).not.toContain('get sessions/_index.json')
    }
    expect(await fresh().findOne({ token: 'nope' })).toBeNull()
  })

  it('still refuses duplicates through the index', async () => {
    await fresh().insert({ token: 't1', user: 'ann' })
    await expect(fresh().insert({ token: 't1', user: 'bob' })).rejects.toBeInstanceOf(
      UniqueConstraintError,
    )
    // Checked against the index inside its compare-and-swap; nothing gets written
    expect(bucket.calls).toEqual(['get sessions/_index.json'])
  })
})

describe('MemoryAdapter keeps reading the index', () => {
  it('findById does not return members of Object.prototype', async () => {
    const col = new Collection(new MemoryAdapter(), 'sessions')
    await col.insert({ token: 't1' })
    expect(await col.findById('constructor')).toBeNull()
    expect(await col.findById('__proto__')).toBeNull()
  })

  it('writes no lookups and answers findById and findOne from the index', async () => {
    const adapter = new MemoryAdapter()
    const writer = new Collection(adapter, 'sessions', sessionSchema, { unique: ['token'] })
    const { _id } = await writer.insert({ token: 't1', user: 'ann' })

    expect(await adapter.list('sessions')).not.toContain('_unique')
    const col = new Collection(adapter, 'sessions', sessionSchema, { unique: ['token'] })
    expect((await col.findOne({ token: 't1' }))?._id).toBe(_id)
    expect((await col.findById(_id))?.user).toBe('ann')
  })
})

describe('insert with a caller-supplied _id', () => {
  for (const [name, make] of [
    ['MemoryAdapter', () => new MemoryAdapter()],
    ['R2Adapter', () => new R2Adapter({ bucket: new FakeR2Bucket() })],
  ] as const) {
    describe(name, () => {
      it('stores the document under that ID', async () => {
        const adapter = make()
        const col = new Collection(adapter, 'sessions', sessionSchema)
        const doc = await col.insert({ _id: 'hash_abc-123', token: 't1', user: 'ann' })

        expect(doc).toEqual({ _id: 'hash_abc-123', token: 't1', user: 'ann' })
        expect(JSON.parse((await adapter.read('sessions/hash_abc-123.json'))!)).toEqual({
          token: 't1',
          user: 'ann',
        })
        const reader = new Collection(adapter, 'sessions', sessionSchema)
        expect(await reader.findById('hash_abc-123')).toEqual(doc)
      })

      it('refuses an ID that exists and leaves the stored document alone', async () => {
        const adapter = make()
        const col = new Collection(adapter, 'sessions', sessionSchema)
        await col.insert({ _id: 'same', token: 't1', user: 'ann' })

        const error = await col.insert({ _id: 'same', token: 't2', user: 'bob' }).catch((e) => e)
        expect(error).toBeInstanceOf(UniqueConstraintError)
        expect(error).toMatchObject({ collection: 'sessions', field: '_id', value: 'same' })
        expect(JSON.parse((await adapter.read('sessions/same.json'))!).user).toBe('ann')
        expect(await new Collection(adapter, 'sessions').count()).toBe(1)
      })

      it('refuses a batch that repeats an ID or reuses a stored one, writing nothing', async () => {
        const adapter = make()
        const col = new Collection(adapter, 'sessions', sessionSchema)
        await col.insert({ _id: 'taken', token: 't0', user: 'zoe' })

        await expect(
          col.insertMany([
            { _id: 'x', token: 't1', user: 'ann' },
            { _id: 'x', token: 't2', user: 'bob' },
          ]),
        ).rejects.toBeInstanceOf(UniqueConstraintError)
        await expect(
          col.insertMany([
            { _id: 'y', token: 't1', user: 'ann' },
            { _id: 'taken', token: 't2', user: 'bob' },
          ]),
        ).rejects.toBeInstanceOf(UniqueConstraintError)
        expect(await adapter.exists('sessions/y.json')).toBe(false)
        expect(await new Collection(adapter, 'sessions').count()).toBe(1)
      })

      it('rejects IDs outside nanoid’s characters', async () => {
        const col = new Collection(make(), 'sessions')
        for (const _id of ['../x', 'a/b', '', 'a b', 'ä', 42, 'x'.repeat(129)]) {
          await expect(col.insert({ _id, token: 't' })).rejects.toThrow(/_id must be/)
        }
      })
    })
  }

  it('without a schema no longer keeps _id inside the stored document', async () => {
    const adapter = new MemoryAdapter()
    const col = new Collection(adapter, 'notes')
    const doc = await col.insert({ _id: 'n1', text: 'hi' })
    expect(doc).toEqual({ _id: 'n1', text: 'hi' })
    expect(JSON.parse((await adapter.read('notes/n1.json'))!)).toEqual({ text: 'hi' })
  })
})
