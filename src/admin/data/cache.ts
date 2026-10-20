/**
 * A tiny per-process TTL cache for Studio aggregates (brief 7.1). Keys must never contain
 * per-user data unless the user id is part of the key; business-wide aggregates are shared by
 * every admin, instructor aggregates are keyed by instructor id.
 */
const DEFAULT_TTL_MS = 60_000

interface Entry {
  value: unknown
  storedAt: number
  expiresAt: number
}

const store = new Map<string, Entry>()
const inflight = new Map<string, Promise<unknown>>()

export interface Cached<T> {
  value: T
  /** When the value was computed (ms since epoch). */
  storedAt: number
}

export async function cached<T>(key: string, compute: () => Promise<T>, ttlMs = DEFAULT_TTL_MS): Promise<Cached<T>> {
  const now = Date.now()
  const hit = store.get(key)
  if (hit && hit.expiresAt > now) return { value: hit.value as T, storedAt: hit.storedAt }
  const running = inflight.get(key) as Promise<T> | undefined
  if (running) return { value: await running, storedAt: now }
  const promise = compute()
  inflight.set(key, promise)
  try {
    const value = await promise
    store.set(key, { value, storedAt: now, expiresAt: now + ttlMs })
    return { value, storedAt: now }
  } finally {
    inflight.delete(key)
  }
}

/** Drops every cached entry whose key starts with `prefix` (the dashboard's Refresh link). */
export function invalidate(prefix = ''): void {
  for (const key of store.keys()) if (key.startsWith(prefix)) store.delete(key)
}
