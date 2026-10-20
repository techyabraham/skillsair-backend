import cron from 'node-cron'
import { getPayload } from 'payload'
import type { SanitizedConfig } from 'payload'
import { logger } from '../lib/logger.js'
import { disableAtPaystack, graceEndsAt, manualAccessEndsAt } from '../lib/billing.js'
import { inQuietHours } from '../lib/lifecycle/timing.js'
import { onLifecycleEvent } from '../lib/lifecycle/events.js'

interface SubscriptionDoc {
  id: number
  user: number | string | { id: number | string }
  plan: number | string | { id: number | string }
  course?: number | string | { id: number | string }
  status: 'active' | 'past_due' | 'cancelled' | 'expired'
  currentPeriodEnd: string | null
  lastFailedAt?: string | null
  paystackSubscriptionCode?: string | null
  paystackEmailToken?: string | null
  billing?: 'card' | 'manual' | null
}

async function programmeCompleted(payload: Awaited<ReturnType<typeof getPayload>>, userId: number | string, courseId: number | string | undefined): Promise<boolean> {
  if (courseId === undefined) return false
  const done = await payload.find({
    collection: 'enrollments',
    where: { and: [{ student: { equals: userId } }, { course: { equals: courseId } }, { status: { equals: 'completed' } }] },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  return done.totalDocs > 0
}

function relationId(value: SubscriptionDoc['user'] | undefined): number | string | undefined {
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
    // Month-by-month (transfer/OPay) plans keep access for the grace days after the paid month.
    if (doc.billing === 'manual' && manualAccessEndsAt(doc.currentPeriodEnd) > Date.now()) continue
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
    const courseId = relationId(doc.course)
    if (!(await programmeCompleted(payload, userId, courseId))) {
      await onLifecycleEvent(payload, { type: 'access_ended', userId: Number(userId), courseId: courseId === undefined ? undefined : Number(courseId), subscriptionId: doc.id, reason: 'lapsed' })
    }
  }

  logger.info({ checked: stale.totalDocs, reconciled }, 'subscription_renewal_reconciliation_complete')
}

/**
 * A failed renewal keeps access for the grace days (see billing.ts). When they're over, access
 * pauses: the subscription expires, Paystack is told to stop it (so it can't charge a month
 * later without warning), and the win-back emails start.
 */
export async function expireGracePeriods(config: Promise<SanitizedConfig> | SanitizedConfig, now = Date.now()): Promise<number> {
  const payload = await getPayload({ config })
  const pastDue = await payload.find({ collection: 'subscriptions', where: { status: { equals: 'past_due' } }, depth: 0, limit: 500, overrideAccess: true })
  let ended = 0
  for (const doc of pastDue.docs as unknown as SubscriptionDoc[]) {
    const end = graceEndsAt(doc.lastFailedAt)
    if (end && Date.parse(end) > now) continue
    await disableAtPaystack({ id: doc.id, paystackSubscriptionCode: doc.paystackSubscriptionCode, paystackEmailToken: doc.paystackEmailToken }, 'grace_expired')
    await payload.update({ collection: 'subscriptions', id: doc.id, data: { status: 'expired' }, overrideAccess: true })
    ended += 1
    const userId = relationId(doc.user)
    const courseId = relationId(doc.course)
    if (userId !== undefined && !(await programmeCompleted(payload, userId, courseId))) {
      await onLifecycleEvent(payload, { type: 'access_ended', userId: Number(userId), courseId: courseId === undefined ? undefined : Number(courseId), subscriptionId: doc.id, reason: 'grace_expired' })
    }
  }
  if (ended) logger.info({ checked: pastDue.totalDocs, ended }, 'subscription_grace_expiry_complete')
  return ended
}

/** How many days before a month-by-month plan's paid month ends the "next month is due" email goes. */
export const MANUAL_REMINDER_DAYS = 3

/**
 * Month-by-month (transfer/OPay) plans can't renew by themselves, so learners are reminded:
 * T10 a few days before the paid month ends, T11 once it has ended (during the grace days).
 * Each goes once per paid month (lifecycle idempotency). Nothing is sent to learners who have
 * finished the programme or cancelled, or outside 8am–8pm Lagos time.
 */
export async function remindManualPayments(config: Promise<SanitizedConfig> | SanitizedConfig, now = Date.now()): Promise<number> {
  if (inQuietHours(now)) return 0
  const payload = await getPayload({ config })
  const due = await payload.find({
    collection: 'subscriptions',
    where: {
      and: [
        { billing: { equals: 'manual' } },
        { status: { equals: 'active' } },
        { currentPeriodEnd: { less_than: new Date(now + MANUAL_REMINDER_DAYS * 86_400_000).toISOString() } },
      ],
    },
    depth: 0,
    limit: 500,
    overrideAccess: true,
  })
  let reminded = 0
  for (const doc of due.docs as unknown as SubscriptionDoc[]) {
    if (!doc.currentPeriodEnd) continue
    const end = Date.parse(doc.currentPeriodEnd)
    if (manualAccessEndsAt(doc.currentPeriodEnd) <= now) continue // grace over: reconcile expires it
    const userId = relationId(doc.user)
    if (userId === undefined || (await programmeCompleted(payload, userId, relationId(doc.course)))) continue
    await onLifecycleEvent(payload, { type: 'manual_payment_due', subscriptionId: doc.id, due: end > now ? 'soon' : 'grace', periodEnd: doc.currentPeriodEnd })
    reminded += 1
  }
  if (reminded) logger.info({ checked: due.totalDocs, reminded }, 'manual_payment_reminders_sent')
  return reminded
}

export function registerSubscriptionRenewalJob(config: Promise<SanitizedConfig> | SanitizedConfig): void {
  cron.schedule('0 2 * * *', () => {
    reconcileExpiredSubscriptions(config).catch((err: unknown) => {
      logger.error({ err }, 'subscription_renewal_job_failed')
    })
  })
  // Hourly, so access pauses close to the end of the grace period rather than up to a day late.
  cron.schedule('20 * * * *', () => {
    expireGracePeriods(config).catch((err: unknown) => {
      logger.error({ err }, 'subscription_grace_job_failed')
    })
  })
  // Hourly; the reminders themselves are idempotent, so each goes once per paid month.
  cron.schedule('40 * * * *', () => {
    remindManualPayments(config).catch((err: unknown) => {
      logger.error({ err }, 'manual_payment_reminder_job_failed')
    })
  })
}
