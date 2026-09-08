import type { ZodType } from 'zod'
import type { StorageAdapter, CollectionOptions, QueryFilter, QueryOptions } from './types.js'
import { matchesFilter, applyOptions } from './query.js'
import { EventEmitter } from './emitter.js'
import { liveQuery, watchQuery, type LiveErrorHandler } from './live.js'
import { deepMerge } from './merge.js'
import { IndexStore } from './index-store.js'

const INDEX_FILE = '_index.json'

export interface TreeNode {
  path: string
  doc: Record<string, any> | null
  children: TreeNode[]
}

export class PathCollection<T extends Record<string, any> = Record<string, any>> {
  private schema?: ZodType
  private options: CollectionOptions
  private index: IndexStore<T>
  private emitter = new EventEmitter()

  constructor(
    private adapter: StorageAdapter,
    private name: string,
    schema?: ZodType,
    options: CollectionOptions = {},
  ) {
    this.schema = schema
    this.options = { mode: 'path', unknownFields: 'strip', validateOnRead: true, ...options }
    this.index = new IndexStore<T>(adapter, `${name}/${INDEX_FILE}`)
  }

  // --- Index management ---

  /** @internal Forget the cached index; the next access reads it again. */
  invalidateCache(): void {
    this.index.invalidate()
  }

  async rebuildIndex(): Promise<void> {
    const index: Record<string, T> = {}
    await this.scanDir('', index)
    await this.index.replace(index)
  }

  private async scanDir(dir: string, index: Record<string, T>): Promise<void> {
    const fullDir = dir ? `${this.name}/${dir}` : this.name
    const entries = await this.adapter.list(fullDir)

    for (const entry of entries) {
      if (entry === INDEX_FILE) continue
      const relativePath = dir ? `${dir}/${entry}` : entry
      const fullPath = `${this.name}/${relativePath}`

      if (entry.endsWith('.json')) {
        const docPath = entry === 'index.json'
          ? dir // index.json → the directory itself is the path
          : relativePath.replace(/\.json$/, '')
        const raw = await this.adapter.read(fullPath)
        if (raw) {
          index[docPath] = JSON.parse(raw)
        }
      } else {
        // Could be a directory — try to list it
        await this.scanDir(relativePath, index)
      }
    }
  }

  // --- Validation ---

  private validateWrite(doc: Record<string, any>): T {
    if (!this.schema) return doc as T
    return this.schema.parse(doc) as T
  }

  /** Index entry → document as the application sees it, with migration applied. */
  private readEntry(entry: Record<string, any>): Record<string, any> {
    const doc = { ...entry }
    return this.options.migrate ? this.options.migrate(doc) : doc
  }

  private validateRead(doc: Record<string, any>): T {
    if (!this.schema || !this.options.validateOnRead) return doc as T
    if (this.options.unknownFields === 'passthrough') {
      const result = this.schema.safeParse(doc)
      if (!result.success) throw result.error
      return { ...doc, ...result.data } as T
    }
    return this.schema.parse(doc) as T
  }

  // --- File helpers ---

  private docFilePath(docPath: string): string {
    if (docPath === '') return `${this.name}/index.json`
    return `${this.name}/${docPath}.json`
  }

  private docIndexFilePath(docPath: string): string {
    return `${this.name}/${docPath}/index.json`
  }

  // --- Notify (for reactivity, injected later) ---

  _onChange: (() => void) | null = null

  private notify(): void {
    this._onChange?.()
    this.emitter.emit()
  }

  // --- CRUD: Path Mode ---

  async insert(path: string, doc: Record<string, any>): Promise<T> {
    const validated = this.validateWrite(doc)
    const filePath = this.docFilePath(path)
    await this.adapter.write(filePath, JSON.stringify(validated, null, 2))

    await this.index.commit(index => { index[path] = validated })
    this.notify()

    return validated
  }

  async get(path: string, options?: QueryOptions): Promise<T | null> {
    const index = await this.index.load()
    const entry = index[path]
    if (!entry) return null
    let validated = this.validateRead(this.readEntry(entry))
    if (options?.populate) {
      validated = await this.populateDoc(validated, options.populate)
    }
    return validated
  }

  async find(filter: QueryFilter = {}, options: QueryOptions = {}): Promise<T[]> {
    const index = await this.index.load()
    let results: T[] = []
    const pathPattern = filter.$path as string | undefined

    for (const [docPath, entry] of Object.entries(index)) {
      if (pathPattern && !matchPathPattern(docPath, pathPattern)) continue
      const doc = this.readEntry(entry)
      if (matchesFilter(doc, filter)) {
        results.push(this.validateRead(doc))
      }
    }

    return applyOptions(results, options)
  }

  async findOne(filter: QueryFilter = {}): Promise<T | null> {
    const results = await this.find(filter, { limit: 1 })
    return results[0] ?? null
  }

  async count(filter: QueryFilter = {}): Promise<number> {
    const index = await this.index.load()
    let count = 0
    const pathPattern = filter.$path as string | undefined

    for (const [docPath, entry] of Object.entries(index)) {
      if (pathPattern && !matchPathPattern(docPath, pathPattern)) continue
      if (matchesFilter(this.readEntry(entry), filter)) count++
    }
    return count
  }

  async update(path: string, changes: Record<string, any>): Promise<T> {
    const index = await this.index.load()
    const existing = index[path]
    if (!existing) throw new Error(`Document not found: ${path}`)

    const merged = deepMerge(this.readEntry(existing), changes)
    const validated = this.validateWrite(merged)

    // Write to wherever the doc actually lives (file or index.json)
    const isNode = await this.adapter.exists(this.docIndexFilePath(path))
    const filePath = isNode ? this.docIndexFilePath(path) : this.docFilePath(path)
    await this.adapter.write(filePath, JSON.stringify(validated, null, 2))

    await this.index.commit(current => { current[path] = validated })
    this.notify()

    return validated
  }

  async delete(path: string, options?: { recursive?: boolean }): Promise<void> {
    const index = await this.index.load()
    const removed = options?.recursive
      ? Object.keys(index).filter(p => p === path || p.startsWith(path + '/'))
      : [path]

    for (const p of removed) {
      await this.deleteDocFile(p)
    }

    await this.index.commit(current => { for (const p of removed) delete current[p] })
    this.notify()
  }

  private async deleteDocFile(path: string): Promise<void> {
    // Could be stored as path.json or path/index.json
    const indexFile = this.docIndexFilePath(path)
    if (await this.adapter.exists(indexFile)) {
      await this.adapter.delete(indexFile)
    } else {
      await this.adapter.delete(this.docFilePath(path))
    }
  }

  async move(from: string, to: string): Promise<void> {
    const index = await this.index.load()
    if (!index[from]) throw new Error(`Document not found: ${from}`)

    // A node (folder/index.json) moves together with everything below it
    const isNode = await this.adapter.exists(this.docIndexFilePath(from))
    const moved = isNode
      ? Object.keys(index).filter(p => p === from || p.startsWith(from + '/'))
      : [from]
    const renamed = moved.map(p => [p, p === from ? to : to + p.slice(from.length), index[p]] as const)

    if (isNode) {
      await this.adapter.move(`${this.name}/${from}`, `${this.name}/${to}`)
    } else {
      await this.adapter.move(this.docFilePath(from), this.docFilePath(to))
    }

    await this.index.commit(current => {
      for (const [oldPath, newPath, doc] of renamed) {
        delete current[oldPath]
        current[newPath] = doc
      }
    })
    this.notify()
  }

  async promote(path: string): Promise<void> {
    // Leaf → node: path.json → path/index.json
    const nodeFile = this.docIndexFilePath(path)
    if (await this.adapter.exists(nodeFile)) {
      throw new Error(`Already a node: ${path}`)
    }
    const leafFile = this.docFilePath(path)
    if (!(await this.adapter.exists(leafFile))) {
      throw new Error(`Document not found: ${path}`)
    }
    await this.adapter.move(leafFile, nodeFile)
    this.notify()
    // Index doesn't change — same path, same doc
  }

  async demote(path: string): Promise<void> {
    // Node → leaf: path/index.json → path.json (only if no children)
    const nodeFile = this.docIndexFilePath(path)
    if (!(await this.adapter.exists(nodeFile))) {
      throw new Error(`Not a node: ${path}`)
    }
    // Check for children
    const entries = await this.adapter.list(`${this.name}/${path}`)
    const children = entries.filter(e => e !== 'index.json' && e !== INDEX_FILE)
    if (children.length > 0) {
      throw new Error(`Cannot demote: ${path} has children`)
    }
    const leafFile = this.docFilePath(path)
    await this.adapter.move(nodeFile, leafFile)
    this.notify()
  }

  async tree(rootPath?: string): Promise<TreeNode> {
    const index = await this.index.load()
    const root = rootPath ?? ''

    const buildNode = (nodePath: string): TreeNode => {
      const doc = index[nodePath] ? this.validateRead(this.readEntry(index[nodePath])) : null

      // Find direct children
      const prefix = nodePath === '' ? '' : nodePath + '/'
      const childPaths = new Set<string>()

      for (const p of Object.keys(index)) {
        if (p === nodePath) continue
        if (!p.startsWith(prefix)) continue
        // Get the direct child segment
        const rest = p.slice(prefix.length)
        const segment = rest.split('/')[0]
        childPaths.add(prefix + segment)
      }

      const children = [...childPaths].sort().map(cp => buildNode(cp))

      return { path: nodePath, doc, children }
    }

    return buildNode(root)
  }

  // --- Populate stub (wired up by flatdb()) ---

  _resolveRef: ((collection: string, id: string) => Promise<any>) | null = null

  private async populateDoc(doc: T, populate: string[] | Record<string, any>): Promise<T> {
    if (!this._resolveRef) return doc
    const result: Record<string, any> = { ...doc }
    const fields = Array.isArray(populate) ? populate : Object.keys(populate)

    for (const field of fields) {
      const value = result[field]
      if (typeof value === 'string' && value.startsWith('ref:')) {
        result[field] = await this.resolveRefValue(value)
      } else if (Array.isArray(value)) {
        result[field] = await Promise.all(
          value.map(v => (typeof v === 'string' && v.startsWith('ref:')) ? this.resolveRefValue(v) : v),
        )
      }
    }
    return result as T
  }

  private async resolveRefValue(refStr: string): Promise<any> {
    if (!this._resolveRef) return refStr
    // "ref:users/abc123" → collection="users", id="abc123"
    const withoutPrefix = refStr.slice(4) // remove "ref:"
    const slashIndex = withoutPrefix.indexOf('/')
    const collection = withoutPrefix.slice(0, slashIndex)
    const id = withoutPrefix.slice(slashIndex + 1)
    return this._resolveRef(collection, id)
  }

  // --- Reactivity ---

  /**
   * Runs the query now and after every change. Errors from the query or the
   * callback go to `onError` (default: logged); the subscription stays alive.
   */
  live(filter: QueryFilter, cb: (results: T[]) => void, onError?: LiveErrorHandler): () => void
  live(cb: (results: T[]) => void, onError?: LiveErrorHandler): () => void
  live(
    filterOrCb: QueryFilter | ((results: T[]) => void),
    cbOrOnError?: ((results: T[]) => void) | LiveErrorHandler,
    maybeOnError?: LiveErrorHandler,
  ): () => void {
    const byCallback = typeof filterOrCb === 'function'
    const filter = byCallback ? {} : filterOrCb
    const cb = (byCallback ? filterOrCb : cbOrOnError) as (results: T[]) => void
    const onError = (byCallback ? cbOrOnError : maybeOnError) as LiveErrorHandler | undefined
    return liveQuery(this.emitter, () => this.find(filter), cb, onError)
  }

  liveByPath(path: string, cb: (doc: T | null) => void, onError?: LiveErrorHandler): () => void {
    return liveQuery(this.emitter, () => this.get(path), cb, onError)
  }

  /** Async iterator over the results; ends with the error when a query fails. */
  watch(filter: QueryFilter = {}): AsyncIterable<T[]> {
    return watchQuery(this.emitter, () => this.find(filter))
  }

}

function matchPathPattern(docPath: string, pattern: string): boolean {
  // "blog/*" → direct children of blog
  // "blog/**" → all descendants of blog
  // "docs/api/*" → direct children of docs/api
  if (pattern.endsWith('/**')) {
    const prefix = pattern.slice(0, -3)
    return docPath.startsWith(prefix + '/') || docPath === prefix
  }
  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -2)
    if (!docPath.startsWith(prefix + '/')) return false
    const rest = docPath.slice(prefix.length + 1)
    return !rest.includes('/') // no further nesting = direct child
  }
  return docPath === pattern
}
