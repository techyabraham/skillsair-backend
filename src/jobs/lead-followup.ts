import cron from 'node-cron'
import { getPayload } from 'payload'
import type { Payload, SanitizedConfig } from 'payload'
import { logger } from '../lib/logger.js'
import { currentWindowContext, processLeadFollowUps, sendPaymentHelp } from '../lib/lead-followups.js'
import type { LeadDoc } from '../lib/leads.js'

/** Hourly: follow-up emails B–D, WhatsApp reminders (consent only, capped) and scoring. */
export async function runLeadFollowUps(payload: Payload): Promise<void> {
  const window = await currentWindowContext(payload)
  let page = 1
  let sent = 0
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
      try {
        sent += await processLeadFollowUps(payload, lead, window)
      } catch (err) {
        logger.error({ err, leadId: lead.id }, 'lead_followup_failed')
      }
    }
    if (!result.hasNextPage) break
    page++
  }

  // Paystack doesn't reliably send webhooks for failed charges: catch orders still pending after 2 hours.
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const pending = await payload.find({
    collection: 'orders',
    where: { and: [{ status: { equals: 'pending' } }, { type: { in: ['course', 'subscription'] } }, { createdAt: { less_than: twoHoursAgo } }, { createdAt: { greater_than: weekAgo } }] },
    limit: 500,
    depth: 0,
    overrideAccess: true,
  })
  for (const order of pending.docs) {
    try {
      await sendPaymentHelp(payload, Number(order.id))
    } catch (err) {
      logger.error({ err, orderId: order.id }, 'payment_help_failed')
    }
  }
  logger.info({ sent, pendingOrders: pending.totalDocs }, 'lead_followups_run')
}

export function registerLeadFollowUpJob(config: Promise<SanitizedConfig> | SanitizedConfig): void {
  cron.schedule('5 * * * *', async () => {
    try {
      await runLeadFollowUps(await getPayload({ config }))
    } catch (err) {
      logger.error({ err }, 'lead_followup_job_failed')
    }
  })
}
