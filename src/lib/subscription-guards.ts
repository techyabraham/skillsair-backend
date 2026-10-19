import type { Payload } from 'payload'
import { AppError } from '../types/index.js'
import { assertPlanPurchasable, getScholarshipWindow, windowIsOpen } from './pricing.js'
import { getPriceLock } from './price-lock.js'
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
