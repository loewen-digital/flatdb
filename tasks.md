# FlatDB Tasks

Open issues and improvements identified during project review.

---

## 1. Expose `flatdb()` watch unwatchers for cleanup

**Priority:** Medium
**Type:** Enhancement
**File:** `src/flatdb.ts:38`

The `flatdb()` function creates an `unwatchers` array when `watch: true` is passed, but the array is never returned or exposed. Users have no way to stop the filesystem watchers, which can cause resource leaks.

**Suggested fix:** Return a `close()` or `unwatch()` function alongside the collection map, e.g.:
```ts
return Object.assign(result, {
  close() { unwatchers.forEach(fn => fn()) }
})
```

---

## 2. Unhandled promise rejections in `live()`, `liveById()`, `liveByPath()`

**Priority:** Medium
**Type:** Bug
**Files:**
- `src/collection.ts:273` — `Collection.live()`
- `src/collection.ts:284` — `Collection.liveById()`
- `src/path-collection.ts:367` — `PathCollection.live()`
- `src/path-collection.ts:377` — `PathCollection.liveByPath()`

The pattern `.then(results => cb(results))` has no `.catch()`. If `find()` or `get()` rejects (corrupted JSON, schema validation error), the promise rejection goes unhandled.

**Suggested fix:** Add `.catch()` handlers, or accept an optional error callback.

---

## 3. Duplicated `deepMerge` utility

**Priority:** Low
**Type:** Refactor
**Files:**
- `src/collection.ts:342`
- `src/path-collection.ts:451`

`deepMerge()` is identically defined in both files. Extract to a shared module (e.g. `src/utils.ts`) to reduce duplication.

---

## 4. `migrate()` option has no test coverage

**Priority:** Low
**Type:** Testing
**File:** `src/types.ts:23`

The `migrate` option in `CollectionOptions` is implemented in both `Collection.validateRead()` and `PathCollection.validateRead()`, but there are zero tests covering this functionality.

**Suggested fix:** Add tests that define a collection with a `migrate` function and verify old documents are transformed on read.

---

## 5. No `close()` API on `flatdb()` return value

**Priority:** Low
**Type:** Enhancement
**File:** `src/flatdb.ts`

The object returned by `flatdb()` provides no way to close the underlying `StorageAdapter`. This matters for `IndexedDBAdapter` which holds an open database connection and has a `close()` method. Long-lived apps or tests that create many `flatdb()` instances may leak connections.

**Suggested fix:** Combine with task #1 — add a `close()` method that stops watchers _and_ calls `adapter.close()` if available.
