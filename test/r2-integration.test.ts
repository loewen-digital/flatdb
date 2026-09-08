import { describe, it, expect, beforeEach } from 'vitest'
import { z } from 'zod'
import { R2Adapter } from '../src/r2-adapter.js'
import { Collection } from '../src/collection.js'
import { PathCollection } from '../src/path-collection.js'
import { flatdb, collection, ref } from '../src/index.js'
import { FakeR2Bucket } from './fake-r2-bucket.js'

describe('Collection (auto mode) with R2Adapter', () => {
  let bucket: FakeR2Bucket
  let adapter: R2Adapter

  beforeEach(() => {
    bucket = new FakeR2Bucket()
    adapter = new R2Adapter({ bucket })
  })

  it('insert writes the document and the index', async () => {
    const col = new Collection(adapter, 'users')
    const user = await col.insert({ name: 'Max' })

    expect(bucket.objects.has(`users/${user._id}.json`)).toBe(true)
    expect(bucket.objects.has('users/_index.json')).toBe(true)
  })

  it('find with a filter answers from the index', async () => {
    const col = new Collection(adapter, 'users')
    await col.insertMany([
      { name: 'A', role: 'admin' },
      { name: 'B', role: 'user' },
      { name: 'C', role: 'admin' },
    ])

    const fresh = new Collection(adapter, 'users')
    bucket.calls.length = 0
    const admins = await fresh.find({ role: 'admin' })

    expect(admins.map(d => d.name).sort()).toEqual(['A', 'C'])
    expect(bucket.calls).toEqual(['get users/_index.json'])
  })

  it('update and delete', async () => {
    const col = new Collection(adapter, 'users')
    const user = await col.insert({ name: 'Max', settings: { theme: 'light', lang: 'en' } })

    await col.update({ _id: user._id }, { settings: { theme: 'dark' } })
    expect((await col.findById(user._id))!.settings).toEqual({ theme: 'dark', lang: 'en' })

    await col.delete({ _id: user._id })
    expect(await col.findById(user._id)).toBeNull()
    expect(bucket.objects.has(`users/${user._id}.json`)).toBe(false)
  })

  it('rebuildIndex picks up documents written straight into the bucket', async () => {
    bucket = new FakeR2Bucket(2)
    adapter = new R2Adapter({ bucket })
    const col = new Collection(adapter, 'users')
    await col.insert({ name: 'Max' })

    for (const name of ['Ada', 'Bob', 'Cy', 'Di']) {
      await bucket.put(`users/${name.toLowerCase()}.json`, JSON.stringify({ name }))
    }
    expect(await col.count()).toBe(1)

    await col.rebuildIndex()
    expect(await col.count()).toBe(5)
    expect((await col.findById('ada'))!.name).toBe('Ada')
  })
})

describe('PathCollection with R2Adapter', () => {
  let bucket: FakeR2Bucket
  let adapter: R2Adapter

  beforeEach(() => {
    bucket = new FakeR2Bucket()
    adapter = new R2Adapter({ bucket })
  })

  it('insert, get, $path filters and tree', async () => {
    const col = new PathCollection(adapter, 'pages')
    await col.insert('docs', { title: 'Docs' })
    await col.insert('docs/a', { title: 'A' })
    await col.insert('docs/api', { title: 'API' })
    await col.insert('docs/api/auth', { title: 'Auth' })

    expect(bucket.objects.has('pages/docs/api/auth.json')).toBe(true)
    expect((await col.get('docs/api/auth'))!.title).toBe('Auth')
    expect(await col.find({ $path: 'docs/*' })).toHaveLength(2)
    expect(await col.find({ $path: 'docs/**' })).toHaveLength(4)

    const tree = await col.tree('docs')
    expect(tree.children.map(c => c.path)).toEqual(['docs/a', 'docs/api'])
  })

  it('update writes to the node file after promote', async () => {
    const col = new PathCollection(adapter, 'pages')
    await col.insert('tech', { title: 'Tech' })

    await col.promote('tech')
    expect(bucket.objects.has('pages/tech/index.json')).toBe(true)
    expect(bucket.objects.has('pages/tech.json')).toBe(false)

    await col.update('tech', { title: 'Technology' })
    expect(JSON.parse(bucket.objects.get('pages/tech/index.json')!).title).toBe('Technology')

    await col.demote('tech')
    expect(bucket.objects.has('pages/tech.json')).toBe(true)
  })

  it('move relocates a whole subtree', async () => {
    const col = new PathCollection(adapter, 'pages')
    await col.insert('draft', { title: 'Draft' })
    await col.insert('draft/part-1', { title: 'Part 1' })
    await col.promote('draft')

    await col.move('draft', 'published')

    expect(await col.get('draft')).toBeNull()
    expect((await col.get('published'))!.title).toBe('Draft')
    expect((await col.get('published/part-1'))!.title).toBe('Part 1')
    expect([...bucket.objects.keys()].filter(k => k.startsWith('pages/draft'))).toEqual([])
  })

  it('delete recursive removes the files', async () => {
    const col = new PathCollection(adapter, 'pages')
    await col.insert('docs', { title: 'Docs' })
    await col.insert('docs/a', { title: 'A' })
    await col.insert('docs/b', { title: 'B' })

    await col.delete('docs', { recursive: true })

    expect(await col.count()).toBe(0)
    expect([...bucket.objects.keys()]).toEqual(['pages/_index.json'])
  })

  it('rebuildIndex walks nested folders across pages', async () => {
    bucket = new FakeR2Bucket(2)
    adapter = new R2Adapter({ bucket })
    const col = new PathCollection(adapter, 'pages')

    await bucket.put('pages/index.json', JSON.stringify({ title: 'Home' }))
    await bucket.put('pages/about.json', JSON.stringify({ title: 'About' }))
    await bucket.put('pages/blog/index.json', JSON.stringify({ title: 'Blog' }))
    await bucket.put('pages/blog/a.json', JSON.stringify({ title: 'A' }))
    await bucket.put('pages/blog/b.json', JSON.stringify({ title: 'B' }))
    await bucket.put('pages/blog/2024/c.json', JSON.stringify({ title: 'C' }))

    await col.rebuildIndex()

    const paths = Object.keys(JSON.parse(bucket.objects.get('pages/_index.json')!)).sort()
    expect(paths).toEqual(['', 'about', 'blog', 'blog/2024/c', 'blog/a', 'blog/b'])
  })
})

describe('flatdb() with R2Adapter', () => {
  it('full CRUD workflow under a bucket prefix', async () => {
    const bucket = new FakeR2Bucket()
    const db = flatdb(new R2Adapter({ bucket, prefix: 'data' }), {
      users: collection(z.object({
        name: z.string(),
        email: z.string(),
      })),
    })

    const user = await db.users.insert({ name: 'Max', email: 'max@example.com' })
    expect(bucket.objects.has(`data/users/${user._id}.json`)).toBe(true)

    await db.users.update({ _id: user._id }, { name: 'Maximilian' })
    expect((await db.users.findById(user._id))!.name).toBe('Maximilian')
    expect(await db.users.find({ email: 'max@example.com' })).toHaveLength(1)

    await db.users.delete({ _id: user._id })
    expect(await db.users.findById(user._id)).toBeNull()
  })

  it('refs + populate', async () => {
    const db = flatdb(new R2Adapter({ bucket: new FakeR2Bucket() }), {
      users: collection(z.object({ name: z.string() })),
      todos: collection(z.object({
        text: z.string(),
        assignee: ref('users'),
      })),
    })

    const user = await db.users.insert({ name: 'Max' })
    const todo = await db.todos.insert({ text: 'Task', assignee: user._id })

    const populated = await db.todos.findById(todo._id, { populate: ['assignee'] })
    expect(populated!.assignee).toEqual({ _id: user._id, name: 'Max' })
  })

  it('path mode', async () => {
    const db = flatdb(new R2Adapter({ bucket: new FakeR2Bucket() }), {
      pages: collection(z.object({ title: z.string() }), { mode: 'path' }),
    })

    await (db.pages as PathCollection).insert('blog/post', { title: 'My Post' })
    expect((await (db.pages as PathCollection).get('blog/post'))!.title).toBe('My Post')
  })

  it('watch option is ignored without adapter support', async () => {
    const db = flatdb(new R2Adapter({ bucket: new FakeR2Bucket() }), {
      users: collection(),
    }, { watch: true })

    await db.users.insert({ name: 'Max' })
    expect(await db.users.count()).toBe(1)
  })
})
