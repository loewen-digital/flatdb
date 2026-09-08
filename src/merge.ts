/**
 * Merges `source` into `target` in place: nested plain objects merge
 * recursively (into copies, so objects reachable from `target` before the
 * call are not mutated), arrays and scalars replace. Returns `target`.
 */
export function deepMerge(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
  for (const key of Object.keys(source)) {
    const sv = source[key]
    const tv = target[key]
    if (isPlainObject(sv) && isPlainObject(tv)) {
      target[key] = deepMerge({ ...tv }, sv)
    } else {
      target[key] = sv
    }
  }
  return target
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
