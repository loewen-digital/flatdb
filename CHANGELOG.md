# Changelog

All notable changes to flatdb, newest first. SemVer, 0.x is pre-release. The heading
format is a contract, keep it: `## v<Version> · <YYYY-MM-DD> · <Title>`. Lines under
`## Unreleased` move under the next version heading at release; the version in `package.json`
is the topmost released one here.

## Unreleased

- **Cloudflare R2:** `R2Adapter` runs flatdb on Workers with an R2 bucket as storage: `flatdb(new R2Adapter({ bucket: env.CONTENT, prefix: 'data' }))`. Any R2 binding works, no Cloudflare types needed. Listing uses R2's delimiter and follows pagination, `move` copies before it deletes, `watch` is not offered. The README section "Cloudflare R2" has the wrangler binding, SvelteKit usage and the rules for Workers (one database per request, no write serialization across requests, see #3). Decisions: [0001](docs/decisions/0001-r2-adapter-in-the-main-entry.md), [0002](docs/decisions/0002-r2-bucket-interface-follows-the-binding.md), [0003](docs/decisions/0003-index-concurrency-deferred.md). (#1)
- Types for the `./svelte`, `./vue` and `./solid` imports resolve again; the exports pointed at declaration files the build never emits.
- The npm tarball now contains `dist`; without a `files` field npm followed `.gitignore` and packed the sources without the built entry points. `npm pack` and `npm publish` rebuild first.
- Agent rules live in `AGENTS.md`; `CLAUDE.md` only imports it. The Codex review rules are a section of the same file.
