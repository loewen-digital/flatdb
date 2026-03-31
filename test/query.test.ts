import { describe, it, expect } from 'vitest'
import { matchesFilter, applyOptions } from '../src/query.js'

describe('matchesFilter', () => {
  it('matches exact value', () => {
    expect(matchesFilter({ name: 'Max' }, { name: 'Max' })).toBe(true)
    expect(matchesFilter({ name: 'Max' }, { name: 'Alice' })).toBe(false)
  })

  it('matches empty filter (all docs)', () => {
    expect(matchesFilter({ name: 'Max' }, {})).toBe(true)
  })

  // Comparison operators
  it('$gt', () => {
    expect(matchesFilter({ age: 20 }, { age: { $gt: 18 } })).toBe(true)
    expect(matchesFilter({ age: 18 }, { age: { $gt: 18 } })).toBe(false)
  })

  it('$gte', () => {
    expect(matchesFilter({ age: 18 }, { age: { $gte: 18 } })).toBe(true)
    expect(matchesFilter({ age: 17 }, { age: { $gte: 18 } })).toBe(false)
  })

  it('$lt', () => {
    expect(matchesFilter({ age: 17 }, { age: { $lt: 18 } })).toBe(true)
    expect(matchesFilter({ age: 18 }, { age: { $lt: 18 } })).toBe(false)
  })

  it('$lte', () => {
    expect(matchesFilter({ age: 18 }, { age: { $lte: 18 } })).toBe(true)
    expect(matchesFilter({ age: 19 }, { age: { $lte: 18 } })).toBe(false)
  })

  it('$eq', () => {
    expect(matchesFilter({ x: 5 }, { x: { $eq: 5 } })).toBe(true)
    expect(matchesFilter({ x: 6 }, { x: { $eq: 5 } })).toBe(false)
  })

  it('$ne', () => {
    expect(matchesFilter({ x: 5 }, { x: { $ne: null } })).toBe(true)
    expect(matchesFilter({ x: null }, { x: { $ne: null } })).toBe(false)
  })

  it('$between', () => {
    expect(matchesFilter({ age: 25 }, { age: { $between: [18, 65] } })).toBe(true)
    expect(matchesFilter({ age: 10 }, { age: { $between: [18, 65] } })).toBe(false)
    expect(matchesFilter({ age: 18 }, { age: { $between: [18, 65] } })).toBe(true)
  })

  // Set operators
  it('$in', () => {
    expect(matchesFilter({ status: 'active' }, { status: { $in: ['active', 'pending'] } })).toBe(true)
    expect(matchesFilter({ status: 'deleted' }, { status: { $in: ['active', 'pending'] } })).toBe(false)
  })

  it('$nin', () => {
    expect(matchesFilter({ status: 'active' }, { status: { $nin: ['deleted'] } })).toBe(true)
    expect(matchesFilter({ status: 'deleted' }, { status: { $nin: ['deleted'] } })).toBe(false)
  })

  // String operators
  it('$contains on string', () => {
    expect(matchesFilter({ title: 'Hello World' }, { title: { $contains: 'World' } })).toBe(true)
    expect(matchesFilter({ title: 'Hello World' }, { title: { $contains: 'Foo' } })).toBe(false)
  })

  it('$startsWith', () => {
    expect(matchesFilter({ title: 'My Post' }, { title: { $startsWith: 'My' } })).toBe(true)
    expect(matchesFilter({ title: 'Your Post' }, { title: { $startsWith: 'My' } })).toBe(false)
  })

  it('$endsWith', () => {
    expect(matchesFilter({ title: 'Hello!' }, { title: { $endsWith: '!' } })).toBe(true)
    expect(matchesFilter({ title: 'Hello' }, { title: { $endsWith: '!' } })).toBe(false)
  })

  it('$regex', () => {
    expect(matchesFilter({ title: 'My Post' }, { title: { $regex: /^My.*Post$/ } })).toBe(true)
    expect(matchesFilter({ title: 'Not' }, { title: { $regex: /^My/ } })).toBe(false)
  })

  // Array operators
  it('$contains on array', () => {
    expect(matchesFilter({ tags: ['a', 'b'] }, { tags: { $contains: 'a' } })).toBe(true)
    expect(matchesFilter({ tags: ['a', 'b'] }, { tags: { $contains: 'c' } })).toBe(false)
  })

  it('$containsAll', () => {
    expect(matchesFilter({ tags: ['a', 'b', 'c'] }, { tags: { $containsAll: ['a', 'b'] } })).toBe(true)
    expect(matchesFilter({ tags: ['a'] }, { tags: { $containsAll: ['a', 'b'] } })).toBe(false)
  })

  it('$containsAny', () => {
    expect(matchesFilter({ tags: ['a'] }, { tags: { $containsAny: ['a', 'b'] } })).toBe(true)
    expect(matchesFilter({ tags: ['c'] }, { tags: { $containsAny: ['a', 'b'] } })).toBe(false)
  })

  // Dot-notation
  it('nested field with dot notation', () => {
    expect(matchesFilter({ settings: { theme: 'dark' } }, { 'settings.theme': 'dark' })).toBe(true)
    expect(matchesFilter({ settings: { theme: 'light' } }, { 'settings.theme': 'dark' })).toBe(false)
  })

  it('nested field with operator', () => {
    expect(matchesFilter({ meta: { views: 150 } }, { 'meta.views': { $gt: 100 } })).toBe(true)
  })

  // Logical operators
  it('$or', () => {
    expect(matchesFilter({ status: 'active' }, { $or: [{ status: 'active' }, { featured: true }] })).toBe(true)
    expect(matchesFilter({ featured: true }, { $or: [{ status: 'active' }, { featured: true }] })).toBe(true)
    expect(matchesFilter({ status: 'deleted' }, { $or: [{ status: 'active' }, { featured: true }] })).toBe(false)
  })

  it('$and', () => {
    expect(matchesFilter({ age: 25 }, { $and: [{ age: { $gt: 18 } }, { age: { $lt: 65 } }] })).toBe(true)
    expect(matchesFilter({ age: 10 }, { $and: [{ age: { $gt: 18 } }, { age: { $lt: 65 } }] })).toBe(false)
  })

  it('$not', () => {
    expect(matchesFilter({ status: 'active' }, { $not: { status: 'deleted' } })).toBe(true)
    expect(matchesFilter({ status: 'deleted' }, { $not: { status: 'deleted' } })).toBe(false)
  })

  it('multiple conditions (implicit AND)', () => {
    expect(matchesFilter({ name: 'Max', age: 25 }, { name: 'Max', age: { $gt: 18 } })).toBe(true)
    expect(matchesFilter({ name: 'Max', age: 15 }, { name: 'Max', age: { $gt: 18 } })).toBe(false)
  })
})

describe('applyOptions', () => {
  const docs = [
    { _id: '1', name: 'Charlie', age: 30 },
    { _id: '2', name: 'Alice', age: 25 },
    { _id: '3', name: 'Bob', age: 35 },
  ]

  it('sort ascending', () => {
    const result = applyOptions(docs, { sort: { name: 1 } })
    expect(result.map(d => d.name)).toEqual(['Alice', 'Bob', 'Charlie'])
  })

  it('sort descending', () => {
    const result = applyOptions(docs, { sort: { age: -1 } })
    expect(result.map(d => d.age)).toEqual([35, 30, 25])
  })

  it('limit', () => {
    const result = applyOptions(docs, { limit: 2 })
    expect(result).toHaveLength(2)
  })

  it('skip', () => {
    const result = applyOptions(docs, { skip: 1 })
    expect(result).toHaveLength(2)
  })

  it('skip + limit', () => {
    const sorted = applyOptions(docs, { sort: { name: 1 }, skip: 1, limit: 1 })
    expect(sorted).toHaveLength(1)
    expect(sorted[0].name).toBe('Bob')
  })

  it('select', () => {
    const result = applyOptions(docs, { select: ['name'] })
    expect(result[0]).toEqual({ _id: '1', name: 'Charlie' })
    expect(result[0]).not.toHaveProperty('age')
  })
})
