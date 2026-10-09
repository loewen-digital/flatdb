# 0013 · Unique fields are checked in the index commit, and the index goes first

## Context

`findOne` then `insert` lets two overlapping registrations of one address both through (#9). The check has to be atomic with the write. Until now the document file was written before the index, so a writer that lost would already have a file on disk, and `rebuildIndex()` would resurrect the duplicate.

## Decision

`CollectionOptions.unique` lists fields (dot paths). `assertUnique` runs inside the `IndexStore.commit` callback, before the mutation: a stale index fails `writeIf`, is reloaded, and the check runs again on the current one. A violation throws `UniqueConstraintError`; the value is a property, not part of the message, so it stays out of logs.

In a collection with unique fields the index is committed first and the files second (Eddy, 2026-10-09). The alternative, files first and the loser cleaning up, needs a restore on `update` that can overwrite a parallel write. When the file of a new document cannot be written, its entry is removed again; an update is left in the index.

Values are compared by their stored JSON, entries are seen through `migrate`. `null` and missing are no value. Auto mode only: in path mode the path is the identity, `unique` throws there.

## Consequences

- A crash between index and file leaves an entry without a file; queries return it, `rebuildIndex()` drops it. Collections without `unique` keep files first.
- Adapters without `readVersioned`/`writeIf` check without the atomicity.
- The check reads every index entry per write, which the index already costs. Composite keys and case folding are out of scope.
