import { describe, it, expect, beforeEach } from 'vitest'
import { z } from 'zod'
import { MemoryAdapter } from '../src/memory-adapter.js'
import { Collection } from '../src/collection.js'
import { PathCollection } from '../src/path-collection.js'
import { flatdb, collection, ref } from '../src/index.js'

describe('Collection (auto mode) with MemoryAdapter', () => {
  let adapter: MemoryAdapter

  beforeEach(() => {
    adapter = new MemoryAdapter()
  })

  it('insert + findById', async () => {
    const col = new Collection(adapter, 'users')
    const user = await col.insert({ name: 'Max', email: 'max@example.com' })
    expect(user._id).toBeDefined()

    const found = await col.findById(user._id)
    expect(found!.name).toBe('Max')
  })

  it('insertMany + find', async () => {
    const col = new Collection(adapter, 'users')
    await col.insertMany([
      { name: 'A', role: 'admin' },
      { name: 'B', role: 'user' },
      { name: 'C', role: 'admin' },
    ])

    const admins = await col.find({ role: 'admin' })
    expect(admins).toHaveLength(2)
  })

  it('findOne', async () => {
    const col = new Collection(adapter, 'users')
    await col.insert({ name: 'Max', email: 'max@example.com' })

    const found = await col.findOne({ email: 'max@example.com' })
    expect(found!.name).toBe('Max')
  })

  it('count', async () => {
    const col = new Collection(adapter, 'users')
    await col.insertMany([{ name: 'A' }, { name: 'B' }])
    expect(await col.count()).toBe(2)
  })

  it('update with deep merge', async () => {
    const col = new Collection(adapter, 'users')
    const user = await col.insert({ name: 'Max', settings: { theme: 'light', lang: 'en' } })

    await col.update({ _id: user._id }, { settings: { theme: 'dark' } })

    const found = await col.findById(user._id)
    expect(found!.settings).toEqual({ theme: 'dark', lang: 'en' })
  })

  it('update with $set', async () => {
    const col = new Collection(adapter, 'users')
    const user = await col.insert({ name: 'Max', active: true })

    await col.update({ _id: user._id }, { $set: { active: false } })
    expect((await col.findById(user._id))!.active).toBe(false)
  })

  it('delete + deleteMany', async () => {
    const col = new Collection(adapter, 'users')
    await col.insertMany([
      { name: 'A', active: false },
      { name: 'B', active: false },
      { name: 'C', active: true },
    ])

    expect(await col.deleteMany({ active: false })).toBe(2)
    expect(await col.count()).toBe(1)
  })

  it('query operators work', async () => {
    const col = new Collection(adapter, 'items')
    await col.insertMany([
      { name: 'A', price: 10, tags: ['sale'] },
      { name: 'B', price: 50, tags: ['new'] },
      { name: 'C', price: 25, tags: ['sale', 'new'] },
    ])

    expect(await col.find({ price: { $gt: 20 } })).toHaveLength(2)
    expect(await col.find({ price: { $between: [15, 40] } })).toHaveLength(1)
    expect(await col.find({ tags: { $contains: 'sale' } })).toHaveLength(2)
    expect(await col.find({ name: { $in: ['A', 'C'] } })).toHaveLength(2)
    expect(await col.find({ name: { $startsWith: 'B' } })).toHaveLength(1)
  })

  it('sort, limit, skip, select', async () => {
    const col = new Collection(adapter, 'items')
    await col.insertMany([
      { name: 'C', price: 30 },
      { name: 'A', price: 10 },
      { name: 'B', price: 20 },
    ])

    const sorted = await col.find({}, { sort: { price: 1 }, limit: 2 })
    expect(sorted.map(d => d.name)).toEqual(['A', 'B'])

    const selected = await col.find({}, { select: ['name'] })
    expect(selected[0]).not.toHaveProperty('price')
  })

  it('dot-notation queries', async () => {
    const col = new Collection(adapter, 'users')
    await col.insertMany([
      { name: 'A', settings: { theme: 'dark' } },
      { name: 'B', settings: { theme: 'light' } },
    ])

    const result = await col.find({ 'settings.theme': 'dark' })
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('A')
  })

  it('$or / $and / $not', async () => {
    const col = new Collection(adapter, 'items')
    await col.insertMany([
      { name: 'A', status: 'active', featured: true },
      { name: 'B', status: 'deleted', featured: false },
      { name: 'C', status: 'active', featured: false },
    ])

    expect(await col.find({ $or: [{ status: 'deleted' }, { featured: true }] })).toHaveLength(2)
    expect(await col.find({ $not: { status: 'deleted' } })).toHaveLength(2)
  })

  it('rebuildIndex', async () => {
    const col = new Collection(adapter, 'users')
    await col.insert({ name: 'Max' })
    await col.insert({ name: 'Alice' })

    // Corrupt index
    await adapter.write('users/_index.json', '{}')
    col.invalidateCache()

    await col.rebuildIndex()
    expect(await col.count()).toBe(2)
  })

  it('Zod validation: write-strict, read-tolerant', async () => {
    const schema = z.object({
      name: z.string(),
      role: z.string().default('user'),
    })
    const col = new Collection(adapter, 'users', schema)

    // Write-strict
    await expect(col.insert({ name: 123 } as any)).rejects.toThrow()

    // Read-tolerant: default applied
    await adapter.write('users/abc.json', JSON.stringify({ name: 'Max' }))
    await adapter.write('users/_index.json', JSON.stringify({ abc: { name: 'Max' } }))
    col.invalidateCache()

    const found = await col.findById('abc')
    expect(found!.role).toBe('user')
  })

  it('reactivity: live() and liveById()', async () => {
    const col = new Collection(adapter, 'users')

    const results: any[][] = []
    col.live((docs) => results.push(docs))

    await new Promise(r => setTimeout(r, 50))
    expect(results[0]).toHaveLength(0)

    const user = await col.insert({ name: 'Max' })
    await new Promise(r => setTimeout(r, 50))
    expect(results[results.length - 1]).toHaveLength(1)

    const byIdResults: any[] = []
    const unsub = col.liveById(user._id, (doc) => byIdResults.push(doc))
    await new Promise(r => setTimeout(r, 50))
    expect(byIdResults[0]!.name).toBe('Max')

    unsub()
  })
})

describe('PathCollection with MemoryAdapter', () => {
  let adapter: MemoryAdapter

  beforeEach(() => {
    adapter = new MemoryAdapter()
  })

  it('insert + get', async () => {
    const col = new PathCollection(adapter, 'pages')
    await col.insert('about', { title: 'About Us' })

    const doc = await col.get('about')
    expect(doc!.title).toBe('About Us')
  })

  it('root document (empty path)', async () => {
    const col = new PathCollection(adapter, 'pages')
    await col.insert('', { title: 'Home' })

    const doc = await col.get('')
    expect(doc!.title).toBe('Home')
  })

  it('nested paths', async () => {
    const col = new PathCollection(adapter, 'pages')
    await col.insert('blog/post-1', { title: 'Post 1' })

    expect((await col.get('blog/post-1'))!.title).toBe('Post 1')
  })

  it('$path filter: direct children (*)', async () => {
    const col = new PathCollection(adapter, 'pages')
    await col.insert('blog', { title: 'Blog' })
    await col.insert('blog/a', { title: 'A' })
    await col.insert('blog/b', { title: 'B' })
    await col.insert('blog/sub/c', { title: 'C' })

    const results = await col.find({ $path: 'blog/*' })
    expect(results).toHaveLength(2) // a, b only (not sub/c)
  })

  it('$path filter: recursive (**)', async () => {
    const col = new PathCollection(adapter, 'pages')
    await col.insert('docs', { title: 'Docs' })
    await col.insert('docs/a', { title: 'A' })
    await col.insert('docs/api/b', { title: 'B' })

    const results = await col.find({ $path: 'docs/**' })
    expect(results).toHaveLength(3) // docs, a, b
  })

  it('update (deep merge)', async () => {
    const col = new PathCollection(adapter, 'pages')
    await col.insert('about', { title: 'About', meta: { views: 0 } })

    await col.update('about', { meta: { views: 42 } })
    const doc = await col.get('about')
    expect(doc!.title).toBe('About')
    expect(doc!.meta.views).toBe(42)
  })

  it('delete', async () => {
    const col = new PathCollection(adapter, 'pages')
    await col.insert('about', { title: 'About' })

    await col.delete('about')
    expect(await col.get('about')).toBeNull()
  })

  it('delete recursive', async () => {
    const col = new PathCollection(adapter, 'pages')
    await col.insert('docs', { title: 'Docs' })
    await col.insert('docs/a', { title: 'A' })
    await col.insert('docs/b', { title: 'B' })

    await col.delete('docs', { recursive: true })
    expect(await col.count()).toBe(0)
  })

  it('move', async () => {
    const col = new PathCollection(adapter, 'pages')
    await col.insert('draft', { title: 'Draft' })

    await col.move('draft', 'published')
    expect(await col.get('draft')).toBeNull()
    expect((await col.get('published'))!.title).toBe('Draft')
  })

  it('promote and demote', async () => {
    const col = new PathCollection(adapter, 'pages')
    await col.insert('tech', { title: 'Tech' })

    await col.promote('tech')
    expect(await col.get('tech')).not.toBeNull()
    expect(await adapter.exists('pages/tech/index.json')).toBe(true)

    await col.demote('tech')
    expect(await adapter.exists('pages/tech.json')).toBe(true)
  })

  it('tree', async () => {
    const col = new PathCollection(adapter, 'pages')
    await col.insert('docs', { title: 'Docs' })
    await col.insert('docs/a', { title: 'A' })
    await col.insert('docs/api', { title: 'API' })
    await col.insert('docs/api/auth', { title: 'Auth' })

    const tree = await col.tree('docs')
    expect(tree.path).toBe('docs')
    expect(tree.doc!.title).toBe('Docs')
    expect(tree.children).toHaveLength(2)

    const api = tree.children.find(c => c.path === 'docs/api')!
    expect(api.children).toHaveLength(1)
    expect(api.children[0].path).toBe('docs/api/auth')
  })

  it('reactivity: live() and liveByPath()', async () => {
    const col = new PathCollection(adapter, 'pages')

    const results: any[][] = []
    col.live((docs) => results.push(docs))

    await new Promise(r => setTimeout(r, 50))
    expect(results[0]).toHaveLength(0)

    await col.insert('about', { title: 'About' })
    await new Promise(r => setTimeout(r, 50))
    expect(results[results.length - 1]).toHaveLength(1)

    const pathResults: any[] = []
    const unsub = col.liveByPath('about', (doc) => pathResults.push(doc))
    await new Promise(r => setTimeout(r, 50))
    expect(pathResults[0]!.title).toBe('About')

    unsub()
  })
})

describe('flatdb() with MemoryAdapter', () => {
  it('full CRUD workflow', async () => {
    const adapter = new MemoryAdapter()
    const db = flatdb(adapter, {
      users: collection(z.object({
        name: z.string(),
        email: z.string(),
      })),
    })

    const user = await db.users.insert({ name: 'Max', email: 'max@example.com' })
    expect(user._id).toBeDefined()

    await db.users.update({ _id: user._id }, { name: 'Maximilian' })
    const updated = await db.users.findById(user._id)
    expect(updated!.name).toBe('Maximilian')

    await db.users.delete({ _id: user._id })
    expect(await db.users.findById(user._id)).toBeNull()
  })

  it('refs + populate with MemoryAdapter', async () => {
    const adapter = new MemoryAdapter()
    const db = flatdb(adapter, {
      users: collection(z.object({ name: z.string() })),
      todos: collection(z.object({
        text: z.string(),
        assignee: ref('users'),
      })),
    })

    const user = await db.users.insert({ name: 'Max' })
    const todo = await db.todos.insert({ text: 'Task', assignee: user._id })

    // Plain read
    const plain = await db.todos.findById(todo._id)
    expect(plain!.assignee).toBe(user._id)

    // Populated read
    const populated = await db.todos.findById(todo._id, { populate: ['assignee'] })
    expect(populated!.assignee).toEqual({ _id: user._id, name: 'Max' })
  })

  it('path mode with MemoryAdapter', async () => {
    const adapter = new MemoryAdapter()
    const db = flatdb(adapter, {
      pages: collection(z.object({ title: z.string() }), { mode: 'path' }),
    })

    await (db.pages as PathCollection).insert('blog/post', { title: 'My Post' })
    const doc = await (db.pages as PathCollection).get('blog/post')
    expect(doc!.title).toBe('My Post')
  })
})
