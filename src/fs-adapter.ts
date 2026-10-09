import fs from 'fs/promises'
import { watch as fsWatch } from 'fs'
import path from 'path'
import { nanoid } from 'nanoid'
import type { StorageAdapter, VersionedRead, WatchEvent } from './types.js'

const TMP_SUFFIX = '.tmp'

/**
 * One queue per absolute file path, shared by every `FsAdapter` in the process:
 * apps open one adapter per request, so a lock on the instance would serialise nothing.
 */
const queues = new Map<string, Promise<void>>()

function serialised<T>(key: string, task: () => Promise<T>): Promise<T> {
  const run = (queues.get(key) ?? Promise.resolve()).then(task)
  const settled = run.then(
    () => {},
    () => {},
  )
  queues.set(key, settled)
  void settled.then(() => {
    if (queues.get(key) === settled) queues.delete(key)
  })
  return run
}

/** Version token of a file: the SHA-1 of its content. */
async function versionOf(data: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(data))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Writes through a temp file in the same directory and a `rename`, so a reader
 * sees the old or the new content, never a partial file.
 */
async function writeAtomic(fullPath: string, data: string): Promise<void> {
  const dir = path.dirname(fullPath)
  await fs.mkdir(dir, { recursive: true })
  const tmpPath = path.join(dir, `.${path.basename(fullPath)}.${nanoid(8)}${TMP_SUFFIX}`)
  try {
    await fs.writeFile(tmpPath, data, 'utf-8')
    await fs.rename(tmpPath, fullPath)
  } catch (err) {
    await fs.rm(tmpPath, { force: true })
    throw err
  }
}

async function readFile(fullPath: string): Promise<string | null> {
  try {
    return await fs.readFile(fullPath, 'utf-8')
  } catch (err: any) {
    if (err.code === 'ENOENT') return null
    throw err
  }
}

export class FsAdapter implements StorageAdapter {
  constructor(private basePath: string) {}

  private resolve(filePath: string): string {
    // Absolute, so the write queues of two adapters on the same folder share their keys
    return path.resolve(path.join(this.basePath, filePath))
  }

  async read(filePath: string): Promise<string | null> {
    return readFile(this.resolve(filePath))
  }

  async write(filePath: string, data: string): Promise<void> {
    const fullPath = this.resolve(filePath)
    await serialised(fullPath, () => writeAtomic(fullPath, data))
  }

  async readVersioned(filePath: string): Promise<VersionedRead> {
    const data = await readFile(this.resolve(filePath))
    return { data, version: data === null ? null : await versionOf(data) }
  }

  /**
   * Compare-and-swap within this process: check and write run under the path's
   * queue. Another process writing the same folder is not coordinated.
   */
  async writeIf(filePath: string, data: string, version: string | null): Promise<string | null> {
    const fullPath = this.resolve(filePath)
    return serialised(fullPath, async () => {
      const current = await readFile(fullPath)
      if ((current === null ? null : await versionOf(current)) !== version) return null
      await writeAtomic(fullPath, data)
      return versionOf(data)
    })
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
      // Temp files of writes in flight (or of a crashed process) are not content
      return entries.filter((entry) => !entry.endsWith(TMP_SUFFIX))
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
