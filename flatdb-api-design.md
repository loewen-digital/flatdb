# FlatDB — API Design Document

**Package:** `@loewen-digital/flatdb`

## Vision

A schema-optional document database using the filesystem as storage. One file per document, folders as structure. No server, no migrations, zero-config possible. Optimized for coding agents, TypeScript-first, reactive.

-----

## Core Principles

- **One file = one document.** JSON files, human-readable, diffable, Git-friendly.
- **Folders = structure.** Paths are semantic (like file-based routing).
- **No migration steps.** Change the schema → done. Old docs remain valid.
- **Read tolerant, write strict.** Reads apply defaults, writes validate.
- **Agent-friendly.** An agent can read/write files directly — the DB picks it up.
- **TypeScript-first.** Full autocomplete and type inference from the schema.

-----

## Init

```ts
import { flatdb, collection, ref } from '@loewen-digital/flatdb'
import { z } from 'zod'

// Zero-config (schemaless, everything any)
const db = flatdb('./data')

// With schema
const db = flatdb('./data', {
  pages: collection(
    z.object({
      title: z.string(),
      content: z.string(),
      publishedAt: z.number().optional(),
      author: ref('users'),
    }),
    { mode: 'path' }
  ),

  categories: collection(
    z.object({
      name: z.string(),
      description: z.string(),
      icon: z.string().optional(),
    }),
    { mode: 'path' }
  ),

  users: collection(
    z.object({
      name: z.string(),
      email: z.string(),
      settings: z
        .object({
          theme: z.string(),
          notifications: z.boolean(),
        })
        .optional(),
    }),
    { mode: 'auto' }
  ),
})
```

### Environments

```ts
// Node: Filesystem
const db = flatdb('./data')

// Browser: IndexedDB (same API)
const db = flatdb('idb://myapp')
```

-----

## Collection Modes

Each collection chooses its mode individually. Path mode is **completely optional** — you can run the entire DB with auto mode only.

```ts
// Auto mode only — perfectly valid
const db = flatdb('./data', {
  users: collection(userSchema),
  todos: collection(todoSchema),
  posts: collection(postSchema),
})
```

### `mode: 'path'` — Path as Identity

The file path relative to the collection is the ID. Ideal for CMS content, pages, categories, docs.

```
data/pages/
├── index.json                → path: ""  (root)
├── about.json                → path: "about"
├── blog/
│   ├── index.json            → path: "blog"
│   ├── my-first-post.json    → path: "blog/my-first-post"
│   └── nextjs-is-dead.json   → path: "blog/nextjs-is-dead"
└── docs/
    ├── index.json            → path: "docs"
    ├── getting-started.json  → path: "docs/getting-started"
    └── api/
        ├── index.json        → path: "docs/api"
        └── auth.json         → path: "docs/api/auth"
```

### `mode: 'auto'` — Auto-generated ID (Default)

Nanoid as filename. Classic document DB pattern.

```
data/users/
├── _index.json       ← query index (automatic)
├── xk7f2a.json
├── m9p3bc.json
└── def456.json
```

### File Structure Rules

| File                | Meaning                                      |
| ------------------- | -------------------------------------------- |
| `file.json`         | Document with path/ID `"file"`               |
| `folder/index.json` | Document with path `"folder"` (has children) |
| `folder/child.json` | Document with path `"folder/child"`          |
| `_index.json`       | Query index (auto-generated, do not edit)    |

-----

## CRUD — Path Mode

### Insert

```ts
await db.pages.insert('blog/my-first-post', {
  title: 'My First Post',
  content: '# Hello World',
  author: 'abc123',
})
// → creates data/pages/blog/my-first-post.json
```

### Read

```ts
// By path
const page = await db.pages.get('blog/my-first-post')

// All pages under a path (direct children)
const blogPosts = await db.pages.find({ $path: 'blog/*' })

// Recursive — all pages under docs/
const allDocs = await db.pages.find({ $path: 'docs/**' })

// Combined with filters
const published = await db.pages.find(
  {
    $path: 'blog/*',
    publishedAt: { $ne: null },
  },
  { sort: { publishedAt: -1 }, limit: 10 }
)
```

### Tree

```ts
const tree = await db.pages.tree('docs')
// → {
//     path: 'docs',
//     doc: { title: 'Docs', ... },
//     children: [
//       { path: 'docs/getting-started', doc: {...}, children: [] },
//       { path: 'docs/api', doc: {...}, children: [
//         { path: 'docs/api/auth', doc: {...}, children: [] }
//       ]},
//     ]
//   }
```

### Update

```ts
await db.pages.update('blog/my-first-post', {
  title: 'Updated Title',
})
// → partial deep-merge, not replace
```

### Delete

```ts
await db.pages.delete('blog/old-post')
await db.pages.delete('docs/deprecated', { recursive: true })
```

### Move / Rename

```ts
await db.pages.move('blog/draft', 'blog/published-post')
```

### Promote / Demote

```ts
// Leaf → node (file → folder with index.json)
await db.pages.promote('tech')
// tech.json → tech/index.json

// Node → leaf (only if no children)
await db.pages.demote('tech')
// tech/index.json → tech.json
```

-----

## CRUD — Auto Mode

### Insert

```ts
const user = await db.users.insert({
  name: 'Max',
  email: 'max@example.com',
})
// → { _id: 'xk7f2a', name: 'Max', email: 'max@example.com' }
// → creates data/users/xk7f2a.json

// Bulk
await db.users.insertMany([
  { name: 'Alice', email: 'alice@example.com' },
  { name: 'Bob', email: 'bob@example.com' },
])
```

### Read

```ts
const user = await db.users.findById('xk7f2a')
const user = await db.users.findOne({ email: 'max@example.com' })
const all = await db.users.find()
const admins = await db.users.find({ role: 'admin' })
```

### Update

```ts
await db.users.update({ _id: 'xk7f2a' }, { name: 'Maximilian' })
await db.users.update({ role: 'guest' }, { $set: { active: false } })
```

### Delete

```ts
await db.users.delete({ _id: 'xk7f2a' })
await db.users.deleteMany({ active: false })
```

### Count

```ts
const n = await db.users.count({ role: 'admin' })
```

-----

## Query Operators

```ts
// Comparison
{ age: { $gt: 18 } }
{ age: { $gte: 18 } }
{ age: { $lt: 65 } }
{ age: { $lte: 65 } }
{ age: { $ne: null } }
{ age: { $between: [18, 65] } }

// Sets
{ status: { $in: ['active', 'pending'] } }
{ status: { $nin: ['deleted'] } }

// String
{ title: { $contains: 'hello' } }
{ title: { $startsWith: 'My' } }
{ title: { $endsWith: '!' } }
{ title: { $regex: /^My.*Post$/ } }

// Arrays
{ tags: { $contains: 'featured' } }
{ tags: { $containsAll: ['featured', 'new'] } }
{ tags: { $containsAny: ['featured', 'popular'] } }

// Nested fields (dot-notation)
{ 'settings.theme': 'dark' }
{ 'meta.views': { $gt: 100 } }

// Logical operators
{ $or: [{ status: 'active' }, { featured: true }] }
{ $and: [{ age: { $gt: 18 } }, { age: { $lt: 65 } }] }
{ $not: { status: 'deleted' } }

// Path queries (path mode only)
{ $path: 'blog/*' }        // direct children
{ $path: 'blog/**' }       // recursive
{ $path: 'docs/api/*' }    // under specific path
```

### Query Options

```ts
db.todos.find(filter, {
  sort: { createdAt: -1 },         // -1 = desc, 1 = asc
  limit: 10,
  skip: 20,
  select: ['title', 'status'],     // specific fields only
  populate: ['author'],            // resolve references
})
```

-----

## References

### Schema Definition

```ts
const Todo = z.object({
  text: z.string(),
  assignee: ref('users'),                    // exactly 1 user
  watchers: ref('users').array(),            // multiple users
  project: ref('projects').optional(),       // optional
  category: ref('categories'),              // to path-based collection
})
```

### Writing — pass the ID only

```ts
await db.todos.insert('fix-bug', {
  text: 'Fix the login bug',
  assignee: 'abc123',
  watchers: ['abc123', 'def456'],
  project: 'proj_01',
  category: 'dev/frontend',       // path for path-based collections
})
```

### Reading — IDs only by default

```ts
const todo = await db.todos.get('fix-bug')
// → { text: '...', assignee: 'abc123', watchers: ['abc123', 'def456'] }
```

### Reading with Populate

```ts
// Flat
const todo = await db.todos.get('fix-bug', {
  populate: ['assignee', 'watchers'],
})
// → { ..., assignee: { _id: 'abc123', name: 'Max', ... }, watchers: [...] }

// Deep
const todo = await db.todos.get('fix-bug', {
  populate: {
    assignee: true,
    category: true,
    project: { populate: ['members'] },
  },
})
```

### Storage Format

```json
{
  "text": "Fix the login bug",
  "assignee": "ref:users/abc123",
  "watchers": ["ref:users/abc123", "ref:users/def456"],
  "category": "ref:categories/dev/frontend"
}
```

-----

## Schema Evolution (No Migrations)

### Adding Fields

```ts
// New fields must be .optional() or .default()
const Todo = z.object({
  text: z.string(),
  done: z.boolean(),
  priority: z.number().optional(),       // old docs → undefined
  createdAt: z.number().default(0),      // old docs → 0
})
```

### Removing Fields

```ts
// Simply omit from the schema.
// The field remains in the JSON file but is ignored.
```

### Renaming / Transforming Fields

```ts
const Todo = collection(
  z.object({
    text: z.string(),
    status: z.enum(['todo', 'doing', 'done']).default('todo'),
  }),
  {
    // Lazy migration: applied on read + written back
    migrate: (doc) => ({
      ...doc,
      status: doc.done ? 'done' : 'todo',
    }),
  }
)
```

### Behavior

| Situation                | Read                    | Write            |
| ------------------------ | ----------------------- | ---------------- |
| Field missing + optional | `undefined`             | OK without field |
| Field missing + default  | Default value           | OK without field |
| Field missing + required | Error (or migrate)      | Error            |
| Unknown field in file    | Stripped (configurable) | N/A              |
| Wrong type               | Error                   | Error            |

### Configuration

```ts
collection(schema, {
  unknownFields: 'strip',      // 'strip' | 'passthrough' | 'error'
  validateOnRead: true,         // Default: true
})
```

-----

## Reactivity

### Live Queries

```ts
// Callback-based
const unsub = db.todos.live({ done: false }, (results) => {
  console.log('Active todos:', results)
})

// Cleanup
unsub()
```

### Watch (AsyncIterator)

```ts
for await (const results of db.todos.watch({ done: false })) {
  console.log('Updated:', results)
}
```

### Watch Single Document

```ts
// Auto mode
db.users.liveById('abc123', (user) => {
  console.log('User changed:', user)
})

// Path mode
db.pages.liveByPath('blog/my-post', (page) => {
  console.log('Page changed:', page)
})
```

### Implementation (Level 1)

Collection-level: on every write, all subscribers of the collection are notified and re-evaluate their query. Simple, performant enough for most use cases.

-----

## Indexing

Each collection has an automatically maintained `_index.json`:

```
data/users/
├── _index.json       ← automatic
├── xk7f2a.json
└── m9p3bc.json
```

```json
// _index.json
{
  "xk7f2a": { "name": "Max", "email": "max@example.com", "role": "admin" },
  "m9p3bc": { "name": "Alice", "email": "alice@example.com", "role": "user" }
}
```

- Automatically updated on every write.
- Queries run against the index first.
- Can be rebuilt from individual files at any time: `db.users.rebuildIndex()`
- For path-mode collections, the index also contains the path hierarchy.

-----

## File Watching (Agent Compatibility)

```ts
// Optional: DB watches the filesystem
const db = flatdb('./data', schema, {
  watch: true,    // Default: false
})
```

When enabled:

- An agent (or human) creates/edits/deletes a JSON file
- The DB detects the change via `fs.watch`
- Index is updated
- Live queries are re-evaluated

This means: **Agents don't need the DB API.** They can simply read and write files.

-----

## Storage Adapter Interface

```ts
interface StorageAdapter {
  read(path: string): Promise<string | null>
  write(path: string, data: string): Promise<void>
  delete(path: string): Promise<void>
  exists(path: string): Promise<boolean>
  list(dir: string): Promise<string[]>
  mkdir(dir: string): Promise<void>
  move(from: string, to: string): Promise<void>
  watch?(dir: string, cb: (event: WatchEvent) => void): () => void
}
```

Every runtime implements this interface. The entire core (Collections, Queries, Refs, Reactivity) works only against this interface and knows no runtime details.

**Reactivity vs. External Watch:**

- **Reactivity** (live queries, `live()`, `watch()`, framework adapters) runs via an internal EventEmitter in the core. Every mutation through the API automatically triggers subscribers. Works **on all runtimes** — no adapter support needed.
- **External Watch** (`watch` in the StorageAdapter) detects changes that happen **outside the API** (e.g. an agent edits JSON files directly). Only relevant and useful on filesystem runtimes. On Browser/Edge/Memory there is no external access → not applicable.

-----

## Runtimes & Platforms

### Overview

| Runtime            | Adapter               | Storage    | Reactivity | Ext. Watch       | Priority            |
| ------------------ | --------------------- | ---------- | ---------- | ---------------- | ------------------- |
| Node.js            | `FsAdapter`           | Filesystem | ✅          | ✅ `fs.watch`     | Phase 1             |
| Bun                | `FsAdapter`           | Filesystem | ✅          | ✅ `fs.watch`     | Phase 1 (same code) |
| Deno               | `FsAdapter`           | Filesystem | ✅          | ✅ `Deno.watchFs` | Phase 1 (same code) |
| Browser            | `IndexedDBAdapter`    | IndexedDB  | ✅          | — (n/a)          | Phase 2             |
| Tests / SSR        | `MemoryAdapter`       | RAM        | ✅          | — (n/a)          | Phase 3             |
| Cloudflare Workers | `CloudflareKVAdapter` | KV / R2    | ✅          | — (n/a)          | Phase 4 (on demand) |
| Vercel Edge        | `VercelKVAdapter`     | Vercel KV  | ✅          | — (n/a)          | Phase 4 (on demand) |

### Node / Bun / Deno

All three support `fs`-compatible APIs. A single `FsAdapter` covers all of them.

```ts
// Same everywhere:
const db = flatdb('./data')

// Under the hood FsAdapter uses:
// Node: fs.promises.readFile / writeFile
// Bun:  compatible with fs.promises (optionally Bun.file() for more speed)
// Deno: compatible via node:fs compat layer
```

### Browser

No filesystem available. `IndexedDBAdapter` emulates a folder structure via keys.

```ts
const db = flatdb('idb://myapp')

// Under the hood:
// "todos/abc123" → IndexedDB key: "todos/abc123", value: "{...}"
// list("todos/") → IndexedDB query with key-range prefix "todos/"
```

### In-Memory (Tests / SSR)

```ts
import { flatdb, MemoryAdapter } from '@loewen-digital/flatdb'

const db = flatdb(new MemoryAdapter())

// Everything in RAM, nothing is persisted.
// Ideal for unit tests and server-side rendering.
```

### Edge Runtimes (Cloudflare, Vercel)

Edge has neither filesystem nor IndexedDB. Adapters map to key-value stores.

```ts
// Cloudflare Worker
import { CloudflareKVAdapter } from '@loewen-digital/flatdb/cloudflare'

const db = flatdb(new CloudflareKVAdapter(env.MY_KV_NAMESPACE))

// Under the hood:
// read("todos/abc123")      → KV.get("todos/abc123")
// write("todos/abc123", ..) → KV.put("todos/abc123", data)
// list("todos/")            → KV.list({ prefix: "todos/" })
```

Limitations on Edge:

- No External Watch (no external access possible → n/a). Reactivity via internal EventEmitter works normally.
- KV is eventually consistent → reads may be briefly stale
- Folder structure is emulated via key prefixes

### Rollout Order

```
Phase 1:  FsAdapter          → Node, Bun, Deno
Phase 2:  IndexedDBAdapter   → Browser
Phase 3:  MemoryAdapter      → Tests, SSR
Phase 4:  Edge Adapters      → Cloudflare, Vercel (on demand)
```

-----

## Full API Overview

```ts
// Collection (both modes)
db.collection.find(filter?, options?)       → Promise<Doc[]>
db.collection.findOne(filter)               → Promise<Doc | null>
db.collection.count(filter?)                → Promise<number>
db.collection.live(filter?, cb)             → () => void (unsub)
db.collection.watch(filter?)                → AsyncIterable<Doc[]>
db.collection.rebuildIndex()                → Promise<void>

// Auto Mode
db.collection.insert(doc)                   → Promise<Doc>
db.collection.insertMany(docs)              → Promise<Doc[]>
db.collection.findById(id)                  → Promise<Doc | null>
db.collection.liveById(id, cb)              → () => void
db.collection.update(filter, changes)       → Promise<number>
db.collection.delete(filter)                → Promise<number>
db.collection.deleteMany(filter)            → Promise<number>

// Path Mode
db.collection.insert(path, doc)             → Promise<Doc>
db.collection.get(path, options?)           → Promise<Doc | null>
db.collection.liveByPath(path, cb)          → () => void
db.collection.update(path, changes)         → Promise<Doc>
db.collection.delete(path, options?)        → Promise<void>
db.collection.move(from, to)               → Promise<void>
db.collection.promote(path)                → Promise<void>
db.collection.demote(path)                 → Promise<void>
db.collection.tree(path?)                  → Promise<TreeNode>
```

-----

## Architecture Overview

```
┌─────────────────────────────────────────────┐
│            Framework Adapters               │
│  Svelte │ Vue │ Solid │ React │ Vanilla JS  │
├─────────────────────────────────────────────┤
│               flatdb Core                   │
│  Collections │ Queries │ Refs │ Reactivity  │
├─────────────────────────────────────────────┤
│            Storage Adapter                  │
│    FsAdapter │ IndexedDBAdapter │ Memory    │
└─────────────────────────────────────────────┘
```

- **Storage Adapter:** Reads/writes files. Swappable per environment.
- **Core:** Query engine, schema validation, index management, reactivity. Framework-agnostic.
- **Framework Adapters:** Thin wrappers (~30-50 lines) that translate core reactivity into framework-specific primitives.

-----

## Framework Adapters

The core is framework-agnostic (Vanilla JS). Thin wrappers on top use the reactive system of each framework. Each adapter is ~30-50 lines of code.

### Package Structure

```
@loewen-digital/flatdb                     ← Core (Vanilla JS, Node + Browser)
@loewen-digital/flatdb/svelte              ← Svelte 5 (Runes)
@loewen-digital/flatdb/vue                 ← Vue 3 (Composition API)
@loewen-digital/flatdb/solid               ← SolidJS (Signals)
@loewen-digital/flatdb/react               ← React (useSyncExternalStore)
```

### Svelte 5

```svelte
<script>
  import { db } from '$lib/db'
  import { liveQuery } from '@loewen-digital/flatdb/svelte'

  // Returns a reactive Svelte $state
  const todos = liveQuery(() => db.todos.find({ done: false }))
</script>

{#each $todos as todo}
  <p>{todo.text}</p>
{/each}
```

### Vue 3

```vue
<script setup>
import { db } from '@/lib/db'
import { useLiveQuery } from '@loewen-digital/flatdb/vue'

// Returns a Vue ref() that updates automatically
const todos = useLiveQuery(() => db.todos.find({ done: false }))
</script>

<template>
  <p v-for="todo in todos" :key="todo._id">{{ todo.text }}</p>
</template>
```

### SolidJS

```tsx
import { db } from './db'
import { createLiveQuery } from '@loewen-digital/flatdb/solid'

function TodoList() {
  // Returns a Solid Signal
  const todos = createLiveQuery(() => db.todos.find({ done: false }))

  return <For each={todos()}>{todo => <p>{todo.text}</p>}</For>
}
```

### React

```tsx
import { db } from './db'
import { useLiveQuery } from '@loewen-digital/flatdb/react'

function TodoList() {
  // Uses useSyncExternalStore under the hood
  const todos = useLiveQuery(() => db.todos.find({ done: false }))

  return todos.map(todo => <p key={todo._id}>{todo.text}</p>)
}
```

### Vanilla JS (Core)

```ts
// Without framework — callback or AsyncIterator
const unsub = db.todos.live({ done: false }, (results) => {
  document.getElementById('list').innerHTML =
    results.map(t => `<p>${t.text}</p>`).join('')
})
```

### Adapter Internals

All framework adapters implement the same pattern:

```ts
// Pseudo-code — basic adapter skeleton
function liveQuery(queryFn) {
  // 1. Execute query once → initial value
  // 2. Derive collection from queryFn
  // 3. Subscribe via collection.live() → receive updates
  // 4. Wrap result in framework-specific reactive container
  //    - Svelte: $state
  //    - Vue: ref()
  //    - Solid: createSignal()
  //    - React: useSyncExternalStore()
  // 5. On cleanup (onDestroy / onUnmounted / onCleanup): unsubscribe
}
```

-----

## Open Items / Next Steps

- [x] Package name: `@loewen-digital/flatdb`
- [ ] Prototype: Storage Adapter (fs) + Collection (auto mode) + CRUD
- [ ] Index implementation
- [ ] Path mode implementation
- [ ] References + populate
- [ ] Reactivity (Level 1 — collection-level)
- [ ] Browser adapter (IndexedDB)
- [ ] Framework adapters: Svelte, Vue, Solid, React
- [ ] CLI tool (`flatdb query`, `flatdb export`, etc.)
- [ ] Publish to npm
