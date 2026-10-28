/**
 * Vitest setup: the ioredis client is replaced by an in-memory one, so specs never need (or
 * touch) a Redis server. src/lib/redis.ts and its helpers run unchanged on top of it.
 */
import { vi } from 'vitest'

vi.mock('ioredis', async () => {
  const { FakeRedis } = await import('./fake-redis.js')
  return { Redis: FakeRedis, default: FakeRedis }
})
