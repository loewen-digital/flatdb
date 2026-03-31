import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { flatdb, collection } from '../src/flatdb.js'

describe('flatdb()', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flatdb-init-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('creates collections from definitions', async () => {
    const db = flatdb(tmpDir, {
      users: collection(
        z.object({
          name: z.string(),
          email: z.string(),
        }),
      ),
      todos: collection(),
    })

    expect(db.users).toBeDefined()
    expect(db.todos).toBeDefined()
  })

  it('full CRUD workflow through flatdb()', async () => {
    const db = flatdb(tmpDir, {
      users: collection(
        z.object({
          name: z.string(),
          email: z.string(),
          role: z.string().default('user'),
        }),
      ),
    })

    // Insert
    const user = await db.users.insert({ name: 'Max', email: 'max@example.com' })
    expect(user._id).toBeDefined()
    expect(user.role).toBe('user')

    // Find
    const found = await db.users.findById(user._id)
    expect(found!.name).toBe('Max')

    // Update
    await db.users.update({ _id: user._id }, { name: 'Maximilian' })
    const updated = await db.users.findById(user._id)
    expect(updated!.name).toBe('Maximilian')

    // Delete
    await db.users.delete({ _id: user._id })
    const gone = await db.users.findById(user._id)
    expect(gone).toBeNull()
  })

  it('schemaless collection works without zod', async () => {
    const db = flatdb(tmpDir, {
      notes: collection(),
    })

    const note = await db.notes.insert({ text: 'hello', tags: ['a', 'b'] })
    expect(note.text).toBe('hello')

    const found = await db.notes.find({ tags: { $contains: 'a' } })
    expect(found).toHaveLength(1)
  })

  it('enforces schema on write', async () => {
    const db = flatdb(tmpDir, {
      users: collection(
        z.object({
          name: z.string(),
          email: z.string(),
        }),
      ),
    })

    await expect(db.users.insert({ name: 123 } as any)).rejects.toThrow()
  })

  it('supports complex queries through flatdb()', async () => {
    const db = flatdb(tmpDir, {
      products: collection(
        z.object({
          name: z.string(),
          price: z.number(),
          category: z.string(),
          inStock: z.boolean().default(true),
        }),
      ),
    })

    await db.products.insertMany([
      { name: 'Widget', price: 10, category: 'tools' },
      { name: 'Gadget', price: 50, category: 'electronics' },
      { name: 'Doohickey', price: 25, category: 'tools' },
      { name: 'Thingamajig', price: 100, category: 'electronics' },
    ])

    // $gt query
    const expensive = await db.products.find({ price: { $gt: 30 } })
    expect(expensive).toHaveLength(2)

    // $in query
    const tools = await db.products.find({ category: { $in: ['tools'] } })
    expect(tools).toHaveLength(2)

    // Sort + limit
    const cheapest = await db.products.find({}, { sort: { price: 1 }, limit: 2 })
    expect(cheapest[0].name).toBe('Widget')
    expect(cheapest[1].name).toBe('Doohickey')

    // Count
    expect(await db.products.count({ category: 'electronics' })).toBe(2)

    // $or
    const result = await db.products.find({
      $or: [{ price: { $lt: 15 } }, { price: { $gt: 80 } }],
    })
    expect(result).toHaveLength(2)
  })

  it('data persists: new Collection instance reads existing data', async () => {
    const db1 = flatdb(tmpDir, { users: collection() })
    await db1.users.insert({ name: 'Max' })

    // Simulate a new "session" by creating a fresh instance
    const db2 = flatdb(tmpDir, { users: collection() })
    const all = await db2.users.find()
    expect(all).toHaveLength(1)
    expect(all[0].name).toBe('Max')
  })
})
