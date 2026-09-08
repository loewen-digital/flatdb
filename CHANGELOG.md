# Changelog

All notable changes to flatdb, newest first. SemVer, 0.x is pre-release. The heading
format is a contract, keep it: `## v<Version> · <YYYY-MM-DD> · <Title>`. Lines under
`## Unreleased` move under the next version heading at release; the version in `package.json`
is the topmost released one here.

## Unreleased

- `db.close()` stops the file watchers started by `{ watch: true }` and closes the adapter's connection (IndexedDB); `StorageAdapter` gained an optional `close()`. A collection named `close` is rejected. Decision: [0006](docs/decisions/0006-close-on-the-handle.md). (#4)
- Live queries no longer crash the process: a failing re-query or a throwing callback in `live()`, `liveById()` and `liveByPath()` goes to an optional `onError` (default: logged) and the subscription stays alive; `watch()` ends with the error. The framework adapters take `onError` as third argument. Decision: [0005](docs/decisions/0005-live-query-errors.md). (#5)
- Open work lives in GitHub issues only: the review findings from `tasks.md` are now #4 (close the database), #5 (errors in live queries) and #6 (shared deepMerge, migrate tests); the file is gone.
- ESM only: the CommonJS build is gone (`dist/*.cjs` and the `require` conditions). `require('@loewen-digital/flatdb')` no longer works; use `import`. Decision: [0004](docs/decisions/0004-esm-only.md).
- Dependency `nanoid` bumped to 5.1.16 (GHSA-xwg4-73v4-xw9w, GHSA-28wg-ghj8-5hjv); the lockfile's transitive nanoid 3.x moved to 3.3.18.
- **Cloudflare R2:** `R2Adapter` runs flatdb on Workers with an R2 bucket as storage: `flatdb(new R2Adapter({ bucket: env.CONTENT, prefix: 'data' }))`. Any R2 binding works, no Cloudflare types needed. Listing uses R2's delimiter and follows pagination, `move` copies before it deletes, `watch` is not offered. The README section "Cloudflare R2" has the wrangler binding, SvelteKit usage and the rules for Workers (one database per request, no write serialization across requests, see #3). Decisions: [0001](docs/decisions/0001-r2-adapter-in-the-main-entry.md), [0002](docs/decisions/0002-r2-bucket-interface-follows-the-binding.md), [0003](docs/decisions/0003-index-concurrency-deferred.md). (#1)
- Types for the `./svelte`, `./vue` and `./solid` imports resolve again; the exports pointed at declaration files the build never emits.
- The npm tarball now contains `dist`; without a `files` field npm followed `.gitignore` and packed the sources without the built entry points. `npm pack` and `npm publish` rebuild first.
- Agent rules live in `AGENTS.md`; `CLAUDE.md` only imports it. The Codex review rules are a section of the same file.
