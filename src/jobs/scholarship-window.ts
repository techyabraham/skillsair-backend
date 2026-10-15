import cron from 'node-cron'
import { getPayload } from 'payload'
import type { SanitizedConfig } from 'payload'
import { logger } from '../lib/logger.js'
import { notifyWaitlist } from '../lib/lead-followups.js'

/** Every 15 minutes: when a new scholarship window has opened, tell consenting waitlist leads. */
export function registerScholarshipWindowJob(config: Promise<SanitizedConfig> | SanitizedConfig): void {
  cron.schedule('*/15 * * * *', async () => {
    try {
      const sent = await notifyWaitlist(await getPayload({ config }))
      if (sent) logger.info({ sent }, 'waitlist_notified')
    } catch (err) {
      logger.error({ err }, 'scholarship_window_job_failed')
    }
  })
}
