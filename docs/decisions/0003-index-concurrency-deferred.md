# 0003 · Concurrent `_index.json` writes stay unserialized for now

Status: superseded by [0008](0008-index-compare-and-swap.md).

## Context

Codex flagged on PR #2 that two overlapping writers lose an `_index.json` update because `Collection`
does an unconditional read-modify-write. That is core behaviour on every adapter, not R2-specific;
R2 makes it likely because each Worker request is its own writer. R2 offers conditional puts
(`onlyIf.etagMatches`), but using them needs a version concept in `StorageAdapter`.

## Decision

Ship `R2Adapter` without it. Document the limitation and the recovery (`rebuildIndex()`, a Durable
Object to serialize writes) in the README. The proper fix is tracked in #3.

## Consequences

Documents are never lost; index entries can be, until `rebuildIndex()`. Apps with concurrent writers
on one collection serialize writes themselves until #3 lands.
