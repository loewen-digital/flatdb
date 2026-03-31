export class EventEmitter {
  private listeners = new Set<() => void>()

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }

  emit(): void {
    for (const cb of this.listeners) {
      cb()
    }
  }

  get listenerCount(): number {
    return this.listeners.size
  }
}
