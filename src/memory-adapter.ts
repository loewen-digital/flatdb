import type { StorageAdapter, VersionedRead } from './types.js'

export class MemoryAdapter implements StorageAdapter {
  private store = new Map<string, string>()
  private versions = new Map<string, number>()

  private set(path: string, data: string): string {
    const version = (this.versions.get(path) ?? 0) + 1
    this.store.set(path, data)
    this.versions.set(path, version)
    return String(version)
  }

  private versionOf(path: string): string | null {
    return this.store.has(path) ? String(this.versions.get(path)) : null
  }

  async read(path: string): Promise<string | null> {
    return this.store.get(path) ?? null
  }

  async write(path: string, data: string): Promise<void> {
    this.set(path, data)
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
      this.set(to, value)
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
      this.set(newKey, this.store.get(oldKey)!)
      this.store.delete(oldKey)
    }
  }

  async readVersioned(path: string): Promise<VersionedRead> {
    return { data: this.store.get(path) ?? null, version: this.versionOf(path) }
  }

  async writeIf(path: string, data: string, version: string | null): Promise<string | null> {
    if (this.versionOf(path) !== version) return null
    return this.set(path, data)
  }

  clear(): void {
    // Versions are kept so a reader holding an old token still conflicts after a clear
    this.store.clear()
  }
}
