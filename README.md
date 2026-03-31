# FlatDB

A schema-optional document database using the filesystem as storage. One file per document, folders as structure. No server, no migrations, zero-config possible.

- **TypeScript-first** — full autocomplete and type inference from the schema
- **Agent-friendly** — agents can read/write JSON files directly, the DB picks it up
- **Git-friendly** — human-readable JSON, one file per document, easy diffs
- **Cross-platform** — Node.js, Bun, Deno, Browser (IndexedDB), Edge runtimes

## Install

```bash
npm install @loewen-digital/flatdb
```

## Quick Start

```ts
import { flatdb, collection } from '@loewen-digital/flatdb'
import { z } from 'zod'

// Zero-config (schemaless)
const db = flatdb('./data')

// With schema
const db = flatdb('./data', {
  users: collection(
    z.object({
      name: z.string(),
      email: z.string(),
      role: z.enum(['admin', 'user']).default('user'),
    })
  ),
})
```

## Collection Modes

### Auto Mode (Default)

Auto-generated IDs (nanoid). Classic document DB pattern.

```ts
const user = await db.users.insert({
  name: 'Max',
  email: 'max@example.com',
})
// → { _id: 'xk7f2a', name: 'Max', email: 'max@example.com' }
// → creates data/users/xk7f2a.json

const user = await db.users.findById('xk7f2a')
const admins = await db.users.find({ role: 'admin' })

await db.users.update({ _id: 'xk7f2a' }, { name: 'Maximilian' })
await db.users.delete({ _id: 'xk7f2a' })
```

### Path Mode

File path as identity. Ideal for CMS content, pages, docs.

```ts
const db = flatdb('./data', {
  pages: collection(pageSchema, { mode: 'path' }),
})

await db.pages.insert('blog/my-first-post', {
  title: 'My First Post',
  content: '# Hello World',
})
// → creates data/pages/blog/my-first-post.json

const page = await db.pages.get('blog/my-first-post')
const blogPosts = await db.pages.find({ $path: 'blog/*' })
const tree = await db.pages.tree('docs')
```

## Query Operators

```ts
// Comparison
{ age: { $gt: 18 } }
{ age: { $between: [18, 65] } }

// Sets
{ status: { $in: ['active', 'pending'] } }

// String
{ title: { $contains: 'hello' } }
{ title: { $startsWith: 'My' } }
{ title: { $regex: /^My.*Post$/ } }

// Arrays
{ tags: { $containsAll: ['featured', 'new'] } }

// Logical
{ $or: [{ status: 'active' }, { featured: true }] }

// Nested fields
{ 'settings.theme': 'dark' }

// Query options
db.users.find(filter, {
  sort: { createdAt: -1 },
  limit: 10,
  skip: 20,
  select: ['name', 'email'],
  populate: ['author'],
})
```

## References

```ts
import { ref } from '@loewen-digital/flatdb'

const Todo = z.object({
  text: z.string(),
  assignee: ref('users'),
  watchers: ref('users').array(),
})

// Write with IDs
await db.todos.insert('fix-bug', {
  text: 'Fix the login bug',
  assignee: 'abc123',
  watchers: ['abc123', 'def456'],
})

// Read with populate
const todo = await db.todos.get('fix-bug', {
  populate: ['assignee', 'watchers'],
})
// → { ..., assignee: { _id: 'abc123', name: 'Max', ... } }
```

## Schema Evolution

No migrations needed. Add optional/default fields, remove fields, or use lazy migration:

```ts
const Todo = collection(
  z.object({
    text: z.string(),
    status: z.enum(['todo', 'doing', 'done']).default('todo'),
  }),
  {
    migrate: (doc) => ({
      ...doc,
      status: doc.done ? 'done' : 'todo',
    }),
  }
)
```

## Reactivity

```ts
// Live query (callback)
const unsub = db.todos.live({ done: false }, (results) => {
  console.log('Active todos:', results)
})

// Watch (async iterator)
for await (const results of db.todos.watch({ done: false })) {
  console.log('Updated:', results)
}
```

## File Watching

Enable filesystem watching so external changes (e.g. from agents editing JSON files directly) are picked up automatically:

```ts
const db = flatdb('./data', schema, { watch: true })
```

## Environments

```ts
// Node / Bun / Deno — filesystem
const db = flatdb('./data')

// Browser — IndexedDB
const db = flatdb('idb://myapp')

// In-memory — tests / SSR
import { MemoryAdapter } from '@loewen-digital/flatdb'
const db = flatdb(new MemoryAdapter())
```

## Framework Adapters

```ts
// Svelte 5
import { liveQuery } from '@loewen-digital/flatdb/svelte'
const todos = liveQuery(() => db.todos.find({ done: false }))

// Vue 3
import { useLiveQuery } from '@loewen-digital/flatdb/vue'
const todos = useLiveQuery(() => db.todos.find({ done: false }))

// SolidJS
import { createLiveQuery } from '@loewen-digital/flatdb/solid'
const todos = createLiveQuery(() => db.todos.find({ done: false }))
```

## Architecture

```
┌─────────────────────────────────────────────┐
│            Framework Adapters               │
│       Svelte │ Vue │ Solid │ Vanilla JS     │
├─────────────────────────────────────────────┤
│               flatdb Core                   │
│  Collections │ Queries │ Refs │ Reactivity  │
├─────────────────────────────────────────────┤
│            Storage Adapter                  │
│    FsAdapter │ IndexedDBAdapter │ Memory    │
└─────────────────────────────────────────────┘
```

## License

MIT
