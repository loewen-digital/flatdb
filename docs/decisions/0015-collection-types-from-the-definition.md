# 0015 · `flatdb()` types each collection from its definition

## Context

`FlatDb<T>` typed every key as `Collection | PathCollection` with `Record<string, any>` documents, so fullstack's `createFlatdbAuthAdapter` needed `db.users as Collection` and the schema type never reached results. (#7)

## Decision

`collection(schema, options)` returns `CollectionDefinition<S, M>`, carrying the schema and the mode; `FlatDb` maps `M = 'path'` to `PathCollection<DocumentOf<S>>` and everything else to `Collection<DocumentOf<S>>`. `DocumentOf` is the schema's output type, `Record<string, any>` without a schema or for a non-object one. The return type wraps both in `NoInfer`: inside the object literal of `flatdb()`, TypeScript would otherwise infer the mode from the wide constraint and give the union again. A definition with an unknown mode still types as the union. Deviation from the proposal: no `O extends CollectionOptions` parameter, the mode alone is enough. Types only, no runtime change.

Two findings on the way: `live(cb, onError)` left `cb`'s parameter untyped because the filter overload came first; the callback overload now comes first. `test/` is now linted and type-checked (decision 0011 deferred that to #7); `test/types.test-d.ts` asserts the types.

## Consequences

- Consumers need TypeScript 5.4 or newer (`NoInfer`).
- A `populate`d ref is still typed as the stored ID; populating callers cast.
- The framework adapters still take the document type as an explicit type argument.
