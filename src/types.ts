import type { ZodType } from 'zod'

export interface WatchEvent {
  type: 'create' | 'update' | 'delete'
  path: string
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
