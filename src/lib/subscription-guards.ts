import type { Payload } from 'payload'
import { AppError } from '../types/index.js'
import { assertPlanPurchasable, getScholarshipWindow, windowIsOpen } from './pricing.js'
import { getPriceLock } from './price-lock.js'
import { manualAccessEndsAt } from './billing.js'
import { relationId } from './leads.js'

/** A scholarship plan needs an open window or the learner's price lock for that programme. */
export async function assertCanStartPlan(payload: Payload, plan: { kind?: string | null; course?: unknown }, userId: number): Promise<void> {
  if (plan.kind !== 'scholarship') return
  const open = windowIsOpen(await getScholarshipWindow(payload))
  if (open) return
  const courseId = Number(relationId(plan.course))
  const lock = courseId ? await getPriceLock(payload, userId, courseId) : { locked: false }
  assertPlanPurchasable(plan, open, { priceLocked: lock.locked })
}

export interface ManualSubscription {
  id: number
  status: string
  currentPeriodEnd: string | null
}

/** How early a month-by-month learner can pay for their next month (before the current one ends). */
export const MANUAL_RENEWAL_WINDOW_DAYS = 7

/**
 * The learner's month-by-month (transfer/OPay) plan for this programme that can still be renewed:
 * active (paid up or inside its grace days) or cancelled but still running.
 */
export async function findRenewableManualSubscription(payload: Payload, userId: number, courseId: number, now = Date.now()): Promise<ManualSubscription | null> {
  const result = await payload.find({
    collection: 'subscriptions',
    where: { and: [{ user: { equals: userId } }, { course: { equals: courseId } }, { billing: { equals: 'manual' } }, { status: { in: ['active', 'cancelled'] } }] },
    sort: '-currentPeriodEnd',
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const doc = result.docs[0] as unknown as ManualSubscription | undefined
  if (!doc) return null
  return manualAccessEndsAt(doc.currentPeriodEnd) > now ? doc : null
}

const lagosDay = (value: string | number) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', timeZone: 'Africa/Lagos' }).format(new Date(value))

/**
 * A month-by-month learner can pay for the next month in the last few days of the current one
 * (or during the grace days after it). Earlier than that is refused, so nobody pays twice by
 * accident; switching to card waits until the paid month ends.
 */
export function assertManualRenewalAllowed(subscription: ManualSubscription, method: 'manual' | 'card', now = Date.now()): void {
  const end = subscription.currentPeriodEnd ? Date.parse(subscription.currentPeriodEnd) : 0
  if (method === 'card') {
    if (end > now) throw new AppError('ALREADY_EXISTS', `You've paid until ${lagosDay(end)} by transfer or OPay. To switch to card, choose Paystack after ${lagosDay(end)}, or pay the next month by transfer or OPay.`)
    return
  }
  const opens = end - MANUAL_RENEWAL_WINDOW_DAYS * 86_400_000
  if (opens > now) throw new AppError('ALREADY_EXISTS', `You've paid until ${lagosDay(end)}. You can pay for the next month from ${lagosDay(opens)}; we'll remind you.`)
}

/**
 * Don't double-charge: a learner who still has paid-up access to this programme (an active
 * plan, or a cancelled one that runs to the end of its month) can't start a second plan for it.
 * A plan whose renewal failed (past_due) or that has ended can be replaced: Paystack doesn't
 * retry failed renewals, so paying again is how a learner gets back in, and the old plan is
 * switched off once the new one is paid (see order fulfilment).
 */
export async function assertNoCurrentSubscription(payload: Payload, userId: number, courseId: number): Promise<void> {
  const current = await payload.find({
    collection: 'subscriptions',
    where: {
      and: [
        { user: { equals: userId } },
        { course: { equals: courseId } },
        { status: { in: ['active', 'cancelled'] } },
        { currentPeriodEnd: { greater_than: new Date().toISOString() } },
      ],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const subscription = current.docs[0] as unknown as { status: string; currentPeriodEnd: string } | undefined
  if (!subscription) return
  if (subscription.status === 'active') throw new AppError('ALREADY_EXISTS', 'You already have a plan for this programme.')
  const until = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', timeZone: 'Africa/Lagos' }).format(new Date(subscription.currentPeriodEnd))
  throw new AppError('ALREADY_EXISTS', `You still have access to this programme until ${until}. You can restart at the same rate after that.`)
}
