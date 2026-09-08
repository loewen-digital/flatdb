# Changelog

All notable changes to flatdb, newest first. SemVer, 0.x is pre-release. The heading
format is a contract, keep it: `## v<Version> · <YYYY-MM-DD> · <Title>`. Lines under
`## Unreleased` move under the next version heading at release; the version in `package.json`
is the topmost released one here.

## Unreleased

## v0.2.1 · 2026-09-08 · Release on tag

- Releases run from tags: pushing `v<version>` runs the tests, publishes to npm through trusted publishing (no token, provenance included) and creates the GitHub Release with this file's matching section as notes. The tag must equal the version in `package.json`. Decision: [0010](docs/decisions/0010-release-on-tag.md).
- `LICENSE` file (MIT) and `repository`, `bugs`, `homepage` in `package.json`, so npm shows the license and source and can attest provenance.
- Node 24 is the required version (`engines.node` in `package.json`); CI, deploy and the agent workflow read it from there.

## v0.2.0 · 2026-09-08 · Cloudflare R2, ESM only, a concurrency-safe index

- First release on npm. The April build is recorded below as v0.1.0, so the fixes in this release read against the state they fix; it was never published. Decision: [0009](docs/decisions/0009-retroactive-v0-1-0.md).
- Concurrent writers no longer lose `_index.json` entries: the index is written as a compare-and-swap through new optional `readVersioned`/`writeIf` hooks on `StorageAdapter`, implemented for R2 (etag), IndexedDB (one transaction) and Memory; a writer that lost the race reloads, re-applies its change and retries. `FsAdapter` is unchanged. Decision: [0008](docs/decisions/0008-index-compare-and-swap.md). (#3)
- `migrate` now runs on every read, before filters are matched and regardless of schema or `validateOnRead`, so queries find old documents by their migrated fields; files still change on their next write. `deepMerge` is one shared function, and both are covered by tests. Decision: [0007](docs/decisions/0007-migrate-on-read.md). (#6)
- `db.close()` stops the file watchers started by `{ watch: true }` and closes the adapter's connection (IndexedDB); `StorageAdapter` gained an optional `close()`. A collection named `close` is rejected. Decision: [0006](docs/decisions/0006-close-on-the-handle.md). (#4)
- Live queries no longer crash the process: a failing re-query or a throwing callback in `live()`, `liveById()` and `liveByPath()` goes to an optional `onError` (default: logged) and the subscription stays alive; `watch()` ends with the error. The framework adapters take `onError` as third argument. Decision: [0005](docs/decisions/0005-live-query-errors.md). (#5)
- Open work lives in GitHub issues only: the review findings from `tasks.md` are now #4 (close the database), #5 (errors in live queries) and #6 (shared deepMerge, migrate tests); the file is gone.
- ESM only: the CommonJS build is gone (`dist/*.cjs` and the `require` conditions). `require('@loewen-digital/flatdb')` no longer works; use `import`. Decision: [0004](docs/decisions/0004-esm-only.md).
- Dependency `nanoid` bumped to 5.1.16 (GHSA-xwg4-73v4-xw9w, GHSA-28wg-ghj8-5hjv); the lockfile's transitive nanoid 3.x moved to 3.3.18.
- **Cloudflare R2:** `R2Adapter` runs flatdb on Workers with an R2 bucket as storage: `flatdb(new R2Adapter({ bucket: env.CONTENT, prefix: 'data' }))`. Any R2 binding works, no Cloudflare types needed. Listing uses R2's delimiter and follows pagination, `move` copies before it deletes, `watch` is not offered. The README section "Cloudflare R2" has the wrangler binding, SvelteKit usage and the rules for Workers (one database per request, no write serialization across requests, see #3). Decisions: [0001](docs/decisions/0001-r2-adapter-in-the-main-entry.md), [0002](docs/decisions/0002-r2-bucket-interface-follows-the-binding.md), [0003](docs/decisions/0003-index-concurrency-deferred.md). (#1)
- Types for the `./svelte`, `./vue` and `./solid` imports resolve again; the exports pointed at declaration files the build never emits.
- The npm tarball now contains `dist`; without a `files` field npm followed `.gitignore` and packed the sources without the built entry points. `npm pack` and `npm publish` rebuild first.
- Agent rules live in `AGENTS.md`; `CLAUDE.md` only imports it. The Codex review rules are a section of the same file.

## v0.1.0 · 2026-04-01 · Initial build

- Never published to npm; this section is reconstructed from the README and the commits of 2026-03-31 to 2026-04-01. Tag `v0.1.0` marks the state.
- `flatdb(path, schema?, options?)` opens a database of typed collections: one JSON file per document, a `_index.json` per collection for queries. Schemaless without a schema, or `collection(zodSchema, options)` with full type inference from Zod. Options `unknownFields` (`strip`, `passthrough`, `error`), `validateOnRead` and `migrate` for lazy schema evolution without migration runs.
- Auto mode (default): nanoid `_id`, `insert`, `insertMany`, `findById`, `findOne`, `find`, `count`, `update`, `delete`, `deleteMany`.
- Path mode (`{ mode: 'path' }`): the file path is the identity, for CMS pages and docs. `insert(path, doc)`, `get`, `find` with `$path` globs, `move`, `promote` (leaf to `path/index.json`) and `demote` (back to a leaf while it has no children), `tree()` for a subtree.
- Query engine with comparison (`$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$between`), set (`$in`, `$nin`), string (`$contains`, `$startsWith`, `$endsWith`, `$regex`), array (`$containsAll`, `$containsAny`) and logical (`$and`, `$or`, `$not`) operators, nested fields by dot path, and the options `sort`, `limit`, `skip`, `select`, `populate`.
- References: `ref('users')` in a schema stores IDs, `populate` resolves them to documents, arrays of refs included.
- Reactivity: `live(filter, cb)` with a callback and `watch(filter)` as async iterator, plus `liveById` and `liveByPath`. Changes made through the database are pushed by an internal event emitter; `{ watch: true }` also picks up files edited outside (by agents or editors) through `fs.watch`.
- Storage adapters: `FsAdapter` for Node, Bun and Deno, `IndexedDBAdapter` in the browser via `flatdb('idb://name')`, `MemoryAdapter` for tests and SSR. The `StorageAdapter` interface (`read`, `write`, `delete`, `exists`, `list`, `mkdir`, `move`, optional `watch`) takes custom backends.
- Framework adapters: `liveQuery` from `@loewen-digital/flatdb/svelte` (Svelte 5), `useLiveQuery` from `./vue` (Vue 3), `createLiveQuery` from `./solid`.
- Tooling: Vite build with ESM and CommonJS output, a vitest suite covering collections, queries, refs, reactivity and every adapter; the API design lives in `flatdb-api-design.md`.
