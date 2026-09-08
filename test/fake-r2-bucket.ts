import { createHash } from 'node:crypto'
import type { R2BucketLike, R2ListOptionsLike, R2ListResultLike, R2PutOptionsLike } from '../src/r2-adapter.js'

/**
 * In-memory stand-in for an R2 bucket binding with R2's semantics as observed in
 * miniflare: keys come back sorted, `delimiter` folds nested keys into
 * `delimitedPrefixes`, results page through `cursor`/`truncated`, etags are the
 * MD5 of the content, and `put` honours `onlyIf` (a failed condition returns
 * null, a quoted etag throws). `pageSize` caps a page so tests can force
 * pagination. `calls` records every binding call.
 */
export class FakeR2Bucket implements R2BucketLike {
  readonly objects = new Map<string, string>()
  readonly calls: string[] = []

  constructor(private pageSize = 1000) {}

  private etagOf(key: string): string | null {
    const value = this.objects.get(key)
    return value === undefined ? null : etag(value)
  }

  async head(key: string): Promise<{ etag: string } | null> {
    this.calls.push(`head ${key}`)
    const tag = this.etagOf(key)
    return tag === null ? null : { etag: tag }
  }

  async get(key: string): Promise<{ etag: string; text(): Promise<string> } | null> {
    this.calls.push(`get ${key}`)
    const value = this.objects.get(key)
    return value === undefined ? null : { etag: etag(value), text: async () => value }
  }

  async put(key: string, value: string, options?: R2PutOptionsLike): Promise<{ etag: string } | null> {
    const onlyIf = options?.onlyIf
    this.calls.push(`put ${key}${onlyIf ? ' onlyIf' : ''}`)
    if (onlyIf) {
      for (const tag of [onlyIf.etagMatches, onlyIf.etagDoesNotMatch]) {
        if (tag?.startsWith('"')) throw new TypeError(`Conditional ETag should not be wrapped in quotes (${tag}).`)
      }
      const current = this.etagOf(key)
      if (onlyIf.etagMatches !== undefined && current !== onlyIf.etagMatches) return null
      if (onlyIf.etagDoesNotMatch === '*' ? current !== null : onlyIf.etagDoesNotMatch !== undefined && current === onlyIf.etagDoesNotMatch) return null
    }
    this.objects.set(key, value)
    return { etag: etag(value) }
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

function etag(value: string): string {
  return createHash('md5').update(value).digest('hex')
}
