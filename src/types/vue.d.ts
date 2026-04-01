declare module 'vue' {
  export interface Ref<T = any> {
    value: T
  }
  export function ref<T>(value: T): Ref<T>
  export function onUnmounted(fn: () => void): void
}
