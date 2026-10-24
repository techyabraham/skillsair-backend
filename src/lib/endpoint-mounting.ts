/**
 * Payload routes /api/<collection-slug>/... to that collection's own routes, so a root endpoint
 * whose path starts with a collection slug (e.g. /courses/:courseId/enroll, /certificates/verify/:code)
 * is never reached and answers "Route not found". This moves each such root endpoint onto its
 * collection with the slug removed from the path: the public URL stays exactly the same.
 */
import type { CollectionConfig, Config, Endpoint } from 'payload'

export function mountPrefixedEndpoints(config: Config): Config {
  const collections = (config.collections ?? []) as CollectionConfig[]
  const slugs = new Set(collections.map((collection) => collection.slug))
  const moved = new Map<string, Endpoint[]>()
  const root: Endpoint[] = []
  for (const endpoint of (Array.isArray(config.endpoints) ? config.endpoints : []) as Endpoint[]) {
    const slug = /^\/([a-z0-9-]+)\//.exec(endpoint.path)?.[1]
    if (slug && slugs.has(slug)) moved.set(slug, [...(moved.get(slug) ?? []), { ...endpoint, path: endpoint.path.slice(slug.length + 1) }])
    else root.push(endpoint)
  }
  return {
    ...config,
    endpoints: root,
    collections: collections.map((collection) => {
      const extra = moved.get(collection.slug)
      if (!extra) return collection
      const own = Array.isArray(collection.endpoints) ? collection.endpoints : []
      return { ...collection, endpoints: [...own, ...extra] }
    }),
  }
}
