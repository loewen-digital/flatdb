import type { EventEmitter } from './emitter.js'

export type LiveErrorHandler = (error: unknown) => void

const logError: LiveErrorHandler = (error) => {
  console.error('[flatdb] live query failed', error)
}

/**
 * Delivers `query()` to `cb` now and again after every emit. A failing query or
 * a throwing callback reaches `onError` instead of becoming an unhandled
 * rejection, and the subscription stays alive either way.
 */
export function liveQuery<T>(
  emitter: EventEmitter,
  query: () => Promise<T>,
  cb: (value: T) => void,
  onError: LiveErrorHandler = logError,
): () => void {
  const run = () => query().then(cb).catch(onError)
  run()
  return emitter.subscribe(run)
}

/**
 * Async iterable over `query()`: the current result first, then one result per
 * emit that arrives while a `next()` is pending. A failing query rejects that
 * `next()` and ends the iteration; `return()` (a `break`) unsubscribes.
 */
export function watchQuery<T>(emitter: EventEmitter, query: () => Promise<T>): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      type Settle = { resolve: (result: IteratorResult<T>) => void; reject: (error: unknown) => void }
      const end: IteratorResult<T> = { value: undefined as any, done: true }
      let pending: Settle | null = null
      let first = true
      let done = false

      const finish = () => {
        if (done) return
        done = true
        unsub()
        pending?.resolve(end)
        pending = null
      }

      const run = ({ resolve, reject }: Settle) => {
        query().then(
          value => resolve({ value, done: false }),
          error => {
            finish()
            reject(error)
          },
        )
      }

      const unsub = emitter.subscribe(() => {
        if (!pending) return
        const settle = pending
        pending = null
        run(settle)
      })

      return {
        next() {
          if (done) return Promise.resolve(end)
          return new Promise<IteratorResult<T>>((resolve, reject) => {
            if (first) {
              first = false
              run({ resolve, reject })
            } else {
              pending = { resolve, reject }
            }
          })
        },
        return() {
          finish()
          return Promise.resolve(end)
        },
      }
    },
  }
}
