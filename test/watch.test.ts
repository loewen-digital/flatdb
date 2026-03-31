import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { flatdb, collection } from '../src/flatdb.js'

describe('fs.watch integration', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flatdb-watch-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('detects external file creation and re-emits live query', async () => {
    const db = flatdb(tmpDir, {
      notes: collection(),
    }, { watch: true })

    // Insert one doc through the API — also creates the directory
    await db.notes.insert({ text: 'via API' })

    // Give fs.watch time to start (mkdir is async in flatdb)
    await new Promise(r => setTimeout(r, 150))

    const results: any[][] = []
    const unsub = (db.notes as any).live((docs: any[]) => {
      results.push(docs)
    })

    await new Promise(r => setTimeout(r, 100))
    expect(results[0]).toHaveLength(1)

    // Write a file externally
    await fs.writeFile(
      path.join(tmpDir, 'notes', 'external.json'),
      JSON.stringify({ text: 'external' }),
    )

    // Wait for fs.watch to fire
    await new Promise(r => setTimeout(r, 300))

    // The emitter should have fired (cache invalidated)
    expect(results.length).toBeGreaterThan(1)

    unsub()
  })

  it('detects external file modification', async () => {
    const db = flatdb(tmpDir, {
      notes: collection(),
    }, { watch: true })

    const note = await db.notes.insert({ text: 'original' })

    // Give fs.watch time to start
    await new Promise(r => setTimeout(r, 150))

    let emitCount = 0
    const unsub = (db.notes as any).live(() => {
      emitCount++
    })

    await new Promise(r => setTimeout(r, 100))
    const initialCount = emitCount

    // Modify the file externally
    await fs.writeFile(
      path.join(tmpDir, 'notes', `${note._id}.json`),
      JSON.stringify({ text: 'modified' }),
    )

    await new Promise(r => setTimeout(r, 300))
    expect(emitCount).toBeGreaterThan(initialCount)

    unsub()
  })
})
