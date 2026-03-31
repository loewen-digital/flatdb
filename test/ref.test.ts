import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { flatdb, collection, ref } from '../src/index.js'
import { serializeRef, deserializeRef, isRef, serializeRefs, deserializeRefs } from '../src/ref.js'

describe('ref helpers', () => {
  it('serializeRef creates ref string', () => {
    expect(serializeRef('users', 'abc123')).toBe('ref:users/abc123')
  })

  it('deserializeRef parses ref string', () => {
    const result = deserializeRef('ref:users/abc123')
    expect(result).toEqual({ collection: 'users', id: 'abc123' })
  })

  it('deserializeRef returns null for non-ref', () => {
    expect(deserializeRef('just a string')).toBeNull()
  })

  it('deserializeRef handles path-mode ids', () => {
    const result = deserializeRef('ref:categories/dev/frontend')
    expect(result).toEqual({ collection: 'categories', id: 'dev/frontend' })
  })

  it('isRef detects ref strings', () => {
    expect(isRef('ref:users/abc')).toBe(true)
    expect(isRef('not a ref')).toBe(false)
    expect(isRef(42)).toBe(false)
  })

  it('serializeRefs serializes ref fields', () => {
    const doc = { text: 'hello', assignee: 'abc123', watchers: ['abc', 'def'] }
    const metas = [
      { field: 'assignee', collection: 'users' },
      { field: 'watchers', collection: 'users' },
    ]
    const result = serializeRefs(doc, metas)
    expect(result.assignee).toBe('ref:users/abc123')
    expect(result.watchers).toEqual(['ref:users/abc', 'ref:users/def'])
    expect(result.text).toBe('hello') // non-ref untouched
  })

  it('deserializeRefs restores plain ids', () => {
    const doc = {
      text: 'hello',
      assignee: 'ref:users/abc123',
      watchers: ['ref:users/abc', 'ref:users/def'],
    }
    const result = deserializeRefs(doc)
    expect(result.assignee).toBe('abc123')
    expect(result.watchers).toEqual(['abc', 'def'])
    expect(result.text).toBe('hello')
  })
})

describe('ref() Zod type', () => {
  it('creates a Zod type that accepts strings', () => {
    const userRef = ref('users')
    const result = userRef.parse('abc123')
    expect(result).toBe('abc123')
  })

  it('rejects non-strings', () => {
    const userRef = ref('users')
    expect(() => userRef.parse(123)).toThrow()
  })
})

describe('refs integration via flatdb()', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flatdb-ref-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('stores refs as ref:collection/id on disk', async () => {
    const db = flatdb(tmpDir, {
      users: collection(z.object({ name: z.string() })),
      todos: collection(z.object({
        text: z.string(),
        assignee: ref('users'),
      })),
    })

    const user = await db.users.insert({ name: 'Max' })
    await db.todos.insert({ text: 'Fix bug', assignee: user._id })

    // Check raw file on disk
    const todosIndex = await fs.readFile(path.join(tmpDir, 'todos', '_index.json'), 'utf-8')
    const index = JSON.parse(todosIndex)
    const todoId = Object.keys(index)[0]
    expect(index[todoId].assignee).toBe(`ref:users/${user._id}`)
  })

  it('reads back plain ids by default', async () => {
    const db = flatdb(tmpDir, {
      users: collection(z.object({ name: z.string() })),
      todos: collection(z.object({
        text: z.string(),
        assignee: ref('users'),
      })),
    })

    const user = await db.users.insert({ name: 'Max' })
    const todo = await db.todos.insert({ text: 'Fix bug', assignee: user._id })

    const found = await db.todos.findById(todo._id)
    expect(found!.assignee).toBe(user._id) // plain id, not ref:users/...
  })

  it('populate resolves refs to full documents', async () => {
    const db = flatdb(tmpDir, {
      users: collection(z.object({ name: z.string() })),
      todos: collection(z.object({
        text: z.string(),
        assignee: ref('users'),
      })),
    })

    const user = await db.users.insert({ name: 'Max' })
    const todo = await db.todos.insert({ text: 'Fix bug', assignee: user._id })

    const populated = await db.todos.findById(todo._id, {
      populate: ['assignee'],
    })

    expect(populated!.assignee).toEqual({ _id: user._id, name: 'Max' })
  })

  it('populate resolves array refs', async () => {
    const db = flatdb(tmpDir, {
      users: collection(z.object({ name: z.string() })),
      todos: collection(z.object({
        text: z.string(),
        watchers: ref('users').array(),
      })),
    })

    const alice = await db.users.insert({ name: 'Alice' })
    const bob = await db.users.insert({ name: 'Bob' })
    const todo = await db.todos.insert({ text: 'Task', watchers: [alice._id, bob._id] })

    const populated = await db.todos.findById(todo._id, {
      populate: ['watchers'],
    })

    expect(populated!.watchers).toHaveLength(2)
    expect(populated!.watchers[0]).toEqual({ _id: alice._id, name: 'Alice' })
    expect(populated!.watchers[1]).toEqual({ _id: bob._id, name: 'Bob' })
  })

  it('find/findOne still works with ref fields', async () => {
    const db = flatdb(tmpDir, {
      users: collection(z.object({ name: z.string() })),
      todos: collection(z.object({
        text: z.string(),
        assignee: ref('users'),
      })),
    })

    const user = await db.users.insert({ name: 'Max' })
    await db.todos.insert({ text: 'A', assignee: user._id })
    await db.todos.insert({ text: 'B', assignee: user._id })

    const all = await db.todos.find({ assignee: user._id })
    expect(all).toHaveLength(2)
  })

  it('update works with ref fields', async () => {
    const db = flatdb(tmpDir, {
      users: collection(z.object({ name: z.string() })),
      todos: collection(z.object({
        text: z.string(),
        assignee: ref('users'),
      })),
    })

    const max = await db.users.insert({ name: 'Max' })
    const alice = await db.users.insert({ name: 'Alice' })
    const todo = await db.todos.insert({ text: 'Task', assignee: max._id })

    await db.todos.update({ _id: todo._id }, { assignee: alice._id })

    const updated = await db.todos.findById(todo._id)
    expect(updated!.assignee).toBe(alice._id)
  })
})
