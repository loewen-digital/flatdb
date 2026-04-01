import { nanoid } from 'nanoid'
import type { ZodType } from 'zod'
import type { StorageAdapter, CollectionOptions, QueryFilter, QueryOptions } from './types.js'
import { matchesFilter, applyOptions } from './query.js'
import { extractRefMeta, serializeRefs, deserializeRefs, populateDoc, type RefMeta, type RefResolver } from './ref.js'
import { EventEmitter } from './emitter.js'

const INDEX_FILE = '_index.json'

export class Collection<T extends Record<string, any> = Record<string, any>> {
  private schema?: ZodType
  private options: CollectionOptions
  private indexCache: Record<string, T> | null = null
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
  }

  private notify(): void {
    this._onChange?.()
    this.emitter.emit()
  }

  // --- Index management ---

  private indexPath(): string {
    return `${this.name}/${INDEX_FILE}`
  }

  private async loadIndex(): Promise<Record<string, T>> {
    if (this.indexCache) return this.indexCache
    const raw = await this.adapter.read(this.indexPath())
    this.indexCache = raw ? JSON.parse(raw) : {}
    return this.indexCache!
  }

  private async saveIndex(index: Record<string, T>): Promise<void> {
    this.indexCache = index
    await this.adapter.write(this.indexPath(), JSON.stringify(index, null, 2))
  }

  /** @internal */
  invalidateCache(): void {
    this.indexCache = null
  }

  async rebuildIndex(): Promise<void> {
    this.indexCache = null
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
    await this.saveIndex(index)
  }

  // --- Validation ---

  private validateWrite(doc: Record<string, any>): T {
    if (!this.schema) return doc as T
    return this.schema.parse(doc) as T
  }

  private validateRead(doc: Record<string, any>): T {
    if (!this.schema || !this.options.validateOnRead) return doc as T

    if (this.options.migrate) {
      doc = this.options.migrate(doc)
    }

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

    const index = await this.loadIndex()
    index[id] = this.serializeDoc(validated) as T
    await this.saveIndex(index)
    this.notify()

    return { _id: id, ...validated }
  }

  async insertMany(docs: Record<string, any>[]): Promise<(T & { _id: string })[]> {
    const results: (T & { _id: string })[] = []
    const index = await this.loadIndex()

    for (const doc of docs) {
      const validated = this.validateWrite(doc)
      const id = nanoid(8)
      await this.writeDoc(id, validated)
      index[id] = this.serializeDoc(validated) as T
      results.push({ _id: id, ...validated })
    }

    await this.saveIndex(index)
    this.notify()
    return results
  }

  async findById(id: string, options?: QueryOptions): Promise<(T & { _id: string }) | null> {
    const index = await this.loadIndex()
    const entry = index[id]
    if (!entry) return null
    let doc = this.deserializeDoc({ ...entry })
    const validated = this.validateRead(doc)
    let result = { _id: id, ...validated }
    if (options?.populate && this._resolveRef) {
      result = await populateDoc(
        { _id: id, ...this.validateRead({ ...entry }) },
        options.populate,
        this._resolveRef,
      ) as T & { _id: string }
    }
    return result
  }

  async findOne(filter: QueryFilter = {}): Promise<(T & { _id: string }) | null> {
    const index = await this.loadIndex()
    for (const [id, rawDoc] of Object.entries(index)) {
      const doc = this.deserializeDoc({ ...rawDoc })
      const withId = { _id: id, ...doc }
      if (matchesFilter(withId, filter)) {
        const validated = this.validateRead(doc)
        return { _id: id, ...validated }
      }
    }
    return null
  }

  async find(filter: QueryFilter = {}, options: QueryOptions = {}): Promise<(T & { _id: string })[]> {
    const index = await this.loadIndex()
    let results: (T & { _id: string })[] = []

    for (const [id, rawDoc] of Object.entries(index)) {
      const doc = this.deserializeDoc({ ...rawDoc })
      const withId = { _id: id, ...doc }
      if (matchesFilter(withId, filter)) {
        const validated = this.validateRead(doc)
        results.push({ _id: id, ...validated })
      }
    }

    return applyOptions(results, options)
  }

  async count(filter: QueryFilter = {}): Promise<number> {
    const index = await this.loadIndex()
    let count = 0
    for (const [id, rawDoc] of Object.entries(index)) {
      const doc = this.deserializeDoc({ ...rawDoc })
      const withId = { _id: id, ...doc }
      if (matchesFilter(withId, filter)) count++
    }
    return count
  }

  async update(filter: QueryFilter, changes: Record<string, any>): Promise<number> {
    const index = await this.loadIndex()
    let updated = 0

    const mergeData = changes.$set ?? changes

    for (const [id, rawDoc] of Object.entries(index)) {
      const doc = this.deserializeDoc({ ...rawDoc })
      const withId = { _id: id, ...doc }
      if (matchesFilter(withId, filter)) {
        const merged = deepMerge({ ...doc }, mergeData)
        const validated = this.validateWrite(merged)
        await this.writeDoc(id, validated)
        index[id] = this.serializeDoc(validated) as T
        updated++
      }
    }

    if (updated > 0) {
      await this.saveIndex(index)
      this.notify()
    }
    return updated
  }

  async delete(filter: QueryFilter): Promise<number> {
    const index = await this.loadIndex()
    let deleted = 0

    for (const [id, rawDoc] of Object.entries(index)) {
      const doc = this.deserializeDoc({ ...rawDoc })
      const withId = { _id: id, ...doc }
      if (matchesFilter(withId, filter)) {
        await this.adapter.delete(this.docPath(id))
        delete index[id]
        deleted++
      }
    }

    if (deleted > 0) {
      await this.saveIndex(index)
      this.notify()
    }
    return deleted
  }

  async deleteMany(filter: QueryFilter): Promise<number> {
    return this.delete(filter)
  }

  // --- Reactivity ---

  live(filter: QueryFilter, cb: (results: (T & { _id: string })[]) => void): () => void
  live(cb: (results: (T & { _id: string })[]) => void): () => void
  live(
    filterOrCb: QueryFilter | ((results: (T & { _id: string })[]) => void),
    maybeCb?: (results: (T & { _id: string })[]) => void,
  ): () => void {
    const filter = typeof filterOrCb === 'function' ? {} : filterOrCb
    const cb =
      (typeof filterOrCb === 'function' ? filterOrCb : maybeCb!) as (results: (T & { _id: string })[]) => void

    // Initial query
    this.find(filter).then(results => cb(results))

    // Re-query on every change
    const unsub = this.emitter.subscribe(() => {
      this.find(filter).then(results => cb(results))
    })

    return unsub
  }

  liveById(id: string, cb: (doc: (T & { _id: string }) | null) => void): () => void {
    this.findById(id).then(cb)

    const unsub = this.emitter.subscribe(() => {
      this.findById(id).then(cb)
    })

    return unsub
  }

  watch(filter: QueryFilter = {}): AsyncIterable<(T & { _id: string })[]> {
    type Result = (T & { _id: string })[]
    type Resolve = (value: IteratorResult<Result>) => void
    const self = this
    return {
      [Symbol.asyncIterator]() {
        let resolve: Resolve | null = null
        let done = false

        const unsub = self.emitter.subscribe(() => {
          if (resolve) {
            const r = resolve
            resolve = null
            self.find(filter).then(results => {
              r({ value: results, done: false })
            })
          }
        })

        const initialPromise = new Promise<IteratorResult<Result>>(r => {
          self.find(filter).then(results => {
            r({ value: results, done: false })
          })
        })

        let firstCall = true

        return {
          next() {
            if (done) return Promise.resolve({ value: undefined as any, done: true as const })
            if (firstCall) {
              firstCall = false
              return initialPromise
            }
            return new Promise<IteratorResult<Result>>(r => {
              resolve = r
            })
          },
          return() {
            done = true
            unsub()
            return Promise.resolve({ value: undefined as any, done: true as const })
          },
        }
      },
    }
  }
}

function deepMerge(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
  for (const key of Object.keys(source)) {
    const sv = source[key]
    const tv = target[key]
    if (sv && typeof sv === 'object' && !Array.isArray(sv) && tv && typeof tv === 'object' && !Array.isArray(tv)) {
      target[key] = deepMerge({ ...tv }, sv)
    } else {
      target[key] = sv
    }
  }
  return target
}
