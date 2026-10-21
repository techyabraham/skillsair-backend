/**
 * Per-request batch loading for list-table cells (brief 12: no N+1 queries in lists).
 * Every cell on a page asks for the related record it needs; the loader waits one tick, then
 * fetches all requested ids for that collection in ONE query. React's `cache` scopes the batch
 * to the current server render, so nothing is shared between requests or people.
 *
 * Cells receive `payload` but not the signed-in user, so loaders are only used on lists that
 * are already restricted to people allowed to see what is loaded (see each cell's comment).
 */
import { cache } from 'react'
import type { Payload } from 'payload'

type Fetch<V> = (ids: Array<number | string>) => Promise<Map<string, V>>

interface Loader<V> {
  load: (id: number | string | null | undefined) => Promise<V | undefined>
}

const registry = cache(() => new Map<string, Loader<unknown>>())

export function batchLoader<V>(name: string, fetch: Fetch<V>): Loader<V> {
  const loaders = registry()
  const existing = loaders.get(name) as Loader<V> | undefined
  if (existing) return existing
  let pending = new Set<string>()
  let batch: Promise<Map<string, V>> | null = null
  const results = new Map<string, V>()
  const loader: Loader<V> = {
    async load(id) {
      if (id === null || id === undefined || id === '') return undefined
      const key = String(id)
      if (results.has(key)) return results.get(key)
      pending.add(key)
      if (!batch) {
        batch = new Promise<Map<string, V>>((resolve) => {
          // Wait for the other cells on the page to register their ids, then run one query.
          setTimeout(() => {
            const ids = [...pending]
            pending = new Set()
            batch = null
            fetch(ids.map((value) => (/^\d+$/.test(value) ? Number(value) : value)))
              .then((map) => {
                for (const [k, v] of map) results.set(k, v)
                resolve(map)
              })
              // A cell's extra detail (a name, a count) must never take the whole list down:
              // on a failed lookup the cells simply show "–".
              .catch(() => resolve(new Map()))
          }, 0)
        })
      }
      await batch
      return results.get(key)
    },
  }
  loaders.set(name, loader as Loader<unknown>)
  return loader
}

/** Loads `select`ed fields of documents by id, one query per collection per page. */
export function docLoader<V extends Record<string, unknown>>(payload: Payload, collection: string, select: Record<string, true>) {
  return batchLoader<V>(`doc:${collection}:${Object.keys(select).join(',')}`, async (ids) => {
    const result = await payload.find({
      collection: collection as never,
      where: { id: { in: ids } },
      limit: ids.length,
      depth: 0,
      pagination: false,
      overrideAccess: true,
      select: select as never,
    })
    return new Map((result.docs as unknown as Array<V & { id: number | string }>).map((doc) => [String(doc.id), doc]))
  })
}

export const relId = (value: unknown): number | string | null => {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'object') return ((value as { id?: number | string }).id ?? null) as number | string | null
  return value as number | string
}
