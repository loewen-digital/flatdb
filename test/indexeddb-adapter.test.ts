import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
import { IndexedDBAdapter } from '../src/indexeddb-adapter.js'

describe('IndexedDBAdapter', () => {
  let adapter: IndexedDBAdapter
  let dbName: string

  beforeEach(() => {
    dbName = `test-${Date.now()}-${Math.random()}`
    adapter = new IndexedDBAdapter(dbName)
  })

  afterEach(async () => {
    await adapter.close()
    // Delete the database
    indexedDB.deleteDatabase(dbName)
  })

  it('write and read a file', async () => {
    await adapter.write('test.json', '{"hello":"world"}')
    const data = await adapter.read('test.json')
    expect(data).toBe('{"hello":"world"}')
  })

  it('read returns null for missing file', async () => {
    expect(await adapter.read('missing.json')).toBeNull()
  })

  it('write with nested path', async () => {
    await adapter.write('a/b/c.json', '{}')
    expect(await adapter.read('a/b/c.json')).toBe('{}')
  })

  it('delete removes a file', async () => {
    await adapter.write('test.json', '{}')
    await adapter.delete('test.json')
    expect(await adapter.read('test.json')).toBeNull()
  })

  it('delete is silent for missing file', async () => {
    await expect(adapter.delete('missing.json')).resolves.toBeUndefined()
  })

  it('exists returns true/false for files', async () => {
    expect(await adapter.exists('test.json')).toBe(false)
    await adapter.write('test.json', '{}')
    expect(await adapter.exists('test.json')).toBe(true)
  })

  it('exists returns true for directory prefix', async () => {
    await adapter.write('dir/file.json', '{}')
    expect(await adapter.exists('dir')).toBe(true)
    expect(await adapter.exists('nonexistent')).toBe(false)
  })

  it('list returns entries in a directory', async () => {
    await adapter.write('dir/a.json', '{}')
    await adapter.write('dir/b.json', '{}')
    const entries = await adapter.list('dir')
    expect(entries.sort()).toEqual(['a.json', 'b.json'])
  })

  it('list returns only direct children', async () => {
    await adapter.write('dir/a.json', '{}')
    await adapter.write('dir/sub/b.json', '{}')
    const entries = await adapter.list('dir')
    expect(entries.sort()).toEqual(['a.json', 'sub'])
  })

  it('list returns empty for missing directory', async () => {
    expect(await adapter.list('missing')).toEqual([])
  })

  it('mkdir is a no-op', async () => {
    await expect(adapter.mkdir('x/y/z')).resolves.toBeUndefined()
  })

  it('move renames a file', async () => {
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
})

describe('IndexedDBAdapter with Collection', () => {
  let adapter: IndexedDBAdapter
  let dbName: string

  beforeEach(() => {
    dbName = `test-col-${Date.now()}-${Math.random()}`
    adapter = new IndexedDBAdapter(dbName)
  })

  afterEach(async () => {
    await adapter.close()
    indexedDB.deleteDatabase(dbName)
  })

  it('works with Collection for full CRUD', async () => {
    const { Collection } = await import('../src/collection.js')

    const col = new Collection(adapter, 'users')
    const user = await col.insert({ name: 'Max', email: 'max@example.com' })
    expect(user._id).toBeDefined()

    const found = await col.findById(user._id)
    expect(found!.name).toBe('Max')

    await col.update({ _id: user._id }, { name: 'Maximilian' })
    expect((await col.findById(user._id))!.name).toBe('Maximilian')

    await col.delete({ _id: user._id })
    expect(await col.findById(user._id)).toBeNull()
  })

  it('works with PathCollection', async () => {
    const { PathCollection } = await import('../src/path-collection.js')

    const col = new PathCollection(adapter, 'pages')
    await col.insert('about', { title: 'About' })
    await col.insert('blog/post', { title: 'Post' })

    expect((await col.get('about'))!.title).toBe('About')
    expect((await col.get('blog/post'))!.title).toBe('Post')

    const results = await col.find({ $path: 'blog/*' })
    expect(results).toHaveLength(1)

    await col.delete('about')
    expect(await col.get('about')).toBeNull()
  })
})
