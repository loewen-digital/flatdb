# 0002 · `R2BucketLike` mirrors the real binding: `head` required, `list` with delimiter

## Context

The proposal in #1 made `head` optional with a `get` fallback and listed whole subtrees to derive
direct children client-side. Every real `R2Bucket` has `head`, and R2's `list` accepts `delimiter`
and returns `delimitedPrefixes`, which is exactly "direct children" without paging through nested objects.

## Decision

`R2BucketLike` requires `head`, `get`, `put`, `delete`, `list`; list options include `delimiter`, results
include `delimitedPrefixes`. `exists` is one `head` plus, on a miss, one single-object `list`. `list(dir)`
asks for `prefix: dir/` with `delimiter: '/'` and follows `cursor`. Verified against
`@cloudflare/workers-types` (assignability) and miniflare's R2 (behaviour, listing across 1005 keys).

## Consequences

Listing cost scales with direct children, not subtree size. Test fakes must implement delimiter
semantics; `test/fake-r2-bucket.ts` does.
