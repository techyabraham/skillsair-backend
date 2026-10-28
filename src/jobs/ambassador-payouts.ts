import { getPayload, type Payload, type SanitizedConfig } from 'payload'
import { jobScheduler } from './scheduler.js'
import { withLock } from '../lib/locks.js'
import { logger } from '../lib/logger.js'
import { reconcilePayout, type PayoutDoc } from '../lib/ambassadors/payouts.js'

const cron = jobScheduler('ambassador-payouts')

/** Reconcile pending transfers only; a previously attempted transfer is never initiated again. */
export async function runAmbassadorPayoutReconciliation(payload: Payload, now = new Date()): Promise<number | null> {
  return withLock('job:ambassador-payouts', 55 * 60, async () => {
    const cutoff = new Date(now.getTime() - 60 * 60 * 1000).toISOString()
    const result = await payload.find({
      collection: 'ambassador-payouts',
      where: { and: [{ status: { equals: 'processing' } }, { updatedAt: { less_than_equal: cutoff } }] },
      limit: 500,
      sort: 'updatedAt',
      depth: 0,
      overrideAccess: true,
    })
    let checked = 0
    for (const row of result.docs as unknown as PayoutDoc[]) {
      try {
        await reconcilePayout(payload, row, now)
        checked++
      } catch (error) {
        logger.error({ payoutId: row.id, error: error instanceof Error ? error.name : 'unknown' }, 'ambassador_payout_reconciliation_failed')
      }
    }
    logger.info({ checked }, 'ambassador_payout_reconciliation_completed')
    return checked
  })
}

export function registerAmbassadorPayoutsJob(config: Promise<SanitizedConfig> | SanitizedConfig): void {
  cron.schedule('0 * * * *', async () => {
    try { await runAmbassadorPayoutReconciliation(await getPayload({ config })) }
    catch (error) { logger.error({ error: error instanceof Error ? error.name : 'unknown' }, 'ambassador_payouts_job_failed') }
  })
}
