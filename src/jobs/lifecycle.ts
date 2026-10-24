import { jobScheduler } from './scheduler.js'

const cron = jobScheduler('lifecycle')
import { getPayload } from 'payload'
import type { Payload, SanitizedConfig } from 'payload'
import { logger } from '../lib/logger.js'
import { currentWindowContext, scoreLead } from '../lib/lead-followups.js'
import { runLifecycle, type LifecycleSummary } from '../lib/lifecycle/engine.js'
import type { LeadDoc } from '../lib/leads.js'

/**
 * Hourly (at :05): lead scoring, then the lifecycle engine, which sends every due step of
 * every track (pre-payment, checkout help, learning nudges, win-back, certificate, next
 * programme), within consent, caps and quiet hours. Dry-run unless LIFECYCLE_DRY_RUN=false.
 */
export async function runLifecycleJob(payload: Payload, now = Date.now()): Promise<LifecycleSummary> {
  const window = await currentWindowContext(payload)
  let page = 1
  for (;;) {
    const result = await payload.find({
      collection: 'leads',
      where: { status: { in: ['new', 'contacted', 'offer_viewed', 'account_created'] } },
      sort: 'createdAt',
      limit: 200,
      page,
      depth: 0,
      overrideAccess: true,
    })
    for (const lead of result.docs as unknown as LeadDoc[]) {
      await scoreLead(payload, lead, window, now).catch((err: unknown) => logger.error({ err, leadId: lead.id }, 'lead_scoring_failed'))
    }
    if (!result.hasNextPage) break
    page++
  }
  return runLifecycle(payload, now)
}

export function registerLifecycleJob(config: Promise<SanitizedConfig> | SanitizedConfig): void {
  cron.schedule('5 * * * *', async () => {
    try {
      await runLifecycleJob(await getPayload({ config }))
    } catch (err) {
      logger.error({ err }, 'lifecycle_job_failed')
    }
  })
}
