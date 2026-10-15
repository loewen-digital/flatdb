import { nanoid } from 'nanoid'
import type { ZodType } from 'zod'
import type { StorageAdapter, CollectionOptions, QueryFilter, QueryOptions } from './types.js'
import { matchesFilter, applyOptions, getNestedValue } from './query.js'
import {
  extractRefMeta,
  serializeRefs,
  deserializeRefs,
  populateDoc,
  type RefMeta,
  type RefResolver,
} from './ref.js'
import { EventEmitter } from './emitter.js'
import { liveQuery, watchQuery, type LiveErrorHandler } from './live.js'
import { deepMerge } from './merge.js'
import { IndexStore } from './index-store.js'
import { assertUnique, keyOf, lookupName, UniqueConstraintError } from './unique.js'

const INDEX_FILE = '_index.json'
const UNIQUE_DIR = '_unique'
const READY_FILE = '_ready.json'
/** The characters nanoid uses; a caller-supplied `_id` must stick to them. */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export class Collection<T extends Record<string, any> = Record<string, any>> {
  private schema?: ZodType
  private options: CollectionOptions
  private index: IndexStore<T>
  private unique: string[]
  private refMetas: RefMeta[]
  private emitter = new EventEmitter()
  /** Unique fields whose lookup objects are known to be complete (see `isReady`). */
  private readyFields = new Set<string>()

  _onChange: (() => void) | null = null
  _resolveRef: RefResolver | null = null

  constructor(
    private adapter: StorageAdapter,
    private name: string,
    schema?: ZodType,
    options: CollectionOptions = {},
  ) {
    this.schema = schema
    this.options = { mode: 'auto', unknownFields: 'strip', validateOnRead: true, ...options }
    this.unique = options.unique ?? []
    this.refMetas = schema ? extractRefMeta(schema) : []
    this.index = new IndexStore<T>(adapter, `${name}/${INDEX_FILE}`)
  }

  private notify(): void {
    this._onChange?.()
    this.emitter.emit()
  }

  // --- Index management ---

  /** @internal Forget the cached index; the next access reads it again. */
  invalidateCache(): void {
    this.index.invalidate()
  }

  async rebuildIndex(): Promise<void> {
    this.index.invalidate()
    const entries = await this.adapter.list(this.name)
    const index: Record<string, T> = {}
    for (const entry of entries) {
      if (entry === INDEX_FILE || !entry.endsWith('.json')) continue
      const id = entry.replace(/\.json$/, '')
      const raw = await this.adapter.read(`${this.name}/${entry}`)
      if (raw) {
        index[id] = JSON.parse(raw)
      }
    }
    await this.index.replace(index)

    if (this.keepsLookups) {
      for (const [id, entry] of Object.entries(index)) {
        await this.writeLookups(id, this.readEntry(entry))
      }
      await this.markReady()
    }
  }

  // --- Validation ---

  private validateWrite(doc: Record<string, any>): T {
    if (!this.schema) return doc as T
    return this.schema.parse(doc) as T
  }

  private validateRead(doc: Record<string, any>): T {
    if (!this.schema || !this.options.validateOnRead) return doc as T
    if (this.options.unknownFields === 'error') {
      return this.schema.parse(doc) as T
    }
    if (this.options.unknownFields === 'passthrough') {
      const result = this.schema.safeParse(doc)
      if (!result.success) throw result.error
      return { ...doc, ...result.data } as T
    }
    return this.schema.parse(doc) as T
  }

  // --- Ref helpers ---

  private serializeDoc(doc: Record<string, any>): Record<string, any> {
    if (this.refMetas.length === 0) return doc
    return serializeRefs(doc, this.refMetas)
  }

  private deserializeDoc(doc: Record<string, any>): Record<string, any> {
    return deserializeRefs(doc)
  }

  private migrate(doc: Record<string, any>): Record<string, any> {
    return this.options.migrate ? this.options.migrate(doc) : doc
  }

  /** Index entry → document as the application sees it: refs deserialized, migration applied. */
  private readEntry(entry: Record<string, any>): Record<string, any> {
    return this.migrate(this.deserializeDoc({ ...entry }))
  }

  // --- File helpers ---

  private docPath(id: string): string {
    return `${this.name}/${id}.json`
  }

  /** Stored form of one document, read from its file instead of the index. */
  private async readStored(id: string): Promise<Record<string, any> | null> {
    const raw = await this.adapter.read(this.docPath(id))
    return raw ? JSON.parse(raw) : null
  }

  /** Read single objects instead of the whole index: remote adapter, index not cached. */
  private get pointRead(): boolean {
    return this.adapter.pointReads === true && !this.index.cached
  }

  // --- Lookup objects for unique fields (adapters with `pointReads`) ---
  //
  // `<collection>/_unique/<field>/<sha256(value)>.json` holds `{ id }`. The index stays the
  // authority on uniqueness; lookups are written after it and checked against the document
  // on every read, so a stale one is harmless. `_unique/_ready.json` lists the fields whose
  // lookups are complete: only for those does a missing lookup mean "no such document".

  private get keepsLookups(): boolean {
    return this.adapter.pointReads === true && this.unique.length > 0
  }

  private async lookupPath(field: string, key: string): Promise<string> {
    const name = await lookupName(key)
    return `${this.name}/${UNIQUE_DIR}/${encodeURIComponent(field)}/${name}.json`
  }

  private get readyPath(): string {
    return `${this.name}/${UNIQUE_DIR}/${READY_FILE}`
  }

  /** Points the lookups for `doc`'s unique values at `id`. */
  private async writeLookups(id: string, doc: Record<string, any>): Promise<void> {
    for (const field of this.unique) {
      const key = keyOf(doc, field)
      if (key === undefined) continue
      await this.adapter.write(await this.lookupPath(field, key), JSON.stringify({ id }))
    }
  }

  /** Removes the lookup for `key` unless another document has taken it over meanwhile. */
  private async dropLookup(field: string, key: string, id: string): Promise<void> {
    const path = await this.lookupPath(field, key)
    const raw = await this.adapter.read(path)
    if (raw && JSON.parse(raw).id === id) await this.adapter.delete(path)
  }

  private async markReady(): Promise<void> {
    await this.adapter.write(this.readyPath, JSON.stringify({ fields: this.unique }))
    for (const field of this.unique) this.readyFields.add(field)
  }

  /** Whether the lookups of `field` are complete, so a missing one means no document. */
  private async isReady(field: string): Promise<boolean> {
    if (this.readyFields.has(field)) return true
    const raw = await this.adapter.read(this.readyPath)
    const fields: unknown = raw ? JSON.parse(raw).fields : undefined
    if (Array.isArray(fields)) for (const f of fields) this.readyFields.add(f)
    return this.readyFields.has(field)
  }

  /** `{ field: value }` or `{ field: { $eq: value } }` on a unique field with a primitive value. */
  private lookupTarget(filter: QueryFilter): { field: string; value: unknown } | null {
    const keys = Object.keys(filter)
    if (keys.length !== 1 || !this.unique.includes(keys[0])) return null
    const field = keys[0]
    let value = filter[field]
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const operators = Object.keys(value)
      if (operators.length !== 1 || operators[0] !== '$eq') return null
      value = value.$eq
    }
    if (!['string', 'number', 'boolean'].includes(typeof value)) return null
    return { field, value }
  }

  /**
   * value → lookup → document. `undefined` when the lookups cannot answer (not complete for
   * this field yet), so the caller falls back to the index.
   */
  private async findByLookup(
    field: string,
    value: unknown,
  ): Promise<(T & { _id: string }) | null | undefined> {
    const raw = await this.adapter.read(await this.lookupPath(field, JSON.stringify(value)))
    const id: unknown = raw ? JSON.parse(raw).id : undefined
    if (typeof id === 'string' && ID_PATTERN.test(id)) {
      const entry = await this.readStored(id)
      if (entry) {
        const doc = this.readEntry(entry)
        if (getNestedValue(doc, field) === value) return { _id: id, ...this.validateRead(doc) }
      }
    }
    return (await this.isReady(field)) ? null : undefined
  }

  private async writeDoc(id: string, doc: T): Promise<void> {
    const serialized = this.serializeDoc(doc)
    await this.adapter.write(this.docPath(id), JSON.stringify(serialized, null, 2))
  }

  /**
   * Persists documents and their index entries.
   *
   * Without unique fields the files go first: a crash in between leaves a
   * document that `rebuildIndex()` picks up. With unique fields the index goes
   * first: check and entry are one compare-and-swap, so of two concurrent writers
   * only one gets through, and the one that lost has written no file. Caller-supplied
   * IDs take the same path: an ID that exists already must be refused before its file
   * is overwritten.
   */
  private async save(docs: Record<string, T>, created: boolean, ownIds = false): Promise<void> {
    const stored: Record<string, T> = {}
    for (const [id, doc] of Object.entries(docs)) stored[id] = this.serializeDoc(doc) as T
    const writeDocs = async () => {
      for (const [id, doc] of Object.entries(docs)) await this.writeDoc(id, doc)
    }

    if (this.unique.length === 0 && !ownIds) {
      await writeDocs()
      await this.index.commit((index) => Object.assign(index, stored))
      return
    }

    let previous: Record<string, T> = {}
    let wasEmpty = false
    await this.index.commit((index) => {
      if (created) {
        for (const id of Object.keys(stored)) {
          if (Object.hasOwn(index, id)) throw new UniqueConstraintError(this.name, '_id', id)
        }
      }
      assertUnique(this.name, this.unique, index, stored, (entry) => this.migrate({ ...entry }))
      previous = {}
      for (const id of Object.keys(stored)) {
        if (Object.hasOwn(index, id)) previous[id] = index[id]
      }
      wasEmpty = Object.keys(index).length === 0
      Object.assign(index, stored)
    })
    try {
      await writeDocs()
    } catch (err) {
      // A new document without its file must not keep its unique values taken
      if (created) {
        await this.index
          .commit((index) => {
            for (const id of Object.keys(stored)) delete index[id]
          })
          .catch(() => {})
      }
      throw err
    }

    if (this.keepsLookups) {
      for (const [id, doc] of Object.entries(docs)) {
        await this.writeLookups(id, doc)
        if (!previous[id]) continue
        const before = this.readEntry(previous[id])
        for (const field of this.unique) {
          const old = keyOf(before, field)
          if (old !== undefined && old !== keyOf(doc, field)) await this.dropLookup(field, old, id)
        }
      }
      // A collection that starts out with lookups has them complete from its first document
      if (wasEmpty) await this.markReady()
    }
  }

  /** Splits a caller-supplied `_id` off the document and checks it. */
  private takeId(doc: Record<string, any>): { id: string | undefined; rest: Record<string, any> } {
    const { _id, ...rest } = doc
    if (_id === undefined) return { id: undefined, rest }
    if (typeof _id !== 'string' || !ID_PATTERN.test(_id)) {
      throw new Error(`${this.name}: _id must be 1 to 128 characters of A-Z, a-z, 0-9, "_" and "-"`)
    }
    return { id: _id, rest }
  }

  // --- CRUD: Auto Mode ---

  /** Stores a new document. A given `_id` is used as its ID (nanoid's characters, at most 128). */
  async insert(doc: Record<string, any>): Promise<T & { _id: string }> {
    const { id: own, rest } = this.takeId(doc)
    const validated = this.validateWrite(rest)
    const id = own ?? nanoid(8)
    await this.save({ [id]: validated }, true, own !== undefined)
    this.notify()

    return { _id: id, ...validated }
  }

  async insertMany(docs: Record<string, any>[]): Promise<(T & { _id: string })[]> {
    const results: (T & { _id: string })[] = []
    const validated: Record<string, T> = {}
    let ownIds = false

    for (const doc of docs) {
      const { id: own, rest } = this.takeId(doc)
      if (own !== undefined) {
        if (Object.hasOwn(validated, own)) throw new UniqueConstraintError(this.name, '_id', own)
        ownIds = true
      }
      const id = own ?? nanoid(8)
      validated[id] = this.validateWrite(rest)
      results.push({ _id: id, ...validated[id] })
    }

    await this.save(validated, true, ownIds)
    this.notify()
    return results
  }

  async findById(id: string, options?: QueryOptions): Promise<(T & { _id: string }) | null> {
    let entry: Record<string, any> | null | undefined
    if (this.pointRead) {
      // The ID becomes part of a key here, so only IDs that insert could have assigned
      if (!ID_PATTERN.test(id)) return null
      entry = await this.readStored(id)
    } else {
      const index = await this.index.load()
      entry = Object.hasOwn(index, id) ? index[id] : undefined
    }
    if (!entry) return null
    if (options?.populate && this._resolveRef) {
      // populate needs the stored "ref:" strings, so it works on the serialized entry
      return (await populateDoc(
        { _id: id, ...this.validateRead(this.migrate({ ...entry })) },
        options.populate,
        this._resolveRef,
      )) as T & { _id: string }
    }
    return { _id: id, ...this.validateRead(this.readEntry(entry)) }
  }

  async findOne(filter: QueryFilter = {}): Promise<(T & { _id: string }) | null> {
    const target = this.keepsLookups && this.pointRead ? this.lookupTarget(filter) : null
    if (target) {
      const found = await this.findByLookup(target.field, target.value)
      if (found !== undefined) return found
    }

    const index = await this.index.load()
    for (const [id, rawDoc] of Object.entries(index)) {
      const doc = this.readEntry(rawDoc)
      const withId = { _id: id, ...doc }
      if (matchesFilter(withId, filter)) {
        const validated = this.validateRead(doc)
        return { _id: id, ...validated }
      }
    }
    return null
  }

  async find(
    filter: QueryFilter = {},
    options: QueryOptions = {},
  ): Promise<(T & { _id: string })[]> {
    const index = await this.index.load()
    const results: (T & { _id: string })[] = []

    for (const [id, rawDoc] of Object.entries(index)) {
      const doc = this.readEntry(rawDoc)
      const withId = { _id: id, ...doc }
      if (matchesFilter(withId, filter)) {
        const validated = this.validateRead(doc)
        results.push({ _id: id, ...validated })
      }
    }

    return applyOptions(results, options)
  }

  async count(filter: QueryFilter = {}): Promise<number> {
    const index = await this.index.load()
    let count = 0
    for (const [id, rawDoc] of Object.entries(index)) {
      const doc = this.readEntry(rawDoc)
      const withId = { _id: id, ...doc }
      if (matchesFilter(withId, filter)) count++
    }
    return count
  }

  async update(filter: QueryFilter, changes: Record<string, any>): Promise<number> {
    const index = await this.index.load()
    const changed: Record<string, T> = {}

    const mergeData = changes.$set ?? changes

    for (const [id, rawDoc] of Object.entries(index)) {
      const doc = this.readEntry(rawDoc)
      const withId = { _id: id, ...doc }
      if (matchesFilter(withId, filter)) {
        const merged = deepMerge({ ...doc }, mergeData)
        changed[id] = this.validateWrite(merged)
      }
    }

    const updated = Object.keys(changed).length
    if (updated > 0) {
      await this.save(changed, false)
      this.notify()
    }
    return updated
  }

  async delete(filter: QueryFilter): Promise<number> {
    const index = await this.index.load()
    const removed: Record<string, Record<string, any>> = {}

    for (const [id, rawDoc] of Object.entries(index)) {
      const doc = this.readEntry(rawDoc)
      const withId = { _id: id, ...doc }
      if (matchesFilter(withId, filter)) {
        await this.adapter.delete(this.docPath(id))
        removed[id] = doc
      }
    }

    const ids = Object.keys(removed)
    if (ids.length > 0) {
      await this.index.commit((current) => {
        for (const id of ids) delete current[id]
      })
      if (this.keepsLookups) {
        for (const [id, doc] of Object.entries(removed)) {
          for (const field of this.unique) {
            const key = keyOf(doc, field)
            if (key !== undefined) await this.dropLookup(field, key, id)
          }
        }
      }
      this.notify()
    }
    return ids.length
  }

  async deleteMany(filter: QueryFilter): Promise<number> {
    return this.delete(filter)
  }

  // --- Reactivity ---

  /**
   * Runs the query now and after every change. Errors from the query or the
   * callback go to `onError` (default: logged); the subscription stays alive.
   */
  live(cb: (results: (T & { _id: string })[]) => void, onError?: LiveErrorHandler): () => void
  live(
    filter: QueryFilter,
    cb: (results: (T & { _id: string })[]) => void,
    onError?: LiveErrorHandler,
  ): () => void
  live(
    filterOrCb: QueryFilter | ((results: (T & { _id: string })[]) => void),
    cbOrOnError?: ((results: (T & { _id: string })[]) => void) | LiveErrorHandler,
    maybeOnError?: LiveErrorHandler,
  ): () => void {
    const byCallback = typeof filterOrCb === 'function'
    const filter = byCallback ? {} : filterOrCb
    const cb = (byCallback ? filterOrCb : cbOrOnError) as (results: (T & { _id: string })[]) => void
    const onError = (byCallback ? cbOrOnError : maybeOnError) as LiveErrorHandler | undefined
    return liveQuery(this.emitter, () => this.find(filter), cb, onError)
  }

  liveById(
    id: string,
    cb: (doc: (T & { _id: string }) | null) => void,
    onError?: LiveErrorHandler,
  ): () => void {
    return liveQuery(this.emitter, () => this.findById(id), cb, onError)
  }

  /** Async iterator over the results; ends with the error when a query fails. */
  watch(filter: QueryFilter = {}): AsyncIterable<(T & { _id: string })[]> {
    return watchQuery(this.emitter, () => this.find(filter))
  }
}
