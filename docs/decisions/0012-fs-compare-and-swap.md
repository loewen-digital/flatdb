# 0012 · `FsAdapter` writes atomically and takes part in the index compare-and-swap

## Context

0008 left `FsAdapter` unconditional. An app with one `flatdb()` per request under `vite dev` tore `_index.json` (two `writeFile` on one path) and lost index entries (#10). The retry loop gave up after five immediate attempts, so six colliding writers were enough to throw.

## Decision

`write` goes through a temp file in the same directory (`.<name>.<id>.tmp`, hidden from `list`) and a `rename`. `readVersioned`/`writeIf` use the SHA-1 of the content as version (Web Crypto, no new import for Workers bundles); mtime and size collide for equal-length writes within one tick. Check and write run in a queue per absolute path at module level, because every request has its own adapter.

`IndexStore.commit` waits a random time below `min(150, 4·2ⁿ⁻¹)` ms after a lost race and tries twenty times. Measured on `FsAdapter`: 200 parallel inserts all land, 400 start to fail.

## Consequences

- One process is safe. Several processes on one folder never tear a file but can still drop an index entry; there is no lock file.
- No `fsync`: atomic for readers, no durability promise after power loss.
- Every write reaches `fs.watch` as a `rename`. A writer that never wins throws after about a second.
