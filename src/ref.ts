import { z } from 'zod'

const REF_PREFIX = 'ref:'

export function ref(collection: string) {
  return z.string().transform((val) => val).brand<'ref'>()
    .describe(`ref:${collection}`)
}

export function serializeRef(collection: string, id: string): string {
  return `${REF_PREFIX}${collection}/${id}`
}

export function deserializeRef(value: string): { collection: string; id: string } | null {
  if (typeof value !== 'string' || !value.startsWith(REF_PREFIX)) return null
  const rest = value.slice(REF_PREFIX.length)
  const slashIndex = rest.indexOf('/')
  if (slashIndex === -1) return null
  return {
    collection: rest.slice(0, slashIndex),
    id: rest.slice(slashIndex + 1),
  }
}

export function isRef(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(REF_PREFIX)
}

export interface RefMeta {
  field: string
  collection: string
}

export function extractRefMeta(schema: z.ZodType): RefMeta[] {
  const refs: RefMeta[] = []

  if (schema instanceof z.ZodObject) {
    const shape = schema.shape
    for (const [field, fieldSchema] of Object.entries(shape)) {
      const collection = getRefCollection(fieldSchema as z.ZodType)
      if (collection) {
        refs.push({ field, collection })
      }
    }
  }

  return refs
}

function getRefCollection(schema: z.ZodType): string | null {
  const desc = schema.description
  if (desc && desc.startsWith('ref:')) {
    return desc.slice(4)
  }

  // Unwrap wrappers: optional, default, branded, array, etc.
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return getRefCollection((schema as any)._def.innerType)
  }
  if (schema instanceof z.ZodDefault) {
    return getRefCollection((schema as any)._def.innerType)
  }
  if (schema instanceof z.ZodBranded) {
    return getRefCollection((schema as any)._def.type)
  }
  if (schema instanceof z.ZodEffects) {
    return getRefCollection((schema as any)._def.schema)
  }
  if (schema instanceof z.ZodArray) {
    return getRefCollection((schema as any)._def.type)
  }

  return null
}

export function serializeRefs(doc: Record<string, any>, refMetas: RefMeta[]): Record<string, any> {
  const result = { ...doc }
  for (const { field, collection } of refMetas) {
    const value = result[field]
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      result[field] = value.map(v => typeof v === 'string' && !v.startsWith(REF_PREFIX) ? serializeRef(collection, v) : v)
    } else if (typeof value === 'string' && !value.startsWith(REF_PREFIX)) {
      result[field] = serializeRef(collection, value)
    }
  }
  return result
}

export function deserializeRefs(doc: Record<string, any>): Record<string, any> {
  const result = { ...doc }
  for (const [key, value] of Object.entries(result)) {
    if (isRef(value)) {
      const parsed = deserializeRef(value)
      if (parsed) result[key] = parsed.id
    } else if (Array.isArray(value)) {
      result[key] = value.map(v => {
        if (isRef(v)) {
          const parsed = deserializeRef(v)
          return parsed ? parsed.id : v
        }
        return v
      })
    }
  }
  return result
}

export type RefResolver = (collection: string, id: string) => Promise<Record<string, any> | null>

export async function populateDoc(
  doc: Record<string, any>,
  populate: string[] | Record<string, any>,
  resolver: RefResolver,
): Promise<Record<string, any>> {
  const result = { ...doc }
  const fields = Array.isArray(populate) ? populate : Object.keys(populate)

  for (const field of fields) {
    const rawValue = result[field]
    if (rawValue === undefined || rawValue === null) continue

    if (Array.isArray(rawValue)) {
      result[field] = await Promise.all(
        rawValue.map(async (v) => {
          if (typeof v !== 'string') return v
          const parsed = deserializeRef(v)
          if (!parsed) return v
          const resolved = await resolver(parsed.collection, parsed.id)
          return resolved ?? v
        }),
      )
    } else if (typeof rawValue === 'string') {
      const parsed = deserializeRef(rawValue)
      if (parsed) {
        const resolved = await resolver(parsed.collection, parsed.id)
        if (resolved) result[field] = resolved
      }
    }
  }

  return result
}
