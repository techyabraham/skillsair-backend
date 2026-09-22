import cron from 'node-cron'
import { getPayload } from 'payload'
import type { SanitizedConfig } from 'payload'
import { logger } from '../lib/logger.js'

interface SubscriptionDoc {
  id: number
  user: number | string | { id: number | string }
  plan: number | string | { id: number | string }
  status: 'active' | 'cancelled' | 'expired'
  currentPeriodEnd: string | null
}

function relationId(value: SubscriptionDoc['user']): number | string | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'object' && 'id' in value) return value.id
  return value
}

async function reconcileExpiredSubscriptions(
  config: Promise<SanitizedConfig> | SanitizedConfig,
): Promise<void> {
  const payload = await getPayload({ config })

  const stale = await payload.find({
    collection: 'subscriptions',
    where: {
      and: [{ status: { equals: 'active' } }, { currentPeriodEnd: { less_than: new Date().toISOString() } }],
    },
    depth: 0,
    limit: 500,
    overrideAccess: true,
  })

  let reconciled = 0
  for (const doc of stale.docs as unknown as SubscriptionDoc[]) {
    const userId = relationId(doc.user)
    const planId = relationId(doc.plan)
    if (userId === undefined || planId === undefined) continue

    const renewed = await payload.find({
      collection: 'subscriptions',
      where: {
        and: [
          { user: { equals: userId } },
          { plan: { equals: planId } },
          { status: { equals: 'active' } },
          { currentPeriodEnd: { greater_than: doc.currentPeriodEnd ?? '' } },
        ],
      },
      limit: 1,
      overrideAccess: true,
    })
    if (renewed.totalDocs > 0) continue

    await payload.update({
      collection: 'subscriptions',
      id: doc.id,
      data: { status: 'expired' },
      overrideAccess: true,
    })
    reconciled += 1
  }

  logger.info({ checked: stale.totalDocs, reconciled }, 'subscription_renewal_reconciliation_complete')
}

export function registerSubscriptionRenewalJob(config: Promise<SanitizedConfig> | SanitizedConfig): void {
  cron.schedule('0 2 * * *', () => {
    reconcileExpiredSubscriptions(config).catch((err: unknown) => {
      logger.error({ err }, 'subscription_renewal_job_failed')
    })
  })
}
