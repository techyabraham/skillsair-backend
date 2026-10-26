import type { SanitizedConfig } from 'payload'
import { getPayload } from 'payload'
import { jobScheduler } from './scheduler.js'
import { logger } from '../lib/logger.js'
import { computePaceSnapshot, queuePlanEmails } from '../lib/guided-plan-emails.js'
import { guidedPlanEnabled } from '../lib/guided-plan-service.js'

const cron = jobScheduler('guided-plan')
const LAGOS = { timezone: 'Africa/Lagos' }

/**
 * Guided 12-week plan (src/lib/guided-plan-emails.ts): Monday 07:30 Lagos queues L1 ("Your week N
 * plan"), Thursday 18:00 queues L2 ("You're a little behind"); the work queue sends them.
 * Nightly at 02:15 the pace snapshot for the Studio Overview is stored.
 */
export function registerGuidedPlanJob(config: Promise<SanitizedConfig> | SanitizedConfig): void {
  const run = (name: string, task: (payload: Awaited<ReturnType<typeof getPayload>>) => Promise<unknown>) => async () => {
    if (!guidedPlanEnabled()) return
    try {
      await task(await getPayload({ config }))
    } catch (err) {
      logger.error({ err, job: name }, 'guided_plan_job_failed')
    }
  }
  cron.schedule('30 7 * * 1', run('L1', (payload) => queuePlanEmails(payload, 'L1')), LAGOS)
  cron.schedule('0 18 * * 4', run('L2', (payload) => queuePlanEmails(payload, 'L2')), LAGOS)
  cron.schedule('15 2 * * *', run('pace-snapshot', (payload) => computePaceSnapshot(payload)), LAGOS)
}
