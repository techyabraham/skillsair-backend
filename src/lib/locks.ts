import { randomUUID } from 'node:crypto'
import { redis } from './redis.js'

const RELEASE_IF_OWNER = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end"

/**
 * Runs fn while holding a Redis lock (SET NX EX), so only one instance does the work at a time.
 * Returns null without running fn when someone else holds the lock. The lock is released only by
 * its holder (compare-and-delete), so a run that outlived its TTL never frees another's lock.
 * Redis errors propagate: without a lock, nothing runs.
 */
export async function withLock<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T | null> {
  const token = randomUUID()
  if (await redis.set(key, token, 'EX', ttlSeconds, 'NX') !== 'OK') return null
  try {
    return await fn()
  } finally {
    await redis.eval(RELEASE_IF_OWNER, 1, key, token)
  }
}
