import type { StorageAdapter } from './types.js'

const STORE_NAME = 'files'

export class IndexedDBAdapter implements StorageAdapter {
  private dbName: string
  private dbPromise: Promise<IDBDatabase> | null = null

  constructor(dbName: string) {
    this.dbName = dbName
  }

  private getDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1)

      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME)
        }
      }

      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })

    return this.dbPromise
  }

  private async tx(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest,
  ): Promise<any> {
    const db = await this.getDb()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode)
      const store = transaction.objectStore(STORE_NAME)
      const request = fn(store)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  async read(path: string): Promise<string | null> {
    const result = await this.tx('readonly', (store) => store.get(path))
    return result ?? null
  }

  async write(path: string, data: string): Promise<void> {
    await this.tx('readwrite', (store) => store.put(data, path))
  }

  async delete(path: string): Promise<void> {
    await this.tx('readwrite', (store) => store.delete(path))
  }

  async exists(path: string): Promise<boolean> {
    const result = await this.tx('readonly', (store) => store.get(path))
    if (result !== undefined) return true

    // Check if it's a "directory" (any key starts with path/)
    const keys = await this.getAllKeys()
    const prefix = path + '/'
    return keys.some(k => k.startsWith(prefix))
  }

  async list(dir: string): Promise<string[]> {
    const prefix = dir.endsWith('/') ? dir : dir + '/'
    const keys = await this.getAllKeys()
    const entries = new Set<string>()

    for (const key of keys) {
      if (!key.startsWith(prefix)) continue
      const rest = key.slice(prefix.length)
      const segment = rest.split('/')[0]
      if (segment) entries.add(segment)
    }

    return [...entries]
  }

  async mkdir(_dir: string): Promise<void> {
    // No-op — directories are implicit via key prefixes
  }

  async move(from: string, to: string): Promise<void> {
    // Move exact key
    const value = await this.read(from)
    if (value !== null) {
      await this.write(to, value)
      await this.delete(from)
    }

    // Move all keys under from/ prefix
    const keys = await this.getAllKeys()
    const prefix = from + '/'
    for (const key of keys) {
      if (key.startsWith(prefix)) {
        const newKey = to + '/' + key.slice(prefix.length)
        const val = await this.read(key)
        if (val !== null) {
          await this.write(newKey, val)
          await this.delete(key)
        }
      }
    }
  }

  private async getAllKeys(): Promise<string[]> {
    const db = await this.getDb()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.getAllKeys()
      request.onsuccess = () => resolve(request.result as string[])
      request.onerror = () => reject(request.error)
    })
  }

  async close(): Promise<void> {
    if (this.dbPromise) {
      const db = await this.dbPromise
      db.close()
      this.dbPromise = null
    }
  }
}
