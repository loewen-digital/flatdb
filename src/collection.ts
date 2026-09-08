import { nanoid } from 'nanoid'
import type { ZodType } from 'zod'
import type { StorageAdapter, CollectionOptions, QueryFilter, QueryOptions } from './types.js'
import { matchesFilter, applyOptions } from './query.js'
import { extractRefMeta, serializeRefs, deserializeRefs, populateDoc, type RefMeta, type RefResolver } from './ref.js'
import { EventEmitter } from './emitter.js'
import { liveQuery, watchQuery, type LiveErrorHandler } from './live.js'
import { deepMerge } from './merge.js'
import { IndexStore } from './index-store.js'

const INDEX_FILE = '_index.json'

export class Collection<T extends Record<string, any> = Record<string, any>> {
  private schema?: ZodType
  private options: CollectionOptions
  private index: IndexStore<T>
  private refMetas: RefMeta[]
  private emitter = new EventEmitter()

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

  private async writeDoc(id: string, doc: T): Promise<void> {
    const serialized = this.serializeDoc(doc)
    await this.adapter.write(this.docPath(id), JSON.stringify(serialized, null, 2))
  }

  // --- CRUD: Auto Mode ---

  async insert(doc: Record<string, any>): Promise<T & { _id: string }> {
    const validated = this.validateWrite(doc)
    const id = nanoid(8)
    await this.writeDoc(id, validated)

    const stored = this.serializeDoc(validated) as T
    await this.index.commit(index => { index[id] = stored })
    this.notify()

    return { _id: id, ...validated }
  }

  async insertMany(docs: Record<string, any>[]): Promise<(T & { _id: string })[]> {
    const results: (T & { _id: string })[] = []
    const stored: Record<string, T> = {}

    for (const doc of docs) {
      const validated = this.validateWrite(doc)
      const id = nanoid(8)
      await this.writeDoc(id, validated)
      stored[id] = this.serializeDoc(validated) as T
      results.push({ _id: id, ...validated })
    }

    await this.index.commit(index => Object.assign(index, stored))
    this.notify()
    return results
  }

  async findById(id: string, options?: QueryOptions): Promise<(T & { _id: string }) | null> {
    const index = await this.index.load()
    const entry = index[id]
    if (!entry) return null
    if (options?.populate && this._resolveRef) {
      // populate needs the stored "ref:" strings, so it works on the serialized entry
      return await populateDoc(
        { _id: id, ...this.validateRead(this.migrate({ ...entry })) },
        options.populate,
        this._resolveRef,
      ) as T & { _id: string }
    }
    return { _id: id, ...this.validateRead(this.readEntry(entry)) }
  }

  async findOne(filter: QueryFilter = {}): Promise<(T & { _id: string }) | null> {
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

  async find(filter: QueryFilter = {}, options: QueryOptions = {}): Promise<(T & { _id: string })[]> {
    const index = await this.index.load()
    let results: (T & { _id: string })[] = []

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
    const stored: Record<string, T> = {}

    const mergeData = changes.$set ?? changes

    for (const [id, rawDoc] of Object.entries(index)) {
      const doc = this.readEntry(rawDoc)
      const withId = { _id: id, ...doc }
      if (matchesFilter(withId, filter)) {
        const merged = deepMerge({ ...doc }, mergeData)
        const validated = this.validateWrite(merged)
        await this.writeDoc(id, validated)
        stored[id] = this.serializeDoc(validated) as T
      }
    }

    const updated = Object.keys(stored).length
    if (updated > 0) {
      await this.index.commit(current => Object.assign(current, stored))
      this.notify()
    }
    return updated
  }

  async delete(filter: QueryFilter): Promise<number> {
    const index = await this.index.load()
    const removed: string[] = []

    for (const [id, rawDoc] of Object.entries(index)) {
      const doc = this.readEntry(rawDoc)
      const withId = { _id: id, ...doc }
      if (matchesFilter(withId, filter)) {
        await this.adapter.delete(this.docPath(id))
        removed.push(id)
      }
    }

    if (removed.length > 0) {
      await this.index.commit(current => { for (const id of removed) delete current[id] })
      this.notify()
    }
    return removed.length
  }

  async deleteMany(filter: QueryFilter): Promise<number> {
    return this.delete(filter)
  }

  // --- Reactivity ---

  /**
   * Runs the query now and after every change. Errors from the query or the
   * callback go to `onError` (default: logged); the subscription stays alive.
   */
  live(filter: QueryFilter, cb: (results: (T & { _id: string })[]) => void, onError?: LiveErrorHandler): () => void
  live(cb: (results: (T & { _id: string })[]) => void, onError?: LiveErrorHandler): () => void
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

  liveById(id: string, cb: (doc: (T & { _id: string }) | null) => void, onError?: LiveErrorHandler): () => void {
    return liveQuery(this.emitter, () => this.findById(id), cb, onError)
  }

  /** Async iterator over the results; ends with the error when a query fails. */
  watch(filter: QueryFilter = {}): AsyncIterable<(T & { _id: string })[]> {
    return watchQuery(this.emitter, () => this.find(filter))
  }

}
