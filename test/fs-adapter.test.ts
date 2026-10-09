import { describe, it, expect, beforeEach, afterEach } from 'vite-plus/test'
import { FsAdapter } from '../src/fs-adapter.js'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'

describe('FsAdapter', () => {
  let adapter: FsAdapter
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flatdb-test-'))
    adapter = new FsAdapter(tmpDir)
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('write and read a file', async () => {
    await adapter.write('test.json', '{"hello":"world"}')
    const data = await adapter.read('test.json')
    expect(data).toBe('{"hello":"world"}')
  })

  it('read returns null for missing file', async () => {
    const data = await adapter.read('missing.json')
    expect(data).toBeNull()
  })

  it('write creates nested directories', async () => {
    await adapter.write('a/b/c.json', '{}')
    const data = await adapter.read('a/b/c.json')
    expect(data).toBe('{}')
  })

  it('delete removes a file', async () => {
    await adapter.write('test.json', '{}')
    await adapter.delete('test.json')
    const data = await adapter.read('test.json')
    expect(data).toBeNull()
  })

  it('delete is silent for missing file', async () => {
    await expect(adapter.delete('missing.json')).resolves.toBeUndefined()
  })

  it('exists returns true/false', async () => {
    expect(await adapter.exists('test.json')).toBe(false)
    await adapter.write('test.json', '{}')
    expect(await adapter.exists('test.json')).toBe(true)
  })

  it('list returns entries in a directory', async () => {
    await adapter.write('dir/a.json', '{}')
    await adapter.write('dir/b.json', '{}')
    const entries = await adapter.list('dir')
    expect(entries.sort()).toEqual(['a.json', 'b.json'])
  })

  it('list returns empty array for missing directory', async () => {
    const entries = await adapter.list('missing')
    expect(entries).toEqual([])
  })

  it('mkdir creates directories recursively', async () => {
    await adapter.mkdir('x/y/z')
    expect(await adapter.exists('x/y/z')).toBe(true)
  })

  it('move renames a file', async () => {
    await adapter.write('old.json', '{"v":1}')
    await adapter.move('old.json', 'new.json')
    expect(await adapter.read('old.json')).toBeNull()
    expect(await adapter.read('new.json')).toBe('{"v":1}')
  })

  it('move creates target directories', async () => {
    await adapter.write('a.json', '{}')
    await adapter.move('a.json', 'sub/dir/b.json')
    expect(await adapter.read('sub/dir/b.json')).toBe('{}')
  })

  describe('atomic writes', () => {
    it('concurrent writes to one path never leave a torn file', async () => {
      const long = JSON.stringify({ text: 'x'.repeat(200_000) })
      const short = JSON.stringify({ text: 'y' })

      for (let round = 0; round < 20; round++) {
        await Promise.all([
          adapter.write('doc.json', long),
          new FsAdapter(tmpDir).write('doc.json', short),
          adapter.write('doc.json', long),
        ])
        expect([long, short]).toContain(await adapter.read('doc.json'))
      }
    })

    it('a reader sees the old or the new content while a write is in flight', async () => {
      const old = JSON.stringify({ text: 'a'.repeat(200_000) })
      const next = JSON.stringify({ text: 'b'.repeat(400_000) })
      await adapter.write('doc.json', old)

      const writing = adapter.write('doc.json', next)
      const seen = await Promise.all(Array.from({ length: 50 }, () => adapter.read('doc.json')))
      await writing

      for (const content of seen) expect([old, next]).toContain(content)
      expect(await adapter.read('doc.json')).toBe(next)
    })

    it('leaves no temp files behind and hides stray ones from list', async () => {
      await adapter.write('dir/a.json', '{}')
      await adapter.write('dir/a.json', '{"v":2}')
      expect(await fs.readdir(path.join(tmpDir, 'dir'))).toEqual(['a.json'])

      await fs.writeFile(path.join(tmpDir, 'dir', '.a.json.crashed1.tmp'), '{"v":')
      expect(await adapter.list('dir')).toEqual(['a.json'])
    })
  })

  describe('conditional writes', () => {
    it('readVersioned returns null for a missing file and a token for an existing one', async () => {
      expect(await adapter.readVersioned('x.json')).toEqual({ data: null, version: null })

      await adapter.write('x.json', '{"v":1}')
      const { data, version } = await adapter.readVersioned('x.json')
      expect(data).toBe('{"v":1}')
      expect(version).toMatch(/^[0-9a-f]{40}$/)
    })

    it('writeIf with null creates only when the file is absent', async () => {
      const created = await adapter.writeIf('x.json', '{"v":1}', null)
      expect(created).not.toBeNull()
      expect(await adapter.writeIf('x.json', '{"v":2}', null)).toBeNull()
      expect(await adapter.read('x.json')).toBe('{"v":1}')
    })

    it('writeIf writes on a matching version and refuses a stale one', async () => {
      const v1 = await adapter.writeIf('x.json', '{"v":1}', null)
      const v2 = await adapter.writeIf('x.json', '{"v":2}', v1)
      expect(v2).not.toBeNull()
      expect(v2).toBe((await adapter.readVersioned('x.json')).version)

      expect(await adapter.writeIf('x.json', '{"v":3}', v1)).toBeNull()
      expect(await adapter.read('x.json')).toBe('{"v":2}')
    })

    it('lets exactly one of several adapters win the same version', async () => {
      const v1 = await adapter.writeIf('x.json', '{"v":1}', null)
      const results = await Promise.all(
        [0, 1, 2, 3, 4, 5].map((n) => new FsAdapter(tmpDir).writeIf('x.json', `{"n":${n}}`, v1)),
      )

      const winners = results.filter((version) => version !== null)
      expect(winners).toHaveLength(1)
      expect((await adapter.readVersioned('x.json')).version).toBe(winners[0])
    })

    it('a plain write in between invalidates the version', async () => {
      const v1 = await adapter.writeIf('x.json', '{"v":1}', null)
      await adapter.write('x.json', '{"v":"other"}')
      expect(await adapter.writeIf('x.json', '{"v":2}', v1)).toBeNull()
    })
  })
})
