import type { StorageAdapter } from './types.js'

/**
 * Structural minimal interface of a Cloudflare R2 bucket binding — deliberately
 * independent of @cloudflare/workers-types so the package carries no Workers
 * type dependency. Any real R2Bucket binding satisfies it.
 */
export interface R2BucketLike {
  get(key: string): Promise<{ text(): Promise<string> } | null>
  put(key: string, value: string): Promise<unknown>
  delete(key: string): Promise<void>
  list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<{
    objects: { key: string }[]
    truncated: boolean
    cursor?: string
  }>
  head?(key: string): Promise<unknown | null>
}

export interface R2AdapterOptions {
  bucket: R2BucketLike
  /** Key prefix inside the bucket, e.g. 'data'. */
  prefix?: string
}

/**
 * R2 storage adapter (Cloudflare Workers) — key prefixes with '/' as separator
 * form the content tree, same mental model as FsAdapter.
 */
export class R2Adapter implements StorageAdapter {
  private bucket: R2BucketLike
  private prefix: string

  constructor(options: R2AdapterOptions) {
    this.bucket = options.bucket
    this.prefix = options.prefix ? options.prefix.replace(/\/+$/, '') + '/' : ''
  }

  private resolve(key: string): string {
    return `${this.prefix}${key}`
  }

  private async listAllObjects(prefix: string): Promise<{ key: string }[]> {
    const objects: { key: string }[] = []
    let cursor: string | undefined
    do {
      const result = await this.bucket.list({ prefix, cursor, limit: 1000 })
      objects.push(...result.objects)
      cursor = result.truncated ? result.cursor : undefined
    } while (cursor)
    return objects
  }

  async read(path: string): Promise<string | null> {
    const object = await this.bucket.get(this.resolve(path))
    return object ? await object.text() : null
  }

  async write(path: string, data: string): Promise<void> {
    await this.bucket.put(this.resolve(path), data)
  }

  async delete(path: string): Promise<void> {
    await this.bucket.delete(this.resolve(path))
  }

  async exists(path: string): Promise<boolean> {
    const key = this.resolve(path)
    const exact = this.bucket.head ? await this.bucket.head(key) : await this.bucket.get(key)
    if (exact != null) return true

    // Not an exact key — check whether it exists as an implicit directory
    const dirPrefix = key.endsWith('/') ? key : `${key}/`
    const result = await this.bucket.list({ prefix: dirPrefix, limit: 1 })
    return result.objects.length > 0
  }

  async list(dir: string): Promise<string[]> {
    const base = dir === '' ? '' : dir.endsWith('/') ? dir : `${dir}/`
    const fullPrefix = this.resolve(base)
    const entries = new Set<string>()

    for (const object of await this.listAllObjects(fullPrefix)) {
      const rest = object.key.slice(fullPrefix.length)
      const segment = rest.split('/')[0]
      if (segment) entries.add(segment)
    }

    return [...entries]
  }

  async mkdir(_dir: string): Promise<void> {
    // No-op — directories are implicit via key prefixes
  }

  async move(from: string, to: string): Promise<void> {
    const fromKey = this.resolve(from)
    const toKey = this.resolve(to)

    // Move the exact key, if present
    const object = await this.bucket.get(fromKey)
    if (object) {
      await this.bucket.put(toKey, await object.text())
      await this.bucket.delete(fromKey)
    }

    // Move everything under the from/ prefix (directory move)
    const dirPrefix = `${fromKey}/`
    const toDirPrefix = `${toKey}/`
    for (const { key } of await this.listAllObjects(dirPrefix)) {
      const nested = await this.bucket.get(key)
      if (!nested) continue
      await this.bucket.put(`${toDirPrefix}${key.slice(dirPrefix.length)}`, await nested.text())
      await this.bucket.delete(key)
    }
  }
}
