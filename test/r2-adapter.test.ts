import { describe, it, expect, beforeEach } from 'vitest'
import { R2Adapter } from '../src/r2-adapter.js'
import { FakeR2Bucket } from './fake-r2-bucket.js'

describe('R2Adapter', () => {
  let bucket: FakeR2Bucket
  let adapter: R2Adapter

  beforeEach(() => {
    bucket = new FakeR2Bucket()
    adapter = new R2Adapter({ bucket })
  })

  it('write and read a file', async () => {
    await adapter.write('test.json', '{"hello":"world"}')
    expect(await adapter.read('test.json')).toBe('{"hello":"world"}')
  })

  it('read returns null for missing file', async () => {
    expect(await adapter.read('missing.json')).toBeNull()
  })

  it('write stores nested paths as keys', async () => {
    await adapter.write('a/b/c.json', '{}')
    expect(bucket.objects.has('a/b/c.json')).toBe(true)
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

  it('exists uses head instead of downloading the object', async () => {
    await adapter.write('test.json', '{}')
    bucket.calls.length = 0
    await adapter.exists('test.json')
    expect(bucket.calls).toEqual(['head test.json'])
  })

  it('exists returns true for directory prefix', async () => {
    await adapter.write('dir/file.json', '{}')
    expect(await adapter.exists('dir')).toBe(true)
    expect(await adapter.exists('nonexistent')).toBe(false)
  })

  it('list returns entries in a directory', async () => {
    await adapter.write('dir/a.json', '{}')
    await adapter.write('dir/b.json', '{}')
    expect((await adapter.list('dir')).sort()).toEqual(['a.json', 'b.json'])
  })

  it('list returns only direct children', async () => {
    await adapter.write('dir/a.json', '{}')
    await adapter.write('dir/sub/b.json', '{}')
    await adapter.write('dir/sub/deep/c.json', '{}')
    expect((await adapter.list('dir')).sort()).toEqual(['a.json', 'sub'])
  })

  it('list does not leak sibling prefixes', async () => {
    await adapter.write('users/a.json', '{}')
    await adapter.write('users-archive/b.json', '{}')
    expect(await adapter.list('users')).toEqual(['a.json'])
  })

  it('list returns empty array for missing directory', async () => {
    expect(await adapter.list('missing')).toEqual([])
  })

  it('list follows pagination until the last page', async () => {
    bucket = new FakeR2Bucket(2)
    adapter = new R2Adapter({ bucket })
    for (const name of ['a', 'b', 'c', 'd', 'e']) {
      await adapter.write(`dir/${name}.json`, '{}')
    }
    await adapter.write('dir/sub/x.json', '{}')
    bucket.calls.length = 0

    const entries = await adapter.list('dir')

    expect(entries.sort()).toEqual(['a.json', 'b.json', 'c.json', 'd.json', 'e.json', 'sub'])
    expect(bucket.calls.filter(c => c.startsWith('list ')).length).toBe(3)
  })

  it('mkdir is a no-op', async () => {
    await expect(adapter.mkdir('x/y/z')).resolves.toBeUndefined()
    expect(bucket.objects.size).toBe(0)
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
    expect(await adapter.read('dir/sub/b.json')).toBeNull()
    expect(await adapter.read('newdir/a.json')).toBe('{"a":1}')
    expect(await adapter.read('newdir/sub/b.json')).toBe('{"b":2}')
  })

  it('move copies everything before deleting anything', async () => {
    await adapter.write('dir/a.json', '{}')
    await adapter.write('dir/b.json', '{}')
    bucket.calls.length = 0
    await adapter.move('dir', 'newdir')

    const writes = bucket.calls.filter(c => c.startsWith('put ') || c.startsWith('delete '))
    expect(writes).toEqual(['put newdir/a.json', 'put newdir/b.json', 'delete dir/a.json', 'delete dir/b.json'])
  })

  it('move is silent for a missing source', async () => {
    await expect(adapter.move('missing.json', 'new.json')).resolves.toBeUndefined()
    expect(bucket.objects.size).toBe(0)
  })

  it('does not offer watch', () => {
    expect(adapter.watch).toBeUndefined()
  })

  describe('versioned writes', () => {
    it('readVersioned reports null for a missing path and a token afterwards', async () => {
      expect(await adapter.readVersioned('x.json')).toEqual({ data: null, version: null })
      await adapter.write('x.json', '1')
      const { data, version } = await adapter.readVersioned('x.json')
      expect(data).toBe('1')
      expect(version).not.toBeNull()
    })

    it('writeIf creates only when the path is absent', async () => {
      expect(await adapter.writeIf('x.json', '1', null)).not.toBeNull()
      expect(await adapter.writeIf('x.json', '2', null)).toBeNull()
      expect(await adapter.read('x.json')).toBe('1')
    })

    it('writeIf succeeds with the current version and fails after any other write', async () => {
      const v1 = await adapter.writeIf('x.json', '1', null)
      const v2 = await adapter.writeIf('x.json', '2', v1)
      expect(v2).not.toBeNull()
      expect(v2).not.toBe(v1)
      expect(await adapter.writeIf('x.json', '3', v1)).toBeNull()
      await adapter.write('x.json', '4')
      expect(await adapter.writeIf('x.json', '5', v2)).toBeNull()
      expect(await adapter.read('x.json')).toBe('4')
    })
  })

  describe('prefix', () => {
    beforeEach(() => {
      adapter = new R2Adapter({ bucket, prefix: '/data/' })
    })

    it('stores keys under the prefix with slashes normalised', async () => {
      await adapter.write('users/a.json', '{}')
      expect([...bucket.objects.keys()]).toEqual(['data/users/a.json'])
      expect(await adapter.read('users/a.json')).toBe('{}')
    })

    it('list and exists stay inside the prefix', async () => {
      await adapter.write('users/a.json', '{}')
      await bucket.put('users/outside.json', '{}')
      await bucket.put('data-other/users/x.json', '{}')

      expect(await adapter.list('users')).toEqual(['a.json'])
      expect(await adapter.exists('users')).toBe(true)
      expect(await adapter.exists('data-other')).toBe(false)
    })

    it('move keeps the prefix', async () => {
      await adapter.write('dir/a.json', '{}')
      await adapter.move('dir', 'newdir')
      expect([...bucket.objects.keys()]).toEqual(['data/newdir/a.json'])
    })
  })
})
