# 0001 · R2Adapter is exported from the main entry, not from `./r2`

## Context

Issue #1 asked for a subpath export `@loewen-digital/flatdb/r2`. The adapter imports nothing but the
package's own types, the other three adapters live in the main entry, and `flatdb()` and `collection()`
come from there anyway, so a Worker imports the main entry regardless. Its `fs` import resolves on
Workers with `nodejs_compat`, which SvelteKit's Cloudflare setup needs anyway. A subpath would also
have inherited the declaration-path bug the framework subpaths had.

## Decision

`import { R2Adapter } from '@loewen-digital/flatdb'`. No `./r2` entry in `package.json` or `vite.config.ts`.

## Consequences

One import path for everything. If the main entry ever has to stay free of Node imports for a runtime
without `nodejs_compat`, the fix is a lazily loaded `FsAdapter`, not a second entry for R2.
