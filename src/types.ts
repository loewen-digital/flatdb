import type { ZodType } from 'zod'

export interface WatchEvent {
  type: 'create' | 'update' | 'delete'
  path: string
}

export interface VersionedRead {
  data: string | null
  /** Opaque token for `writeIf`; `null` when the path does not exist. */
  version: string | null
}

export interface StorageAdapter {
  read(path: string): Promise<string | null>
  write(path: string, data: string): Promise<void>
  delete(path: string): Promise<void>
  exists(path: string): Promise<boolean>
  list(dir: string): Promise<string[]>
  mkdir(dir: string): Promise<void>
  move(from: string, to: string): Promise<void>
  watch?(dir: string, cb: (event: WatchEvent) => void): () => void
  /** Releases connections or handles the adapter holds. Called by `db.close()`. */
  close?(): Promise<void>
  /**
   * Optional pair for conditional writes; the collections use it for `_index.json`.
   * `readVersioned` returns the content with a version token. `writeIf` writes only
   * when the stored version still equals `version` (`null`: only when the path does
   * not exist yet) and returns the new version, or `null` when another writer got
   * there first.
   */
  readVersioned?(path: string): Promise<VersionedRead>
  writeIf?(path: string, data: string, version: string | null): Promise<string | null>
}

export interface CollectionOptions {
  mode?: 'auto' | 'path'
  unknownFields?: 'strip' | 'passthrough' | 'error'
  validateOnRead?: boolean
  migrate?: (doc: any) => any
}

export interface CollectionDefinition {
  schema?: ZodType
  options: CollectionOptions
}

export interface QueryFilter {
  [key: string]: any
}

export interface QueryOptions {
  sort?: Record<string, 1 | -1>
  limit?: number
  skip?: number
  select?: string[]
  populate?: string[]
}
