import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { MemoryAdapter } from '../src/memory-adapter.js'
import { Collection } from '../src/collection.js'
import { PathCollection } from '../src/path-collection.js'

const Todo = z.object({ text: z.string(), status: z.enum(['todo', 'doing', 'done']) })
const migrate = ({ done, ...doc }: any) => ({ ...doc, status: doc.status ?? (done ? 'done' : 'todo') })

async function seedOldTodo(adapter: MemoryAdapter) {
  await adapter.write('todos/old.json', JSON.stringify({ text: 'Old', done: true }))
  await adapter.write('todos/_index.json', JSON.stringify({ old: { text: 'Old', done: true } }))
}

describe('migrate option: Collection (auto mode)', () => {
  it('transforms old documents on read, before validation', async () => {
    const adapter = new MemoryAdapter()
    await seedOldTodo(adapter)

    await expect(new Collection(adapter, 'todos', Todo).findById('old')).rejects.toThrow()

    const col = new Collection(adapter, 'todos', Todo, { migrate })
    expect(await col.findById('old')).toEqual({ _id: 'old', text: 'Old', status: 'done' })
  })

  it('queries match the migrated shape', async () => {
    const adapter = new MemoryAdapter()
    await seedOldTodo(adapter)
    const col = new Collection(adapter, 'todos', Todo, { migrate })

    expect(await col.find({ status: 'done' })).toHaveLength(1)
    expect(await col.count({ status: 'done' })).toBe(1)
    expect((await col.findOne({ status: 'done' }))!.text).toBe('Old')
    expect(await col.count({ done: true })).toBe(0)
  })

  it('does not rewrite files on read; the next write stores the new shape', async () => {
    const adapter = new MemoryAdapter()
    await seedOldTodo(adapter)
    const col = new Collection(adapter, 'todos', Todo, { migrate })

    await col.findById('old')
    expect(JSON.parse((await adapter.read('todos/old.json'))!)).toEqual({ text: 'Old', done: true })

    await col.update({ _id: 'old' }, { text: 'Renamed' })
    expect(JSON.parse((await adapter.read('todos/old.json'))!)).toEqual({ text: 'Renamed', status: 'done' })
    expect(JSON.parse((await adapter.read('todos/_index.json'))!).old).toEqual({ text: 'Renamed', status: 'done' })
  })

  it('is applied on read only, never on write', async () => {
    const adapter = new MemoryAdapter()
    const col = new Collection(adapter, 'notes', undefined, {
      migrate: doc => ({ ...doc, text: String(doc.text).toUpperCase() }),
    })

    const note = await col.insert({ text: 'quiet' })
    expect(note.text).toBe('quiet')
    expect(JSON.parse((await adapter.read(`notes/${note._id}.json`))!).text).toBe('quiet')
    expect((await col.findById(note._id))!.text).toBe('QUIET')
  })

  it('runs without a schema and with validateOnRead: false', async () => {
    const adapter = new MemoryAdapter()
    await seedOldTodo(adapter)

    const schemaless = new Collection(adapter, 'todos', undefined, { migrate })
    expect((await schemaless.findById('old'))!.status).toBe('done')

    const unchecked = new Collection(adapter, 'todos', Todo, { migrate, validateOnRead: false })
    expect((await unchecked.findById('old'))!.status).toBe('done')
  })
})

describe('migrate option: PathCollection', () => {
  const Page = z.object({ title: z.string(), kind: z.enum(['page', 'legacy']) })
  const migratePage = ({ legacy, ...doc }: any) => ({ ...doc, kind: doc.kind ?? (legacy ? 'legacy' : 'page') })

  async function seedOldPages(adapter: MemoryAdapter) {
    await adapter.write('pages/about.json', JSON.stringify({ title: 'About', legacy: true }))
    await adapter.write('pages/about/team.json', JSON.stringify({ title: 'Team', legacy: true }))
    await adapter.write('pages/_index.json', JSON.stringify({
      about: { title: 'About', legacy: true },
      'about/team': { title: 'Team', legacy: true },
    }))
  }

  it('get, find, count and tree see migrated documents', async () => {
    const adapter = new MemoryAdapter()
    await seedOldPages(adapter)

    await expect(new PathCollection(adapter, 'pages', Page).get('about')).rejects.toThrow()

    const col = new PathCollection(adapter, 'pages', Page, { migrate: migratePage })
    expect(await col.get('about')).toEqual({ title: 'About', kind: 'legacy' })
    expect(await col.find({ kind: 'legacy' })).toHaveLength(2)
    expect(await col.find({ $path: 'about/*', kind: 'legacy' })).toHaveLength(1)
    expect(await col.count({ legacy: true })).toBe(0)

    const tree = await col.tree('about')
    expect(tree.doc).toEqual({ title: 'About', kind: 'legacy' })
    expect(tree.children[0].doc).toEqual({ title: 'Team', kind: 'legacy' })
  })

  it('update merges into the migrated shape and writes it', async () => {
    const adapter = new MemoryAdapter()
    await seedOldPages(adapter)
    const col = new PathCollection(adapter, 'pages', Page, { migrate: migratePage })

    await col.update('about', { title: 'About us' })
    expect(JSON.parse((await adapter.read('pages/about.json'))!)).toEqual({ title: 'About us', kind: 'legacy' })
    expect(JSON.parse((await adapter.read('pages/about/team.json'))!)).toEqual({ title: 'Team', legacy: true })
  })
})
