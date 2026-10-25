import { logger } from '../lib/logger.js'
import { OVERRIDE_VERSION_KEY } from './override-store.js'

/** Tells every process (API, worker, Studio) to reload the published email wording. Never throws. */
export async function bumpOverrideVersion(): Promise<void> {
  try {
    const { redis } = await import('../lib/redis.js')
    await redis.incr(OVERRIDE_VERSION_KEY)
  } catch (err) {
    // Without Redis the other processes still reload within 5 minutes.
    logger.warn({ err }, 'email_overrides_version_bump_failed')
  }
}
