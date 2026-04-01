declare module 'solid-js' {
  export type Accessor<T> = () => T
  export type Setter<T> = (fn: () => T) => void
  export function createSignal<T>(value: T): [Accessor<T>, Setter<T>]
  export function onCleanup(fn: () => void): void
}
