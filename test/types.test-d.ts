import { describe, expectTypeOf, it } from 'vite-plus/test'
import { z } from 'zod'
import { collection, flatdb, MemoryAdapter, Collection, PathCollection } from '../src/index.js'

const userSchema = z.object({ email: z.string(), name: z.string(), age: z.number().optional() })
type User = z.infer<typeof userSchema>

const db = flatdb(new MemoryAdapter(), {
  users: collection(userSchema),
  autoUsers: collection(userSchema, { mode: 'auto', unique: ['email'] }),
  pages: collection(z.object({ title: z.string() }), { mode: 'path' }),
  loose: collection(),
  loosePages: collection(undefined, { mode: 'path' }),
})

describe('flatdb() types', () => {
  it('types an auto collection as Collection of the schema output', () => {
    expectTypeOf(db.users).toEqualTypeOf<Collection<User>>()
    expectTypeOf(db.autoUsers).toEqualTypeOf<Collection<User>>()
  })

  it('types a path collection as PathCollection', () => {
    expectTypeOf(db.pages).toEqualTypeOf<PathCollection<{ title: string }>>()
    expectTypeOf(db.loosePages).toEqualTypeOf<PathCollection<Record<string, any>>>()
  })

  it('carries the schema type into results', () => {
    type Stored = User & { _id: string }
    type Result<K extends keyof typeof db.users> = (typeof db.users)[K] extends (
      ...args: any[]
    ) => Promise<infer R>
      ? R
      : never
    expectTypeOf<Result<'find'>>().toEqualTypeOf<Stored[]>()
    expectTypeOf<Result<'findOne'>>().toEqualTypeOf<Stored | null>()
    expectTypeOf<Result<'findById'>>().toEqualTypeOf<Stored | null>()
    expectTypeOf<Result<'insert'>>().toEqualTypeOf<Stored>()
  })

  it('keeps Record<string, any> without a schema', () => {
    expectTypeOf(db.loose).toEqualTypeOf<Collection<Record<string, any>>>()
  })

  it('fits a structural slice of Collection without a cast', () => {
    interface UserStore {
      findById(id: string): Promise<{ _id: string; email: string } | null>
      findOne(filter: Record<string, any>): Promise<{ _id: string; email: string } | null>
      insert(doc: Record<string, any>): Promise<{ _id: string; email: string }>
      update(filter: Record<string, any>, changes: Record<string, any>): Promise<number>
      delete(filter: Record<string, any>): Promise<number>
    }
    expectTypeOf(db.users).toExtend<UserStore>()
    expectTypeOf(db.pages).not.toExtend<UserStore>()
  })

  it('types a definition of unknown mode as either collection', () => {
    const options: { mode?: 'auto' | 'path' } = {}
    const mixed = flatdb(new MemoryAdapter(), { things: collection(undefined, options) })
    expectTypeOf(mixed.things).toEqualTypeOf<
      Collection<Record<string, any>> | PathCollection<Record<string, any>>
    >()
  })
})
