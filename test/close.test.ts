import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { flatdb, collection } from '../src/flatdb.js'
import { MemoryAdapter } from '../src/memory-adapter.js'
import { IndexedDBAdapter } from '../src/indexeddb-adapter.js'

const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

describe('db.close()', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flatdb-close-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('stops the file watchers', async () => {
    const db = flatdb(tmpDir, { notes: collection() }, { watch: true })
    await db.notes.insert({ text: 'via API' })
    await wait(150) // watchers start after the async mkdir

    await db.close()

    const results: any[][] = []
    const unsub = (db.notes as any).live((docs: any[]) => results.push(docs))
    await wait(100)
    expect(results).toHaveLength(1)

    await fs.writeFile(path.join(tmpDir, 'notes', 'external.json'), JSON.stringify({ text: 'external' }))
    await wait(300)
    expect(results).toHaveLength(1)
    unsub()
  })

  it('waits for watchers that are still starting', async () => {
    const db = flatdb(tmpDir, { notes: collection() }, { watch: true })
    await db.close() // before mkdir resolved

    await db.notes.insert({ text: 'via API' })
    const results: any[][] = []
    const unsub = (db.notes as any).live((docs: any[]) => results.push(docs))
    await wait(100)

    await fs.writeFile(path.join(tmpDir, 'notes', 'external.json'), JSON.stringify({ text: 'external' }))
    await wait(300)
    expect(results).toHaveLength(1)
    unsub()
  })

  it('is safe to call twice and without watchers', async () => {
    const db = flatdb(new MemoryAdapter(), { users: collection() })
    await db.close()
    await db.close()
    expect(await db.users.count()).toBe(0)
  })

  it('closes the adapter when it can be closed', async () => {
    class ClosableAdapter extends MemoryAdapter {
      close = vi.fn(async () => {})
    }
    const adapter = new ClosableAdapter()
    const db = flatdb(adapter, { users: collection() })
    await db.close()
    expect(adapter.close).toHaveBeenCalledTimes(1)
  })

  it('releases the IndexedDB connection; the collections reopen it on demand', async () => {
    const adapter = new IndexedDBAdapter(`close-${Date.now()}`)
    const db = flatdb(adapter, { users: collection() })
    await db.users.insert({ name: 'Max' })
    expect((adapter as any).dbPromise).not.toBeNull()

    await db.close()
    expect((adapter as any).dbPromise).toBeNull()

    expect(await db.users.count()).toBe(1)
    await db.close()
  })

  it('refuses a collection named close', () => {
    expect(() => flatdb(new MemoryAdapter(), { close: collection() })).toThrow(/reserved/)
  })
})
