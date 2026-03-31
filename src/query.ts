import type { QueryFilter, QueryOptions } from './types.js'

function getNestedValue(obj: any, path: string): any {
  const parts = path.split('.')
  let current = obj
  for (const part of parts) {
    if (current == null) return undefined
    current = current[part]
  }
  return current
}

function matchesOperator(value: any, operator: string, operand: any): boolean {
  switch (operator) {
    case '$eq':
      return value === operand
    case '$ne':
      return value !== operand
    case '$gt':
      return value > operand
    case '$gte':
      return value >= operand
    case '$lt':
      return value < operand
    case '$lte':
      return value <= operand
    case '$in':
      return Array.isArray(operand) && operand.includes(value)
    case '$nin':
      return Array.isArray(operand) && !operand.includes(value)
    case '$contains':
      if (typeof value === 'string') return value.includes(operand)
      if (Array.isArray(value)) return value.includes(operand)
      return false
    case '$containsAll':
      return Array.isArray(value) && Array.isArray(operand) && operand.every((v: any) => value.includes(v))
    case '$containsAny':
      return Array.isArray(value) && Array.isArray(operand) && operand.some((v: any) => value.includes(v))
    case '$startsWith':
      return typeof value === 'string' && value.startsWith(operand)
    case '$endsWith':
      return typeof value === 'string' && value.endsWith(operand)
    case '$regex':
      if (typeof value !== 'string') return false
      const regex = operand instanceof RegExp ? operand : new RegExp(operand)
      return regex.test(value)
    case '$between':
      return Array.isArray(operand) && operand.length === 2 && value >= operand[0] && value <= operand[1]
    default:
      return false
  }
}

function matchesCondition(doc: any, key: string, condition: any): boolean {
  const value = getNestedValue(doc, key)

  if (condition === null || condition === undefined || typeof condition !== 'object' || condition instanceof RegExp || Array.isArray(condition)) {
    return value === condition
  }

  // Check if condition is an operator object (keys start with $)
  const keys = Object.keys(condition)
  if (keys.length > 0 && keys[0].startsWith('$')) {
    return keys.every(op => matchesOperator(value, op, condition[op]))
  }

  // Plain value equality
  return value === condition
}

export function matchesFilter(doc: any, filter: QueryFilter): boolean {
  for (const key of Object.keys(filter)) {
    if (key === '$or') {
      const conditions = filter.$or as QueryFilter[]
      if (!conditions.some(cond => matchesFilter(doc, cond))) return false
      continue
    }
    if (key === '$and') {
      const conditions = filter.$and as QueryFilter[]
      if (!conditions.every(cond => matchesFilter(doc, cond))) return false
      continue
    }
    if (key === '$not') {
      if (matchesFilter(doc, filter.$not as QueryFilter)) return false
      continue
    }
    if (key === '$path') {
      // Path mode filter — skip in query engine, handled by collection
      continue
    }
    if (!matchesCondition(doc, key, filter[key])) return false
  }
  return true
}

export function applyOptions<T extends Record<string, any>>(docs: T[], options: QueryOptions): T[] {
  let result = docs

  if (options.sort) {
    const sortEntries = Object.entries(options.sort)
    result = [...result].sort((a, b) => {
      for (const [field, dir] of sortEntries) {
        const aVal = getNestedValue(a, field)
        const bVal = getNestedValue(b, field)
        if (aVal < bVal) return -1 * dir
        if (aVal > bVal) return 1 * dir
      }
      return 0
    })
  }

  if (options.skip) {
    result = result.slice(options.skip)
  }

  if (options.limit) {
    result = result.slice(0, options.limit)
  }

  if (options.select) {
    const fields = options.select
    result = result.map(doc => {
      const picked: any = {}
      if ('_id' in doc) picked._id = doc._id
      for (const f of fields) {
        if (f in doc) picked[f] = doc[f]
      }
      return picked
    })
  }

  return result
}
