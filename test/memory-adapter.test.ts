import { describe, it, expect, beforeEach } from 'vitest'
import { MemoryAdapter } from '../src/memory-adapter.js'

describe('MemoryAdapter', () => {
  let adapter: MemoryAdapter

  beforeEach(() => {
    adapter = new MemoryAdapter()
  })

  it('write and read a file', async () => {
    await adapter.write('test.json', '{"hello":"world"}')
    const data = await adapter.read('test.json')
    expect(data).toBe('{"hello":"world"}')
  })

  it('read returns null for missing file', async () => {
    expect(await adapter.read('missing.json')).toBeNull()
  })

  it('write creates nested paths', async () => {
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

  it('exists returns true/false', async () => {
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

  it('list returns empty array for missing directory', async () => {
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

  it('clear wipes all data', async () => {
    await adapter.write('a.json', '{}')
    await adapter.write('b.json', '{}')
    adapter.clear()
    expect(await adapter.read('a.json')).toBeNull()
    expect(await adapter.read('b.json')).toBeNull()
  })
})
