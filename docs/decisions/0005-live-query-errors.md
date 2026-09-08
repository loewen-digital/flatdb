# 0005 · Live query errors: callbacks stay subscribed and log by default, iterators end

## Context

`live()`, `liveById()`, `liveByPath()` and `watch()` re-run a query on every change with no error
path; a failing read became an unhandled rejection, fatal in Node 15+. Issue #5 left two choices
open: where the error goes, and whether the subscription survives it.

## Decision

Callback APIs take an optional `onError` after the callback. Without one the error is logged with
`console.error` and nothing else happens. Query errors and throwing callbacks both go there, and the
subscription stays alive, so one bad document does not silently freeze a UI. `watch()` rejects the
pending `next()` and ends: an async iterator has no side channel, and callers wrap `for await` in
try/catch anyway.

## Consequences

No unhandled rejections from the reactivity layer. A store or signal built on `live()` keeps its last
good value through an error. Consumers who want to stop on error do so inside `onError`.
