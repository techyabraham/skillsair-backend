import { getPayload, type Payload, type SanitizedConfig } from 'payload'
import { sql } from '@payloadcms/db-postgres'
import { jobScheduler } from './scheduler.js'
import { withLock } from '../lib/locks.js'
import { logger } from '../lib/logger.js'
import { approveDueCommissions } from '../lib/ambassadors/ledger.js'
import { recordCommissionForOrder } from '../lib/ambassadors/commissions.js'
import { sendCommissionApprovedEmail } from '../lib/ambassadors/emails.js'
import { relationId } from '../lib/course-access.js'

const cron = jobScheduler('ambassador-commissions')
/** Exported for deterministic integration checks; the scheduler and manual checks use the same lock. */
export async function runAmbassadorCommissions(payload: Payload, now = new Date()): Promise<{ approved: number; repaired: number } | null> {
  return withLock('job:ambassador-commissions', 840, async () => {
    const grouped = await approveDueCommissions(payload, now, 500)
    for (const group of grouped) {
      try {
        const ambassador = await payload.findByID({ collection: 'ambassadors', id: group.ambassadorId, depth: 0, overrideAccess: true })
        const user = await payload.findByID({ collection: 'users', id: Number(relationId(ambassador.user)), depth: 0, overrideAccess: true })
        const amount = group.entries.reduce((sum, row) => sum + row.amountKobo, 0)
        await sendCommissionApprovedEmail(String(user.email), amount, group.ambassadorId)
      } catch { logger.error({ ambassadorId: group.ambassadorId }, 'ambassador_approval_notification_failed') }
    }
    const db = payload.db as unknown as { drizzle: { execute(q: ReturnType<typeof sql>): Promise<{ rows: Array<{ id: number }> }> } }
    let cursor = 0
    let repaired = 0
    for (;;) {
      const { rows } = await db.drizzle.execute(sql`
        SELECT o.id FROM orders o
        LEFT JOIN ambassador_ledger l ON l.idempotency_key = 'commission:order:' || o.id::text
        WHERE o.status = 'success' AND o.fulfilled_at IS NOT NULL AND o.paid_at >= ${new Date(now.getTime() - 14 * 86400000).toISOString()}
          AND o.id > ${cursor} AND l.id IS NULL
        ORDER BY o.id LIMIT 500`)
      if (!rows.length) break
      for (const row of rows) {
        try {
          await recordCommissionForOrder(payload, Number(row.id))
          const count = await payload.count({ collection: 'ambassador-ledger', where: { idempotencyKey: { equals: 'commission:order:' + row.id } }, overrideAccess: true })
          repaired += count.totalDocs ? 1 : 0
        } catch { logger.error({ orderId: row.id }, 'ambassador_commission_repair_failed') }
      }
      cursor = Number(rows[rows.length - 1]!.id)
    }
    const approved = grouped.reduce((sum, group) => sum + group.entries.length, 0)
    logger.info({ approved, repaired }, 'ambassador_commissions_job_completed')
    return { approved, repaired }
  })
}
export function registerAmbassadorCommissionsJob(config: Promise<SanitizedConfig> | SanitizedConfig): void {
  cron.schedule('*/15 * * * *', async () => {
    try { await runAmbassadorCommissions(await getPayload({ config })) }
    catch { logger.error('ambassador_commissions_job_failed') }
  })
}
