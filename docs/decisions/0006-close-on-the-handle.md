# 0006 · `close()` lives on the `flatdb()` handle; the name is reserved

## Context

`flatdb()` returns a plain map of collections, so a shutdown method competes with collection names.
Issue #4 allowed two designs: a method on the handle that rejects a colliding collection, or a
separate handle (for example `const { db, close } = flatdb(...)`) that changes every call site.

## Decision

`db.close()` on the handle. A collection called `close` throws at definition time. Watchers that are
still starting are awaited before they are stopped, the adapter's optional `close()` runs last, and a
second call is a no-op. Collections stay usable afterwards; IndexedDB reopens lazily.

## Consequences

Existing code keeps `db.users`-style access unchanged. One reserved word, checked explicitly.
Test suites and long-lived apps can release watchers and connections deterministically.
