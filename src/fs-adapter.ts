import fs from 'fs/promises'
import { watch as fsWatch } from 'fs'
import path from 'path'
import type { StorageAdapter, WatchEvent } from './types.js'

export class FsAdapter implements StorageAdapter {
  constructor(private basePath: string) {}

  private resolve(filePath: string): string {
    return path.join(this.basePath, filePath)
  }

  async read(filePath: string): Promise<string | null> {
    try {
      return await fs.readFile(this.resolve(filePath), 'utf-8')
    } catch (err: any) {
      if (err.code === 'ENOENT') return null
      throw err
    }
  }

  async write(filePath: string, data: string): Promise<void> {
    const fullPath = this.resolve(filePath)
    await fs.mkdir(path.dirname(fullPath), { recursive: true })
    await fs.writeFile(fullPath, data, 'utf-8')
  }

  async delete(filePath: string): Promise<void> {
    try {
      await fs.unlink(this.resolve(filePath))
    } catch (err: any) {
      if (err.code === 'ENOENT') return
      throw err
    }
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(filePath))
      return true
    } catch {
      return false
    }
  }

  async list(dir: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.resolve(dir))
      return entries
    } catch (err: any) {
      if (err.code === 'ENOENT') return []
      throw err
    }
  }

  async mkdir(dir: string): Promise<void> {
    await fs.mkdir(this.resolve(dir), { recursive: true })
  }

  async move(from: string, to: string): Promise<void> {
    const toFull = this.resolve(to)
    await fs.mkdir(path.dirname(toFull), { recursive: true })
    await fs.rename(this.resolve(from), toFull)
  }

  watch(dir: string, cb: (event: WatchEvent) => void): () => void {
    const fullDir = this.resolve(dir)
    const watcher = fsWatch(fullDir, { recursive: true }, (eventType, filename) => {
      if (!filename || !filename.endsWith('.json')) return
      if (filename.endsWith('_index.json')) return

      const filePath = filename.replace(/\\/g, '/') // normalize Windows paths
      const watchEvent: WatchEvent = {
        type: eventType === 'rename' ? 'create' : 'update',
        path: filePath,
      }
      cb(watchEvent)
    })

    return () => {
      watcher.close()
    }
  }
}
