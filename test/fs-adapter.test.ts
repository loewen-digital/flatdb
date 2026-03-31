import { describe, it, expect, beforeEach, afterEach } from 'vitest'
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
})
