import type { StorageAdapter } from './types.js'

export class MemoryAdapter implements StorageAdapter {
  private store = new Map<string, string>()

  async read(path: string): Promise<string | null> {
    return this.store.get(path) ?? null
  }

  async write(path: string, data: string): Promise<void> {
    this.store.set(path, data)
  }

  async delete(path: string): Promise<void> {
    this.store.delete(path)
  }

  async exists(path: string): Promise<boolean> {
    // Check for exact key or if it's a "directory" (prefix of other keys)
    if (this.store.has(path)) return true
    const prefix = path.endsWith('/') ? path : path + '/'
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) return true
    }
    return false
  }

  async list(dir: string): Promise<string[]> {
    const prefix = dir.endsWith('/') ? dir : dir + '/'
    const entries = new Set<string>()

    for (const key of this.store.keys()) {
      if (!key.startsWith(prefix)) continue
      const rest = key.slice(prefix.length)
      // Get the first segment (file or directory name)
      const segment = rest.split('/')[0]
      if (segment) entries.add(segment)
    }

    return [...entries]
  }

  async mkdir(_dir: string): Promise<void> {
    // No-op — directories are implicit in memory
  }

  async move(from: string, to: string): Promise<void> {
    // Move exact key
    const value = this.store.get(from)
    if (value !== undefined) {
      this.store.set(to, value)
      this.store.delete(from)
    }

    // Move all keys under from/ prefix (directory move)
    const prefix = from + '/'
    const toMove: [string, string][] = []
    for (const [key, val] of this.store.entries()) {
      if (key.startsWith(prefix)) {
        const newKey = to + '/' + key.slice(prefix.length)
        toMove.push([key, newKey])
      }
    }
    for (const [oldKey, newKey] of toMove) {
      this.store.set(newKey, this.store.get(oldKey)!)
      this.store.delete(oldKey)
    }
  }

  clear(): void {
    this.store.clear()
  }
}
