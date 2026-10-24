/**
 * Drive streaming health: counts video plays and Drive "download quota exceeded" errors per hour in
 * Redis. The monitoring job alerts the owner when quota errors pass 1% of plays in an hour.
 */
import { redis } from './redis.js'

const hourKey = (kind: 'plays' | 'quota', at = Date.now()) => `drive-health:${kind}:${new Date(at).toISOString().slice(0, 13)}`
const TWO_DAYS = 2 * 86_400

async function bump(kind: 'plays' | 'quota'): Promise<void> {
  try {
    const key = hourKey(kind)
    await redis.multi().incr(key).expire(key, TWO_DAYS).exec()
  } catch {
    // monitoring must never break streaming
  }
}

export const notePlay = () => bump('plays')
export const noteQuotaError = () => bump('quota')

/** Plays and quota errors in the hour before `at` (the last complete hour by default). */
export async function driveHealthForHour(at = Date.now() - 3_600_000): Promise<{ hour: string; plays: number; quotaErrors: number; rate: number }> {
  const [plays, quota] = await Promise.all([redis.get(hourKey('plays', at)), redis.get(hourKey('quota', at))]).catch(() => [null, null])
  const p = Number(plays ?? 0)
  const q = Number(quota ?? 0)
  return { hour: new Date(at).toISOString().slice(0, 13), plays: p, quotaErrors: q, rate: p ? q / p : 0 }
}
