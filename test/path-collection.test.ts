import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { FsAdapter } from '../src/fs-adapter.js'
import { PathCollection } from '../src/path-collection.js'

describe('PathCollection', () => {
  let adapter: FsAdapter
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flatdb-path-'))
    adapter = new FsAdapter(tmpDir)
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  describe('insert + get', () => {
    it('inserts a document at a path', async () => {
      const col = new PathCollection(adapter, 'pages')
      await col.insert('about', { title: 'About Us' })

      const raw = await adapter.read('pages/about.json')
      expect(raw).not.toBeNull()
      expect(JSON.parse(raw!).title).toBe('About Us')
    })

    it('gets a document by path', async () => {
      const col = new PathCollection(adapter, 'pages')
      await col.insert('about', { title: 'About Us' })

      const doc = await col.get('about')
      expect(doc).not.toBeNull()
      expect(doc!.title).toBe('About Us')
    })

    it('returns null for missing path', async () => {
      const col = new PathCollection(adapter, 'pages')
      expect(await col.get('nonexistent')).toBeNull()
    })

    it('inserts nested paths', async () => {
      const col = new PathCollection(adapter, 'pages')
      await col.insert('blog/my-first-post', { title: 'First Post' })

      const doc = await col.get('blog/my-first-post')
      expect(doc!.title).toBe('First Post')
    })

    it('inserts root document (empty path)', async () => {
      const col = new PathCollection(adapter, 'pages')
      await col.insert('', { title: 'Home' })

      const doc = await col.get('')
      expect(doc!.title).toBe('Home')

      // Stored as pages/index.json
      const raw = await adapter.read('pages/index.json')
      expect(raw).not.toBeNull()
    })

    it('updates _index.json', async () => {
      const col = new PathCollection(adapter, 'pages')
      await col.insert('about', { title: 'About' })

      const indexRaw = await adapter.read('pages/_index.json')
      const index = JSON.parse(indexRaw!)
      expect(index['about'].title).toBe('About')
    })
  })

  describe('find with $path', () => {
    let col: PathCollection

    beforeEach(async () => {
      col = new PathCollection(adapter, 'pages')
      await col.insert('', { title: 'Home' })
      await col.insert('about', { title: 'About' })
      await col.insert('blog', { title: 'Blog' })
      await col.insert('blog/post-1', { title: 'Post 1', published: true })
      await col.insert('blog/post-2', { title: 'Post 2', published: false })
      await col.insert('docs', { title: 'Docs' })
      await col.insert('docs/getting-started', { title: 'Getting Started' })
      await col.insert('docs/api', { title: 'API' })
      await col.insert('docs/api/auth', { title: 'Auth' })
    })

    it('finds direct children with *', async () => {
      const results = await col.find({ $path: 'blog/*' })
      expect(results).toHaveLength(2)
      expect(results.map(r => r.title).sort()).toEqual(['Post 1', 'Post 2'])
    })

    it('finds all descendants with **', async () => {
      const results = await col.find({ $path: 'docs/**' })
      // docs itself + docs/getting-started + docs/api + docs/api/auth
      expect(results).toHaveLength(4)
    })

    it('combines $path with field filter', async () => {
      const results = await col.find({ $path: 'blog/*', published: true })
      expect(results).toHaveLength(1)
      expect(results[0].title).toBe('Post 1')
    })

    it('finds without $path (all docs)', async () => {
      const results = await col.find()
      expect(results).toHaveLength(9)
    })

    it('supports sort and limit', async () => {
      const results = await col.find({ $path: 'blog/*' }, { sort: { title: 1 }, limit: 1 })
      expect(results).toHaveLength(1)
      expect(results[0].title).toBe('Post 1')
    })
  })

  describe('count', () => {
    it('counts with $path filter', async () => {
      const col = new PathCollection(adapter, 'pages')
      await col.insert('blog/a', { title: 'A' })
      await col.insert('blog/b', { title: 'B' })
      await col.insert('other', { title: 'Other' })

      expect(await col.count({ $path: 'blog/*' })).toBe(2)
      expect(await col.count()).toBe(3)
    })
  })

  describe('findOne', () => {
    it('finds first matching document', async () => {
      const col = new PathCollection(adapter, 'pages')
      await col.insert('a', { title: 'A', type: 'page' })
      await col.insert('b', { title: 'B', type: 'page' })

      const result = await col.findOne({ type: 'page' })
      expect(result).not.toBeNull()
      expect(result!.type).toBe('page')
    })
  })

  describe('update', () => {
    it('partially updates a document', async () => {
      const col = new PathCollection(adapter, 'pages')
      await col.insert('about', { title: 'About', content: 'Old' })

      const updated = await col.update('about', { content: 'New' })
      expect(updated.title).toBe('About')
      expect(updated.content).toBe('New')

      const doc = await col.get('about')
      expect(doc!.content).toBe('New')
    })

    it('deep merges nested objects', async () => {
      const col = new PathCollection(adapter, 'pages')
      await col.insert('settings', { meta: { a: 1, b: 2 } })

      await col.update('settings', { meta: { b: 3 } })
      const doc = await col.get('settings')
      expect(doc!.meta).toEqual({ a: 1, b: 3 })
    })

    it('throws for missing path', async () => {
      const col = new PathCollection(adapter, 'pages')
      await expect(col.update('missing', { title: 'X' })).rejects.toThrow('Document not found')
    })
  })

  describe('delete', () => {
    it('deletes a document', async () => {
      const col = new PathCollection(adapter, 'pages')
      await col.insert('about', { title: 'About' })

      await col.delete('about')
      expect(await col.get('about')).toBeNull()
      expect(await adapter.exists('pages/about.json')).toBe(false)
    })

    it('deletes recursively', async () => {
      const col = new PathCollection(adapter, 'pages')
      await col.insert('docs', { title: 'Docs' })
      await col.insert('docs/a', { title: 'A' })
      await col.insert('docs/b', { title: 'B' })

      await col.delete('docs', { recursive: true })
      expect(await col.get('docs')).toBeNull()
      expect(await col.get('docs/a')).toBeNull()
      expect(await col.get('docs/b')).toBeNull()
    })
  })

  describe('move', () => {
    it('moves a leaf document', async () => {
      const col = new PathCollection(adapter, 'pages')
      await col.insert('draft', { title: 'Draft' })

      await col.move('draft', 'published')
      expect(await col.get('draft')).toBeNull()
      expect((await col.get('published'))!.title).toBe('Draft')
    })

    it('throws for missing source', async () => {
      const col = new PathCollection(adapter, 'pages')
      await expect(col.move('missing', 'dest')).rejects.toThrow('Document not found')
    })
  })

  describe('promote / demote', () => {
    it('promotes a leaf to a node', async () => {
      const col = new PathCollection(adapter, 'pages')
      await col.insert('tech', { title: 'Tech' })

      // Before: pages/tech.json
      expect(await adapter.exists('pages/tech.json')).toBe(true)

      await col.promote('tech')

      // After: pages/tech/index.json
      expect(await adapter.exists('pages/tech/index.json')).toBe(true)
      expect(await adapter.exists('pages/tech.json')).toBe(false)

      // Doc still accessible
      const doc = await col.get('tech')
      expect(doc!.title).toBe('Tech')
    })

    it('demotes a node to a leaf', async () => {
      const col = new PathCollection(adapter, 'pages')
      await col.insert('tech', { title: 'Tech' })
      await col.promote('tech')

      await col.demote('tech')

      expect(await adapter.exists('pages/tech.json')).toBe(true)
      expect(await adapter.exists('pages/tech/index.json')).toBe(false)
    })

    it('demote fails if node has children', async () => {
      const col = new PathCollection(adapter, 'pages')
      await col.insert('tech', { title: 'Tech' })
      await col.promote('tech')
      // Add a child
      await col.insert('tech/react', { title: 'React' })

      await expect(col.demote('tech')).rejects.toThrow('has children')
    })

    it('promote fails if already a node', async () => {
      const col = new PathCollection(adapter, 'pages')
      await col.insert('tech', { title: 'Tech' })
      await col.promote('tech')

      await expect(col.promote('tech')).rejects.toThrow('Already a node')
    })
  })

  describe('tree', () => {
    it('builds a tree from a root path', async () => {
      const col = new PathCollection(adapter, 'pages')
      await col.insert('docs', { title: 'Docs' })
      await col.insert('docs/getting-started', { title: 'Getting Started' })
      await col.insert('docs/api', { title: 'API' })
      await col.insert('docs/api/auth', { title: 'Auth' })

      const tree = await col.tree('docs')

      expect(tree.path).toBe('docs')
      expect(tree.doc!.title).toBe('Docs')
      expect(tree.children).toHaveLength(2)

      const api = tree.children.find(c => c.path === 'docs/api')!
      expect(api.doc!.title).toBe('API')
      expect(api.children).toHaveLength(1)
      expect(api.children[0].path).toBe('docs/api/auth')
      expect(api.children[0].doc!.title).toBe('Auth')
    })

    it('tree from root (no arg)', async () => {
      const col = new PathCollection(adapter, 'pages')
      await col.insert('a', { title: 'A' })
      await col.insert('b', { title: 'B' })

      const tree = await col.tree()
      expect(tree.path).toBe('')
      expect(tree.children).toHaveLength(2)
    })

    it('tree with empty subtree', async () => {
      const col = new PathCollection(adapter, 'pages')
      await col.insert('solo', { title: 'Solo' })

      const tree = await col.tree('solo')
      expect(tree.path).toBe('solo')
      expect(tree.doc!.title).toBe('Solo')
      expect(tree.children).toHaveLength(0)
    })
  })

  describe('rebuildIndex', () => {
    it('rebuilds index from disk files', async () => {
      const col = new PathCollection(adapter, 'pages')
      await col.insert('a', { title: 'A' })
      await col.insert('b', { title: 'B' })

      // Corrupt index
      await adapter.write('pages/_index.json', '{}')

      await col.rebuildIndex()
      expect(await col.count()).toBe(2)
    })
  })

  describe('with Zod schema', () => {
    it('validates on write', async () => {
      const schema = z.object({ title: z.string(), content: z.string() })
      const col = new PathCollection(adapter, 'pages', schema)

      await expect(col.insert('bad', { title: 123 } as any)).rejects.toThrow()
    })

    it('applies defaults on read', async () => {
      const schema = z.object({
        title: z.string(),
        draft: z.boolean().default(false),
      })
      const col = new PathCollection(adapter, 'pages', schema)

      // Write raw without draft field
      await adapter.write('pages/test.json', JSON.stringify({ title: 'Test' }))
      await adapter.write('pages/_index.json', JSON.stringify({ test: { title: 'Test' } }))

      const doc = await col.get('test')
      expect(doc!.draft).toBe(false)
    })
  })
})
