import { describe, it, expect } from 'vitest'
import 'fake-indexeddb/auto'
import { z } from 'zod'
import { flatdb, collection } from '../src/index.js'

describe('flatdb("idb://...") auto-detection', () => {
  it('auto-selects IndexedDBAdapter for idb:// prefix', async () => {
    const db = flatdb(`idb://test-${Date.now()}-1`, {
      users: collection(z.object({
        name: z.string(),
        email: z.string(),
      })),
    })

    const user = await db.users.insert({ name: 'Max', email: 'max@example.com' })
    expect(user._id).toBeDefined()
    expect(user.name).toBe('Max')

    const found = await db.users.findById(user._id)
    expect(found!.name).toBe('Max')

    await db.users.update({ _id: user._id }, { name: 'Maximilian' })
    const updated = await db.users.findById(user._id)
    expect(updated!.name).toBe('Maximilian')

    await db.users.delete({ _id: user._id })
    expect(await db.users.findById(user._id)).toBeNull()
  })

  it('supports multiple collections via idb://', async () => {
    const db = flatdb(`idb://test-${Date.now()}-2`, {
      users: collection(z.object({ name: z.string() })),
      todos: collection(z.object({ text: z.string() })),
    })

    await db.users.insert({ name: 'Alice' })
    await db.todos.insert({ text: 'Buy milk' })

    expect(await db.users.count()).toBe(1)
    expect(await db.todos.count()).toBe(1)
  })

  it('supports schemaless collections via idb://', async () => {
    const db = flatdb(`idb://test-${Date.now()}-3`, {
      notes: collection(),
    })

    const note = await db.notes.insert({ anything: true, nested: { deep: 42 } })
    const found = await db.notes.findById(note._id)
    expect(found!.anything).toBe(true)
    expect(found!.nested.deep).toBe(42)
  })
})
