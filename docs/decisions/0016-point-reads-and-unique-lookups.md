# 0016 · Point reads and unique lookups on R2

## Context

On R2 every `findById` and `findOne` downloaded the collection's whole `_index.json`. anstoss-online resolves a session token on every request, so each request would fetch all sessions. (#11)

## Decision

- `StorageAdapter.pointReads` (set by `R2Adapter`) lets auto-mode collections read single objects while their index is not cached. Memory, Fs and IndexedDB do not set it and keep reading the index.
- `findById` reads `<collection>/<id>.json`; IDs outside nanoid's alphabet return `null` unread, since the ID becomes part of a key.
- Per unique field, `<collection>/_unique/<field>/<sha256(value)>.json` holds `{ id }`, written after the index CAS, which stays the authority on uniqueness. `findOne` with one equality on that field goes lookup → document and checks the value, so stale lookups are harmless. Update and delete remove a lookup only while it still points to their document.
- A missing lookup is a definite miss once `_unique/_ready.json` lists the field (Eddy chose this over falling back to the index on every miss, which would let forged tokens force full downloads). A collection that starts empty is marked by its first insert; existing data by `rebuildIndex()`. Unmarked fields fall back to the index.
- `insert` accepts `_id` (nanoid alphabet, 1–128 characters), checked inside the index CAS, so an app can use a token hash as ID.

## Consequences

- A crash between index commit and lookup write, or a writer on an older flatdb version, leaves a document `findOne` cannot see on a marked field; the next write of that document or `rebuildIndex()` restores it.
- Writes on R2 with unique fields cost one PUT per field more; changing or deleting a value one GET and DELETE more.
- `findById` on R2 sees the file, not the index: a document whose index entry was lost in a crash is found by `findById` but not by `find` until `rebuildIndex()`.
