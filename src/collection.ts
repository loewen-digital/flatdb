import { nanoid } from 'nanoid'
import type { ZodType } from 'zod'
import type { StorageAdapter, CollectionOptions, QueryFilter, QueryOptions } from './types.js'
import { matchesFilter, applyOptions } from './query.js'

const INDEX_FILE = '_index.json'

export class Collection<T extends Record<string, any> = Record<string, any>> {
  private schema?: ZodType
  private options: CollectionOptions
  private indexCache: Record<string, T> | null = null

  constructor(
    private adapter: StorageAdapter,
    private name: string,
    schema?: ZodType,
    options: CollectionOptions = {},
  ) {
    this.schema = schema
    this.options = { mode: 'auto', unknownFields: 'strip', validateOnRead: true, ...options }
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

  async rebuildIndex(): Promise<void> {
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
      // Use safeParse to validate but keep extra fields
      const result = this.schema.safeParse(doc)
      if (!result.success) throw result.error
      return { ...doc, ...result.data } as T
    }
    // Default: strip unknown fields
    return this.schema.parse(doc) as T
  }

  // --- File helpers ---

  private docPath(id: string): string {
    return `${this.name}/${id}.json`
  }

  private async readDoc(id: string): Promise<T | null> {
    const raw = await this.adapter.read(this.docPath(id))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return this.validateRead(parsed)
  }

  private async writeDoc(id: string, doc: T): Promise<void> {
    await this.adapter.write(this.docPath(id), JSON.stringify(doc, null, 2))
  }

  // --- CRUD: Auto Mode ---

  async insert(doc: Record<string, any>): Promise<T & { _id: string }> {
    const validated = this.validateWrite(doc)
    const id = nanoid(8)
    await this.writeDoc(id, validated)

    const index = await this.loadIndex()
    index[id] = validated
    await this.saveIndex(index)

    return { _id: id, ...validated }
  }

  async insertMany(docs: Record<string, any>[]): Promise<(T & { _id: string })[]> {
    const results: (T & { _id: string })[] = []
    const index = await this.loadIndex()

    for (const doc of docs) {
      const validated = this.validateWrite(doc)
      const id = nanoid(8)
      await this.writeDoc(id, validated)
      index[id] = validated
      results.push({ _id: id, ...validated })
    }

    await this.saveIndex(index)
    return results
  }

  async findById(id: string): Promise<(T & { _id: string }) | null> {
    const index = await this.loadIndex()
    const entry = index[id]
    if (!entry) return null
    const validated = this.validateRead({ ...entry })
    return { _id: id, ...validated }
  }

  async findOne(filter: QueryFilter = {}): Promise<(T & { _id: string }) | null> {
    const index = await this.loadIndex()
    for (const [id, doc] of Object.entries(index)) {
      const withId = { _id: id, ...doc }
      if (matchesFilter(withId, filter)) {
        const validated = this.validateRead({ ...doc })
        return { _id: id, ...validated }
      }
    }
    return null
  }

  async find(filter: QueryFilter = {}, options: QueryOptions = {}): Promise<(T & { _id: string })[]> {
    const index = await this.loadIndex()
    let results: (T & { _id: string })[] = []

    for (const [id, doc] of Object.entries(index)) {
      const withId = { _id: id, ...doc }
      if (matchesFilter(withId, filter)) {
        const validated = this.validateRead({ ...doc })
        results.push({ _id: id, ...validated })
      }
    }

    return applyOptions(results, options)
  }

  async count(filter: QueryFilter = {}): Promise<number> {
    const index = await this.loadIndex()
    let count = 0
    for (const [id, doc] of Object.entries(index)) {
      const withId = { _id: id, ...doc }
      if (matchesFilter(withId, filter)) count++
    }
    return count
  }

  async update(filter: QueryFilter, changes: Record<string, any>): Promise<number> {
    const index = await this.loadIndex()
    let updated = 0

    // Extract $set if present, otherwise treat changes as direct merge
    const mergeData = changes.$set ?? changes

    for (const [id, doc] of Object.entries(index)) {
      const withId = { _id: id, ...doc }
      if (matchesFilter(withId, filter)) {
        const merged = deepMerge({ ...doc }, mergeData)
        const validated = this.validateWrite(merged)
        await this.writeDoc(id, validated)
        index[id] = validated
        updated++
      }
    }

    if (updated > 0) {
      await this.saveIndex(index)
    }
    return updated
  }

  async delete(filter: QueryFilter): Promise<number> {
    const index = await this.loadIndex()
    let deleted = 0

    for (const [id, doc] of Object.entries(index)) {
      const withId = { _id: id, ...doc }
      if (matchesFilter(withId, filter)) {
        await this.adapter.delete(this.docPath(id))
        delete index[id]
        deleted++
      }
    }

    if (deleted > 0) {
      await this.saveIndex(index)
    }
    return deleted
  }

  async deleteMany(filter: QueryFilter): Promise<number> {
    return this.delete(filter)
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
