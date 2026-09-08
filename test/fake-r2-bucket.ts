import type { R2BucketLike, R2ListOptionsLike, R2ListResultLike } from '../src/r2-adapter.js'

/**
 * In-memory stand-in for an R2 bucket binding with R2's listing semantics:
 * keys come back sorted, `delimiter` folds nested keys into `delimitedPrefixes`,
 * and results are paged through `cursor`/`truncated`. `pageSize` caps a page so
 * tests can force pagination. `calls` records every binding call.
 */
export class FakeR2Bucket implements R2BucketLike {
  readonly objects = new Map<string, string>()
  readonly calls: string[] = []

  constructor(private pageSize = 1000) {}

  async head(key: string): Promise<object | null> {
    this.calls.push(`head ${key}`)
    return this.objects.has(key) ? { key } : null
  }

  async get(key: string): Promise<{ text(): Promise<string> } | null> {
    this.calls.push(`get ${key}`)
    const value = this.objects.get(key)
    return value === undefined ? null : { text: async () => value }
  }

  async put(key: string, value: string): Promise<unknown> {
    this.calls.push(`put ${key}`)
    this.objects.set(key, value)
    return { key }
  }

  async delete(key: string): Promise<void> {
    this.calls.push(`delete ${key}`)
    this.objects.delete(key)
  }

  async list(options: R2ListOptionsLike = {}): Promise<R2ListResultLike> {
    const { prefix = '', delimiter, cursor, limit } = options
    this.calls.push(`list ${prefix}`)

    const entries: { key: string; folder: boolean }[] = []
    const seen = new Set<string>()
    for (const key of [...this.objects.keys()].sort()) {
      if (!key.startsWith(prefix)) continue
      const rest = key.slice(prefix.length)
      const cut = delimiter ? rest.indexOf(delimiter) : -1
      const entry = cut === -1 ? key : prefix + rest.slice(0, cut + delimiter!.length)
      if (seen.has(entry)) continue
      seen.add(entry)
      entries.push({ key: entry, folder: cut !== -1 })
    }

    const start = cursor ? Number(cursor) : 0
    const size = Math.min(limit ?? this.pageSize, this.pageSize)
    const page = entries.slice(start, start + size)
    const end = start + page.length
    const truncated = end < entries.length

    return {
      objects: page.filter(e => !e.folder).map(e => ({ key: e.key })),
      delimitedPrefixes: page.filter(e => e.folder).map(e => e.key),
      truncated,
      cursor: truncated ? String(end) : undefined,
    }
  }
}
