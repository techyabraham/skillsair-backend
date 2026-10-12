import { Redis } from 'ioredis'
import { logger } from './logger.js'

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379'

export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  // Avoid opening sockets just by importing the Payload config (e.g. during
  // builds and import-map generation). ioredis connects on the first command.
  lazyConnect: true,
})

redis.on('error', (err: Error) => {
  logger.error({ err }, 'redis_connection_error')
})

const PREFIX = {
  blacklist: 'blacklist:',
  passwordReset: 'pwreset:',
  idempotency: 'idempotency:',
  failedLogin15m: 'failedlogin15m:',
  failedLogin1h: 'failedlogin1h:',
  forgotPasswordThrottle: 'fpthrottle:',
  rateLimit: 'ratelimit:',
} as const

/** Blacklists a JWT (by its raw value) until its own expiry elapses. */
export async function blacklistToken(token: string, ttlSeconds: number): Promise<void> {
  if (ttlSeconds <= 0) return
  await redis.set(`${PREFIX.blacklist}${token}`, '1', 'EX', ttlSeconds)
}

export async function isTokenBlacklisted(token: string): Promise<boolean> {
  const result = await redis.get(`${PREFIX.blacklist}${token}`)
  return result !== null
}

export async function storePasswordResetToken(hashedToken: string, userId: number): Promise<void> {
  await redis.set(`${PREFIX.passwordReset}${hashedToken}`, String(userId), 'EX', 3600)
}

export async function getPasswordResetUserId(hashedToken: string): Promise<number | null> {
  const result = await redis.get(`${PREFIX.passwordReset}${hashedToken}`)
  return result ? Number(result) : null
}

export async function deletePasswordResetToken(hashedToken: string): Promise<void> {
  await redis.del(`${PREFIX.passwordReset}${hashedToken}`)
}

/** Returns true if this is the first time we've seen this idempotency key (and marks it seen). */
export async function claimIdempotencyKey(key: string, ttlSeconds = 86400): Promise<boolean> {
  const result = await redis.set(`${PREFIX.idempotency}${key}`, '1', 'EX', ttlSeconds, 'NX')
  return result === 'OK'
}

async function incrementWithExpiry(key: string, ttlSeconds: number): Promise<number> {
  const count = await redis.incr(key)
  if (count === 1) {
    await redis.expire(key, ttlSeconds)
  }
  return count
}

export interface LoginAttemptStatus {
  locked: boolean
  lockReason?: '15min' | '1hour'
  retryAfterSeconds?: number
}

/** Tracks failed login attempts: 5/15min => 15min lock, 10/1hr => 1hr lock. */
export async function recordFailedLogin(email: string): Promise<LoginAttemptStatus> {
  const key15 = `${PREFIX.failedLogin15m}${email}`
  const key1h = `${PREFIX.failedLogin1h}${email}`
  const [count15, count1h] = await Promise.all([
    incrementWithExpiry(key15, 15 * 60),
    incrementWithExpiry(key1h, 60 * 60),
  ])
  if (count1h >= 10) {
    const ttl = await redis.ttl(key1h)
    return { locked: true, lockReason: '1hour', retryAfterSeconds: Math.max(ttl, 0) }
  }
  if (count15 >= 5) {
    const ttl = await redis.ttl(key15)
    return { locked: true, lockReason: '15min', retryAfterSeconds: Math.max(ttl, 0) }
  }
  return { locked: false }
}

export async function getLoginLockStatus(email: string): Promise<LoginAttemptStatus> {
  const [count15, count1h] = await Promise.all([
    redis.get(`${PREFIX.failedLogin15m}${email}`),
    redis.get(`${PREFIX.failedLogin1h}${email}`),
  ])
  if (count1h && Number(count1h) >= 10) {
    const ttl = await redis.ttl(`${PREFIX.failedLogin1h}${email}`)
    return { locked: true, lockReason: '1hour', retryAfterSeconds: Math.max(ttl, 0) }
  }
  if (count15 && Number(count15) >= 5) {
    const ttl = await redis.ttl(`${PREFIX.failedLogin15m}${email}`)
    return { locked: true, lockReason: '15min', retryAfterSeconds: Math.max(ttl, 0) }
  }
  return { locked: false }
}

export async function clearFailedLogins(email: string): Promise<void> {
  await Promise.all([
    redis.del(`${PREFIX.failedLogin15m}${email}`),
    redis.del(`${PREFIX.failedLogin1h}${email}`),
  ])
}

/** Throttles forgot-password requests: 3 per email per hour. */
export async function canRequestPasswordReset(email: string): Promise<boolean> {
  const key = `${PREFIX.forgotPasswordThrottle}${email}`
  const count = await incrementWithExpiry(key, 60 * 60)
  return count <= 3
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  retryAfterSeconds: number
}

/** Generic fixed-window rate limiter keyed by an arbitrary identifier. */
export async function checkRateLimit(
  identifier: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const key = `${PREFIX.rateLimit}${identifier}`
  const count = await incrementWithExpiry(key, windowSeconds)
  const ttl = await redis.ttl(key)
  return {
    allowed: count <= limit,
    remaining: Math.max(limit - count, 0),
    retryAfterSeconds: Math.max(ttl, 0),
  }
}
