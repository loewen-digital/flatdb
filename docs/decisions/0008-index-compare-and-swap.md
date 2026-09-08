# 0008 · `_index.json` is written as a compare-and-swap through optional adapter hooks

## Context

Every mutation read the index, changed it and wrote it back unconditionally, so two writers (two Worker
requests, two tabs) lost each other's entries (#3; 0003 had deferred it). A lock has nothing to lock on
with R2 and a Durable Object is Cloudflare-only; R2, IndexedDB and memory all offer a conditional write.

## Decision

`StorageAdapter` gains optional `readVersioned(path)` and `writeIf(path, data, version)`. The shared
`IndexStore` commits with `writeIf`; on `null` it reloads, re-applies the change and retries, five times,
then throws. R2 maps the version to the etag (`onlyIf.etagMatches`; `etagDoesNotMatch: '*'` creates only
if absent; verified against miniflare, etags unquoted). IndexedDB compares the stored content inside one
readwrite transaction, Memory keeps a counter per key. `FsAdapter` stays unconditional: no atomic CAS.

## Consequences

Concurrent writers on one collection keep all index entries; a lost race costs one extra read. Writes to
the same document stay last-writer-wins. Change functions may run more than once; they are idempotent.
