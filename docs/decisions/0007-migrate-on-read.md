# 0007 · `migrate` runs on every read, before filters, and never writes back

## Context

The design doc promised lazy migration "applied on read + written back". The code ran `migrate`
only inside validation, so never without a schema or with `validateOnRead: false`, and only after
filter matching, so `find({ status: 'done' })` missed a document stored as `done: true`. Issue #6
asked for tests; writing them exposed the gap.

## Decision

`migrate` runs whenever it is defined, on every index entry, before filters and before validation.
Reads do not write: a migrated document reaches storage on its next `update`, which merges into the
migrated shape. No background rewrite.

## Consequences

Queries and results agree on the new shape. `rebuildIndex()` still copies files as they are, so
`migrate` stays necessary until every document has been written once; a one-off script can force
that with `update`. Cost: `migrate` runs per entry per query, so keep it cheap and pure.
