import type { StorageAdapter } from './types.js'

/**
 * The slice of a Cloudflare R2 bucket binding that R2Adapter uses.
 *
 * Structural on purpose: any `R2Bucket` from `@cloudflare/workers-types`
 * satisfies it without this package depending on those types.
 */
export interface R2BucketLike {
  head(key: string): Promise<object | null>
  get(key: string): Promise<{ text(): Promise<string> } | null>
  put(key: string, value: string): Promise<unknown>
  delete(key: string): Promise<void>
  list(options?: R2ListOptionsLike): Promise<R2ListResultLike>
}

export interface R2ListOptionsLike {
  prefix?: string
  delimiter?: string
  cursor?: string
  limit?: number
}

export interface R2ListResultLike {
  objects: { key: string }[]
  delimitedPrefixes: string[]
  truncated: boolean
  cursor?: string
}

export interface R2AdapterOptions {
  bucket: R2BucketLike
  /** Key prefix inside the bucket, e.g. `'data'`. Leading and trailing slashes are ignored. */
  prefix?: string
}

/**
 * Stores documents as objects in a Cloudflare R2 bucket.
 *
 * Keys use `/` as separator, so `users/abc.json` lives at `<prefix>/users/abc.json`
 * and the collection tree maps onto key prefixes the way it maps onto folders with
 * FsAdapter. Directories are implicit, `list` asks R2 for direct children with a
 * delimiter instead of scanning the whole subtree, and `move` copies then deletes
 * because R2 has no rename.
 *
 * R2 bindings offer no change notifications, so `watch` is not provided.
 */
export class R2Adapter implements StorageAdapter {
  private bucket: R2BucketLike
  private prefix: string

  constructor(options: R2AdapterOptions) {
    this.bucket = options.bucket
    const prefix = trimSlashes(options.prefix ?? '')
    this.prefix = prefix ? `${prefix}/` : ''
  }

  private key(path: string): string {
    return this.prefix + path.replace(/^\/+/, '')
  }

  /** Key prefix that selects everything inside `dir`: `<prefix>/<dir>/`. */
  private dirKey(dir: string): string {
    const trimmed = trimSlashes(dir)
    return trimmed ? `${this.prefix}${trimmed}/` : this.prefix
  }

  private async *pages(options: Omit<R2ListOptionsLike, 'cursor'>): AsyncGenerator<R2ListResultLike> {
    let cursor: string | undefined
    do {
      const page = await this.bucket.list({ ...options, cursor })
      yield page
      cursor = page.truncated ? page.cursor : undefined
    } while (cursor)
  }

  async read(path: string): Promise<string | null> {
    const object = await this.bucket.get(this.key(path))
    return object ? object.text() : null
  }

  async write(path: string, data: string): Promise<void> {
    await this.bucket.put(this.key(path), data)
  }

  async delete(path: string): Promise<void> {
    await this.bucket.delete(this.key(path))
  }

  async exists(path: string): Promise<boolean> {
    if (await this.bucket.head(this.key(path))) return true
    // Like the other adapters: a directory exists once any key lives under it
    const page = await this.bucket.list({ prefix: this.dirKey(path), limit: 1 })
    return page.objects.length > 0
  }

  async list(dir: string): Promise<string[]> {
    const prefix = this.dirKey(dir)
    const entries = new Set<string>()

    for await (const page of this.pages({ prefix, delimiter: '/' })) {
      for (const { key } of page.objects) {
        const name = key.slice(prefix.length)
        if (name) entries.add(name)
      }
      for (const folder of page.delimitedPrefixes) {
        entries.add(folder.slice(prefix.length, -1))
      }
    }

    return [...entries]
  }

  async mkdir(_dir: string): Promise<void> {
    // No-op: directories are implicit in key prefixes
  }

  async move(from: string, to: string): Promise<void> {
    const fromKey = this.key(from)
    const toKey = this.key(to)

    // The exact key plus everything below it (directory move)
    const sources = [fromKey]
    for await (const page of this.pages({ prefix: `${fromKey}/` })) {
      for (const { key } of page.objects) sources.push(key)
    }

    // Copy everything before deleting anything, so an interrupted move leaves
    // duplicates behind rather than gaps
    const copied: string[] = []
    for (const source of sources) {
      const object = await this.bucket.get(source)
      if (!object) continue
      await this.bucket.put(toKey + source.slice(fromKey.length), await object.text())
      copied.push(source)
    }
    for (const source of copied) {
      await this.bucket.delete(source)
    }
  }
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, '')
}
