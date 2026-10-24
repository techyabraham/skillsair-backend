/**
 * Scheduled jobs with a Redis lock, so each run happens on exactly one machine even with several
 * worker (or API) instances. Drop-in for node-cron: `const cron = jobScheduler('lifecycle')`.
 */
import { captureError } from '../lib/observability.js'
import nodeCron from 'node-cron'
import { randomUUID } from 'node:crypto'
import { redis } from '../lib/redis.js'
import { logger } from '../lib/logger.js'

const LOCK_SECONDS = 15 * 60

/** Takes the lock for one run; false if another instance holds it. */
async function acquire(key: string, token: string): Promise<boolean> {
  try {
    return (await redis.set(key, token, 'EX', LOCK_SECONDS, 'NX')) === 'OK'
  } catch (err) {
    // Without Redis there's no coordination: run here (single-instance deployments keep working).
    logger.warn({ err, key }, 'job_lock_unavailable')
    return true
  }
}

async function release(key: string, token: string): Promise<void> {
  try {
    // Only the holder releases (a run that outlived its lock mustn't release someone else's).
    await redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, key, token)
  } catch {
    // the lock expires on its own
  }
}

export function jobScheduler(name: string) {
  return {
    schedule(expression: string, task: () => unknown, options?: Parameters<typeof nodeCron.schedule>[2]) {
      const key = `job-lock:${name}:${expression}`
      return nodeCron.schedule(expression, async () => {
        const token = randomUUID()
        if (!(await acquire(key, token))) return
        try {
          await task()
        } catch (err) {
          logger.error({ err, job: name, expression }, 'scheduled_job_failed')
          captureError(err, { source: 'job', job: name })
        } finally {
          await release(key, token)
        }
      }, options)
    },
  }
}

/** Which process runs scheduled jobs: APP_ROLE=worker (recommended) or the API when APP_ROLE is unset. */
export function runsScheduledJobs(): boolean {
  const role = (process.env.APP_ROLE ?? '').toLowerCase()
  if (role === 'worker') return true
  if (role === 'api') return false
  // Unset: the API keeps running jobs (single-instance deployments), as before.
  return process.env.NODE_ENV === 'production'
}
