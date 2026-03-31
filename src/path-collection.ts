import type { ZodType } from 'zod'
import type { StorageAdapter, CollectionOptions, QueryFilter, QueryOptions } from './types.js'
import { matchesFilter, applyOptions } from './query.js'
import { EventEmitter } from './emitter.js'

const INDEX_FILE = '_index.json'

export interface TreeNode {
  path: string
  doc: Record<string, any> | null
  children: TreeNode[]
}

export class PathCollection<T extends Record<string, any> = Record<string, any>> {
  private schema?: ZodType
  private options: CollectionOptions
  private indexCache: Record<string, T> | null = null
  private emitter = new EventEmitter()

  constructor(
    private adapter: StorageAdapter,
    private name: string,
    schema?: ZodType,
    options: CollectionOptions = {},
  ) {
    this.schema = schema
    this.options = { mode: 'path', unknownFields: 'strip', validateOnRead: true, ...options }
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
    const index: Record<string, T> = {}
    await this.scanDir('', index)
    await this.saveIndex(index)
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

  private validateRead(doc: Record<string, any>): T {
    if (!this.schema || !this.options.validateOnRead) return doc as T
    if (this.options.migrate) doc = this.options.migrate(doc)
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

    const index = await this.loadIndex()
    index[path] = validated
    await this.saveIndex(index)
    this.notify()

    return validated
  }

  async get(path: string, options?: QueryOptions): Promise<T | null> {
    const index = await this.loadIndex()
    const entry = index[path]
    if (!entry) return null
    let validated = this.validateRead({ ...entry })
    if (options?.populate) {
      validated = await this.populateDoc(validated, options.populate)
    }
    return validated
  }

  async find(filter: QueryFilter = {}, options: QueryOptions = {}): Promise<T[]> {
    const index = await this.loadIndex()
    let results: T[] = []
    const pathPattern = filter.$path as string | undefined

    for (const [docPath, doc] of Object.entries(index)) {
      if (pathPattern && !matchPathPattern(docPath, pathPattern)) continue
      if (matchesFilter(doc, filter)) {
        const validated = this.validateRead({ ...doc })
        results.push(validated)
      }
    }

    return applyOptions(results, options)
  }

  async findOne(filter: QueryFilter = {}): Promise<T | null> {
    const results = await this.find(filter, { limit: 1 })
    return results[0] ?? null
  }

  async count(filter: QueryFilter = {}): Promise<number> {
    const index = await this.loadIndex()
    let count = 0
    const pathPattern = filter.$path as string | undefined

    for (const [docPath, doc] of Object.entries(index)) {
      if (pathPattern && !matchPathPattern(docPath, pathPattern)) continue
      if (matchesFilter(doc, filter)) count++
    }
    return count
  }

  async update(path: string, changes: Record<string, any>): Promise<T> {
    const index = await this.loadIndex()
    const existing = index[path]
    if (!existing) throw new Error(`Document not found: ${path}`)

    const merged = deepMerge({ ...existing }, changes)
    const validated = this.validateWrite(merged)

    // Write to wherever the doc actually lives (file or index.json)
    const isNode = await this.adapter.exists(this.docIndexFilePath(path))
    const filePath = isNode ? this.docIndexFilePath(path) : this.docFilePath(path)
    await this.adapter.write(filePath, JSON.stringify(validated, null, 2))

    index[path] = validated
    await this.saveIndex(index)
    this.notify()

    return validated
  }

  async delete(path: string, options?: { recursive?: boolean }): Promise<void> {
    const index = await this.loadIndex()

    if (options?.recursive) {
      // Delete this path and all children
      const toDelete = Object.keys(index).filter(
        p => p === path || p.startsWith(path + '/'),
      )
      for (const p of toDelete) {
        await this.deleteDocFile(p)
        delete index[p]
      }
      // Also try to remove the directory
      try {
        const dirPath = `${this.name}/${path}`
        const entries = await this.adapter.list(dirPath)
        if (entries.length === 0 || entries.every(e => e === INDEX_FILE)) {
          // Clean up empty dir (best effort)
        }
      } catch { /* ignore */ }
    } else {
      await this.deleteDocFile(path)
      delete index[path]
    }

    await this.saveIndex(index)
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
    const index = await this.loadIndex()
    const doc = index[from]
    if (!doc) throw new Error(`Document not found: ${from}`)

    // Check if it's stored as a node (folder/index.json)
    const isNode = await this.adapter.exists(this.docIndexFilePath(from))

    if (isNode) {
      // Move the entire directory
      await this.adapter.move(`${this.name}/${from}`, `${this.name}/${to}`)
      // Update all paths in the index that start with `from`
      const toUpdate = Object.keys(index).filter(
        p => p === from || p.startsWith(from + '/'),
      )
      for (const p of toUpdate) {
        const newPath = p === from ? to : to + p.slice(from.length)
        index[newPath] = index[p]
        delete index[p]
      }
    } else {
      await this.adapter.move(this.docFilePath(from), this.docFilePath(to))
      index[to] = doc
      delete index[from]
    }

    await this.saveIndex(index)
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
    const index = await this.loadIndex()
    const root = rootPath ?? ''

    const buildNode = (nodePath: string): TreeNode => {
      const doc = index[nodePath] ? this.validateRead({ ...index[nodePath] }) : null

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
    const result = { ...doc }
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
    return result
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

  live(filter: QueryFilter, cb: (results: T[]) => void): () => void
  live(cb: (results: T[]) => void): () => void
  live(
    filterOrCb: QueryFilter | ((results: T[]) => void),
    maybeCb?: (results: T[]) => void,
  ): () => void {
    const filter = typeof filterOrCb === 'function' ? {} : filterOrCb
    const cb = typeof filterOrCb === 'function' ? filterOrCb : maybeCb!

    this.find(filter).then(cb)

    const unsub = this.emitter.subscribe(() => {
      this.find(filter).then(cb)
    })

    return unsub
  }

  liveByPath(path: string, cb: (doc: T | null) => void): () => void {
    this.get(path).then(cb)

    const unsub = this.emitter.subscribe(() => {
      this.get(path).then(cb)
    })

    return unsub
  }

  watch(filter: QueryFilter = {}): AsyncIterable<T[]> {
    const self = this
    return {
      [Symbol.asyncIterator]() {
        let resolve: ((value: IteratorResult<T[]>) => void) | null = null
        let done = false

        const unsub = self.emitter.subscribe(() => {
          if (resolve) {
            self.find(filter).then(results => {
              if (resolve) {
                resolve({ value: results, done: false })
                resolve = null
              }
            })
          }
        })

        let initialResolve: typeof resolve = null
        const initialPromise = new Promise<IteratorResult<T[]>>(r => {
          initialResolve = r
        })
        self.find(filter).then(results => {
          if (initialResolve) initialResolve({ value: results, done: false })
        })

        let firstCall = true

        return {
          next() {
            if (done) return Promise.resolve({ value: undefined as any, done: true })
            if (firstCall) {
              firstCall = false
              return initialPromise
            }
            return new Promise<IteratorResult<T[]>>(r => {
              resolve = r
            })
          },
          return() {
            done = true
            unsub()
            return Promise.resolve({ value: undefined as any, done: true })
          },
        }
      },
    }
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
