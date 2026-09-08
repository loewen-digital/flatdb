import { describe, it, expect } from 'vitest'
import { deepMerge } from '../src/merge.js'

describe('deepMerge', () => {
  it('merges nested objects and keeps untouched keys', () => {
    const result = deepMerge({ a: 1, settings: { theme: 'light', lang: 'en' } }, { settings: { theme: 'dark' } })
    expect(result).toEqual({ a: 1, settings: { theme: 'dark', lang: 'en' } })
  })

  it('replaces arrays and scalars instead of merging them', () => {
    expect(deepMerge({ tags: ['a', 'b'], n: 1 }, { tags: ['c'], n: 2 })).toEqual({ tags: ['c'], n: 2 })
  })

  it('replaces an object with null or a scalar, and a scalar with an object', () => {
    expect(deepMerge({ o: { x: 1 } }, { o: null })).toEqual({ o: null })
    expect(deepMerge({ o: { x: 1 } }, { o: 5 })).toEqual({ o: 5 })
    expect(deepMerge({ o: 5 }, { o: { x: 1 } })).toEqual({ o: { x: 1 } })
  })

  it('mutates and returns the target but not objects nested in it', () => {
    const nested = { x: 1 }
    const target = { o: nested }
    const result = deepMerge(target, { o: { y: 2 } })
    expect(result).toBe(target)
    expect(target.o).toEqual({ x: 1, y: 2 })
    expect(nested).toEqual({ x: 1 })
  })
})
