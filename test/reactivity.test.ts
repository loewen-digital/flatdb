import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { z } from 'zod'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { FsAdapter } from '../src/fs-adapter.js'
import { Collection } from '../src/collection.js'
import { PathCollection } from '../src/path-collection.js'

describe('Reactivity — Collection (auto mode)', () => {
  let adapter: FsAdapter
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flatdb-react-'))
    adapter = new FsAdapter(tmpDir)
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  describe('live()', () => {
    it('emits initial results', async () => {
      const col = new Collection(adapter, 'todos')
      await col.insert({ text: 'A', done: false })

      const results: any[][] = []
      col.live({ done: false }, (docs) => {
        results.push(docs)
      })

      // Wait for async initial emit
      await new Promise(r => setTimeout(r, 50))
      expect(results.length).toBeGreaterThanOrEqual(1)
      expect(results[0]).toHaveLength(1)
    })

    it('re-emits on insert', async () => {
      const col = new Collection(adapter, 'todos')

      const results: any[][] = []
      col.live((docs) => {
        results.push(docs)
      })

      await new Promise(r => setTimeout(r, 50))
      expect(results[0]).toHaveLength(0) // initially empty

      await col.insert({ text: 'A' })
      await new Promise(r => setTimeout(r, 50))

      expect(results.length).toBeGreaterThanOrEqual(2)
      expect(results[results.length - 1]).toHaveLength(1)
    })

    it('re-emits on update', async () => {
      const col = new Collection(adapter, 'todos')
      const todo = await col.insert({ text: 'A', done: false })

      const results: any[][] = []
      col.live({ done: true }, (docs) => {
        results.push(docs)
      })

      await new Promise(r => setTimeout(r, 50))
      expect(results[0]).toHaveLength(0)

      await col.update({ _id: todo._id }, { done: true })
      await new Promise(r => setTimeout(r, 50))

      expect(results[results.length - 1]).toHaveLength(1)
    })

    it('re-emits on delete', async () => {
      const col = new Collection(adapter, 'todos')
      const todo = await col.insert({ text: 'A' })

      const results: any[][] = []
      col.live((docs) => {
        results.push(docs)
      })

      await new Promise(r => setTimeout(r, 50))
      expect(results[0]).toHaveLength(1)

      await col.delete({ _id: todo._id })
      await new Promise(r => setTimeout(r, 50))

      expect(results[results.length - 1]).toHaveLength(0)
    })

    it('unsub stops notifications', async () => {
      const col = new Collection(adapter, 'todos')

      const results: any[][] = []
      const unsub = col.live((docs) => {
        results.push(docs)
      })

      await new Promise(r => setTimeout(r, 50))
      unsub()

      await col.insert({ text: 'A' })
      await new Promise(r => setTimeout(r, 50))

      // Should only have the initial emit
      expect(results).toHaveLength(1)
    })
  })

  describe('liveById()', () => {
    it('emits initial document', async () => {
      const col = new Collection(adapter, 'users')
      const user = await col.insert({ name: 'Max' })

      const results: any[] = []
      col.liveById(user._id, (doc) => {
        results.push(doc)
      })

      await new Promise(r => setTimeout(r, 50))
      expect(results[0]).not.toBeNull()
      expect(results[0].name).toBe('Max')
    })

    it('re-emits on update', async () => {
      const col = new Collection(adapter, 'users')
      const user = await col.insert({ name: 'Max' })

      const results: any[] = []
      col.liveById(user._id, (doc) => {
        results.push(doc)
      })

      await new Promise(r => setTimeout(r, 50))
      await col.update({ _id: user._id }, { name: 'Maximilian' })
      await new Promise(r => setTimeout(r, 50))

      expect(results[results.length - 1].name).toBe('Maximilian')
    })

    it('emits null on delete', async () => {
      const col = new Collection(adapter, 'users')
      const user = await col.insert({ name: 'Max' })

      const results: any[] = []
      col.liveById(user._id, (doc) => {
        results.push(doc)
      })

      await new Promise(r => setTimeout(r, 50))
      await col.delete({ _id: user._id })
      await new Promise(r => setTimeout(r, 50))

      expect(results[results.length - 1]).toBeNull()
    })
  })

  describe('watch()', () => {
    it('yields initial results and updates', async () => {
      const col = new Collection(adapter, 'todos')
      await col.insert({ text: 'A' })

      const iter = col.watch()[Symbol.asyncIterator]()

      // Initial
      const first = await iter.next()
      expect(first.done).toBe(false)
      expect(first.value).toHaveLength(1)

      // Trigger update
      const insertPromise = col.insert({ text: 'B' })
      const second = await iter.next()
      await insertPromise
      expect(second.value).toHaveLength(2)

      // Cleanup
      await iter.return!()
    })

    it('return() ends the iterator', async () => {
      const col = new Collection(adapter, 'todos')

      const iter = col.watch()[Symbol.asyncIterator]()
      await iter.next() // initial

      await iter.return!()
      const result = await iter.next()
      expect(result.done).toBe(true)
    })
  })
})

describe('Reactivity — PathCollection', () => {
  let adapter: FsAdapter
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flatdb-react-path-'))
    adapter = new FsAdapter(tmpDir)
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  describe('live()', () => {
    it('emits on insert', async () => {
      const col = new PathCollection(adapter, 'pages')

      const results: any[][] = []
      col.live((docs) => {
        results.push(docs)
      })

      await new Promise(r => setTimeout(r, 50))
      expect(results[0]).toHaveLength(0)

      await col.insert('about', { title: 'About' })
      await new Promise(r => setTimeout(r, 50))

      expect(results[results.length - 1]).toHaveLength(1)
    })

    it('live with $path filter', async () => {
      const col = new PathCollection(adapter, 'pages')
      await col.insert('blog/a', { title: 'A' })

      const results: any[][] = []
      col.live({ $path: 'blog/*' }, (docs) => {
        results.push(docs)
      })

      await new Promise(r => setTimeout(r, 50))
      expect(results[0]).toHaveLength(1)

      await col.insert('other', { title: 'Other' }) // not under blog/
      await new Promise(r => setTimeout(r, 50))

      // Still 1 under blog/*
      expect(results[results.length - 1]).toHaveLength(1)

      await col.insert('blog/b', { title: 'B' })
      await new Promise(r => setTimeout(r, 50))

      expect(results[results.length - 1]).toHaveLength(2)
    })
  })

  describe('liveByPath()', () => {
    it('emits initial doc and updates', async () => {
      const col = new PathCollection(adapter, 'pages')
      await col.insert('about', { title: 'About' })

      const results: any[] = []
      col.liveByPath('about', (doc) => {
        results.push(doc)
      })

      await new Promise(r => setTimeout(r, 50))
      expect(results[0]!.title).toBe('About')

      await col.update('about', { title: 'About Us' })
      await new Promise(r => setTimeout(r, 50))

      expect(results[results.length - 1]!.title).toBe('About Us')
    })

    it('emits null on delete', async () => {
      const col = new PathCollection(adapter, 'pages')
      await col.insert('about', { title: 'About' })

      const results: any[] = []
      col.liveByPath('about', (doc) => {
        results.push(doc)
      })

      await new Promise(r => setTimeout(r, 50))
      await col.delete('about')
      await new Promise(r => setTimeout(r, 50))

      expect(results[results.length - 1]).toBeNull()
    })
  })

  describe('watch()', () => {
    it('yields updates on changes', async () => {
      const col = new PathCollection(adapter, 'pages')

      const iter = col.watch()[Symbol.asyncIterator]()

      const first = await iter.next()
      expect(first.value).toHaveLength(0)

      const insertPromise = col.insert('a', { title: 'A' })
      const second = await iter.next()
      await insertPromise
      expect(second.value).toHaveLength(1)

      await iter.return!()
    })
  })
})
