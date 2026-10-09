import type { StorageAdapter } from './types.js'

const MAX_ATTEMPTS = 20
const BACKOFF_BASE_MS = 4
const BACKOFF_CAP_MS = 150

/**
 * Waits a random time that grows with every lost race, so writers that collided
 * do not all reload and collide again at the same moment.
 */
function backoff(attempt: number): Promise<void> {
  const ceiling = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (attempt - 1))
  return new Promise((resolve) => setTimeout(resolve, Math.random() * ceiling))
}

/**
 * A collection's `_index.json`: cached in memory, written through the adapter.
 *
 * With an adapter that offers `readVersioned`/`writeIf`, `commit` is a
 * compare-and-swap: when another writer changed the index in between, the index
 * is reloaded and the change applied again after a short random wait, so
 * concurrent writers keep each other's entries. Without that support the write
 * is unconditional.
 */
export class IndexStore<T> {
  private cache: Record<string, T> | null = null
  private version: string | null = null

  constructor(
    private adapter: StorageAdapter,
    private path: string,
  ) {}

  /** Forget the cached copy; the next access reads from storage. */
  invalidate(): void {
    this.cache = null
    this.version = null
  }

  async load(): Promise<Record<string, T>> {
    if (this.cache) return this.cache
    if (this.adapter.readVersioned) {
      const { data, version } = await this.adapter.readVersioned(this.path)
      this.cache = data ? JSON.parse(data) : {}
      this.version = version
    } else {
      const raw = await this.adapter.read(this.path)
      this.cache = raw ? JSON.parse(raw) : {}
    }
    return this.cache!
  }

  /** Applies `change` to the index and persists it; `change` may run more than once. */
  async commit(change: (index: Record<string, T>) => void): Promise<void> {
    const { adapter } = this
    if (!adapter.readVersioned || !adapter.writeIf) {
      const index = await this.load()
      change(index)
      await adapter.write(this.path, serialize(index))
      return
    }

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const index = await this.load()
      change(index)
      const version = await adapter.writeIf(this.path, serialize(index), this.version)
      if (version !== null) {
        this.version = version
        return
      }
      this.invalidate()
      if (attempt < MAX_ATTEMPTS) await backoff(attempt)
    }
    throw new Error(
      `${this.path}: another writer kept changing the index (${MAX_ATTEMPTS} attempts)`,
    )
  }

  /** Replaces the whole index, e.g. after a rebuild. */
  async replace(index: Record<string, T>): Promise<void> {
    await this.commit((current) => {
      for (const key of Object.keys(current)) delete current[key]
      Object.assign(current, index)
    })
  }
}

function serialize(index: object): string {
  return JSON.stringify(index, null, 2)
}
