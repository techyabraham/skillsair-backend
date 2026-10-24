import type { Payload } from 'payload'
import { logger } from './logger.js'
import { addDays } from '../utils/date-helpers.js'
import { issueCertificate } from '../hooks/courses/afterComplete.js'
import { relationId } from './course-access.js'
import { redis } from './redis.js'
import { randomUUID } from 'node:crypto'
import { applyLeadEvent, findLeadForUser } from './leads.js'
import { disableAtPaystack } from './billing.js'
import { findRenewableManualSubscription } from './subscription-guards.js'
import { onLifecycleEvent } from './lifecycle/events.js'
import { ensureBonusEnrollments } from './bonus-access.js'

/**
 * A learner whose renewal failed (or whose plan lapsed) restarts by paying again, which creates
 * a new subscription. The old one is switched off at Paystack so it can never charge as well.
 * A month-by-month (transfer/OPay) plan whose month has ended is closed the same way when the
 * learner starts a new plan (for example, switching to card during the grace days).
 */
async function replaceOlderSubscriptions(payload: Payload, userId: number | string, courseId: number | string, keepId: number | string): Promise<number[]> {
  const older = await payload.find({
    collection: 'subscriptions',
    where: {
      and: [
        { user: { equals: userId } },
        { course: { equals: courseId } },
        { id: { not_equals: keepId } },
        {
          or: [
            { status: { in: ['past_due', 'expired'] } },
            { and: [{ billing: { equals: 'manual' } }, { status: { in: ['active', 'cancelled'] } }, { currentPeriodEnd: { less_than: new Date().toISOString() } }] },
          ],
        },
      ],
    },
    limit: 20,
    depth: 0,
    overrideAccess: true,
  })
  const replaced: number[] = []
  for (const doc of older.docs as unknown as Array<{ id: number; status: string; billing?: string | null; paystackSubscriptionCode?: string | null; paystackEmailToken?: string | null }>) {
    if (doc.billing === 'manual' && doc.status !== 'expired') {
      await payload.update({ collection: 'subscriptions', id: doc.id, data: { status: 'expired' }, overrideAccess: true })
    } else if (doc.status === 'past_due') {
      await disableAtPaystack(doc, 'replaced_by_new_subscription')
      await payload.update({ collection: 'subscriptions', id: doc.id, data: { status: 'expired' }, overrideAccess: true })
    }
    replaced.push(doc.id)
  }
  return replaced
}

/** A paid learner leaves the follow-up funnel: no more reminders, and out of Imisi's queue. */
async function markLeadPaid(payload: Payload, userId: number, email: string): Promise<void> {
  try {
    const lead = await findLeadForUser(payload, { id: userId, email, role: 'student' })
    if (!lead || lead.status === 'paid') return
    await applyLeadEvent(payload, lead, { type: 'paid' })
  } catch (err) {
    logger.error({ err, userId }, 'lead_mark_paid_failed')
  }
}

/** Can be retried safely after an order is marked paid. */
export async function fulfillOrder(payload: Payload, orderId: number | string): Promise<void> {
  const lockKey = `order-fulfillment:${orderId}`
  const token = randomUUID()
  if (await redis.set(lockKey, token, 'EX', 600, 'NX') !== 'OK') return
  try {
    await fulfillLockedOrder(payload, orderId)
  } finally {
    await redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, lockKey, token)
  }
}

async function fulfillLockedOrder(payload: Payload, orderId: number | string): Promise<void> {
  const doc = await payload.findByID({ collection: 'orders', id: orderId, depth: 0, overrideAccess: true })
  if (doc.status !== 'success' || doc.fulfilledAt) return
  const userId = relationId(doc.user)
  if (userId === undefined) throw new Error('Paid order has no user')
  const user = await payload.findByID({ collection: 'users', id: userId, depth: 0, overrideAccess: true })
  let replacedSubscriptionIds: number[] = []
  let paidSubscriptionId: number | undefined
  // A transfer/OPay payment for the next month of an existing month-by-month plan.
  let renewal: { subscriptionId: number; recovered: boolean } | undefined
  const meta = (doc.metadata ?? {}) as { billing?: string; renewsSubscriptionId?: number | string }

  if (doc.type === 'course') {
    const courseId = relationId(doc.course)
    if (courseId === undefined) throw new Error('Paid course order has no course')
    const course = await payload.findByID({ collection: 'courses', id: courseId, depth: 0, overrideAccess: true })
    const existing = await payload.find({ collection: 'enrollments', where: { and: [{ student: { equals: userId } }, { course: { equals: courseId } }] }, limit: 1, overrideAccess: true })
    if (!existing.totalDocs) await payload.create({ collection: 'enrollments', data: { student: userId, course: courseId, status: 'active', orderId: doc.reference }, overrideAccess: true })
    else if (existing.docs[0]?.subscription) await payload.update({ collection: 'enrollments', id: existing.docs[0].id, data: { subscription: null, orderId: doc.reference }, overrideAccess: true })
  } else if (doc.type === 'subscription') {
    const planId = relationId(doc.plan)
    if (planId === undefined) throw new Error('Paid subscription order has no plan')
    const plan = await payload.findByID({ collection: 'plans', id: planId, depth: 0, overrideAccess: true })
    const courseId = relationId(plan.course)
    if (courseId === undefined) throw new Error('Subscription plan has no course')
    const existing = await payload.find({ collection: 'subscriptions', where: { initialOrderReference: { equals: doc.reference } }, limit: 1, overrideAccess: true })
    type RenewableSubscription = { id: number; user: unknown; course: unknown; currentPeriodEnd?: string | null }
    // A transfer/OPay payment renews the learner's month-by-month plan for this programme: the one
    // named at checkout or, when two checkouts were paid, the plan the first one created (so a
    // second payment adds a month instead of starting a duplicate plan).
    const renewing = meta.renewsSubscriptionId
      ? ((await payload.findByID({ collection: 'subscriptions', id: meta.renewsSubscriptionId, depth: 0, overrideAccess: true }).catch(() => null)) as unknown as RenewableSubscription | null)
      : meta.billing === 'manual' && !existing.totalDocs
        ? ((await findRenewableManualSubscription(payload, Number(userId), Number(courseId))) as unknown as RenewableSubscription | null)
        : null
    let subscriptionId = existing.docs[0]?.id
    if (renewing && String(relationId(renewing.user)) === String(userId) && String(relationId(renewing.course)) === String(courseId)) {
      // Adds a month from the end of the paid month (or from today if it has already ended), so
      // paying early never loses days and paying during the grace days starts a fresh month.
      const paidAt = doc.paidAt ? new Date(doc.paidAt).getTime() : Date.now()
      const currentEnd = renewing.currentPeriodEnd ? Date.parse(renewing.currentPeriodEnd) : 0
      const start = new Date(Math.max(paidAt, currentEnd))
      await payload.update({ collection: 'subscriptions', id: renewing.id, data: {
        status: 'active', currentPeriodStart: start.toISOString(), currentPeriodEnd: addDays(start, plan.interval === 'annually' ? 365 : 30).toISOString(),
        cancelledAt: null, failedAttempts: 0, lastFailedAt: null,
      }, overrideAccess: true })
      subscriptionId = renewing.id
      renewal = { subscriptionId: Number(renewing.id), recovered: currentEnd < paidAt }
    } else if (!existing.totalDocs) {
      const now = doc.paidAt ? new Date(doc.paidAt) : new Date()
      const subscription = await payload.create({ collection: 'subscriptions', data: {
        user: userId, plan: planId, course: courseId, status: 'active', initialOrderReference: doc.reference,
        currentPeriodStart: now.toISOString(), currentPeriodEnd: addDays(now, plan.interval === 'annually' ? 365 : 30).toISOString(),
        // Joining on the Access Scholarship plan locks the ₦2,000-a-month rate (see price-lock.ts).
        priceLocked: plan.kind === 'scholarship',
        // Transfer/OPay: paid month by month (no Paystack subscription); card: Paystack renews it.
        billing: meta.billing === 'manual' ? 'manual' : 'card',
      }, overrideAccess: true })
      subscriptionId = subscription.id
    }
    if (subscriptionId !== undefined) replacedSubscriptionIds = await replaceOlderSubscriptions(payload, userId, courseId, subscriptionId)
    paidSubscriptionId = subscriptionId === undefined ? undefined : Number(subscriptionId)
    const enrollments = await payload.find({ collection: 'enrollments', where: { and: [{ student: { equals: userId } }, { course: { equals: courseId } }] }, limit: 1, overrideAccess: true })
    const enrollment = enrollments.docs[0]
    if (!enrollment) await payload.create({ collection: 'enrollments', data: { student: userId, course: courseId, status: 'active', orderId: doc.reference, subscription: subscriptionId }, overrideAccess: true })
    else if (enrollment.subscription) await payload.update({ collection: 'enrollments', id: enrollment.id, data: { subscription: subscriptionId }, overrideAccess: true })
  } else if (doc.type === 'certificate') {
    const courseId = relationId(doc.course)
    if (courseId === undefined) throw new Error('Paid certificate order has no course')
    const enrollment = await payload.find({ collection: 'enrollments', where: { and: [{ student: { equals: userId } }, { course: { equals: courseId } }, { status: { equals: 'completed' } }] }, limit: 1, overrideAccess: true })
    if (!enrollment.totalDocs) throw new Error('Certificate course is not complete')
    const receipt = { reference: String(doc.reference), amount: Number(doc.amount), paidAt: String(doc.paidAt ?? new Date().toISOString()) }
    const exam = await payload.find({ collection: 'quizzes', where: { and: [{ course: { equals: courseId } }, { kind: { equals: 'final_exam' } }, { isPublished: { equals: true } }] }, limit: 1, depth: 0, overrideAccess: true })
    if (!exam.totalDocs) {
      // No final exam published for this programme yet: the certificate is issued straight away
      // (T9 carries the receipt), so nobody pays and then waits for an exam that doesn't exist.
      await issueCertificate(payload, userId, courseId, receipt)
    } else {
      // Pay first, then the exam: the fee unlocks the final exam (retakes included); passing it issues
      // the certificate. The exam-ready email (T12) carries the receipt.
      const existing = await payload.find({ collection: 'certificate-entitlements', where: { and: [{ student: { equals: userId } }, { course: { equals: courseId } }, { status: { not_equals: 'refunded' } }] }, limit: 1, depth: 0, overrideAccess: true })
      if (!existing.totalDocs) {
        await payload.create({ collection: 'certificate-entitlements', data: { student: userId, course: courseId, order: doc.id, status: 'awaiting_exam', paidAt: receipt.paidAt }, overrideAccess: true })
        await onLifecycleEvent(payload, { type: 'exam_ready', userId: Number(userId), courseId: Number(courseId), receipt })
      }
    }
  }

  await payload.update({ collection: 'orders', id: doc.id, data: { fulfilledAt: new Date().toISOString() }, overrideAccess: true })
  if (doc.type === 'course' || doc.type === 'subscription') {
    const paidCourseId = relationId(doc.course)
    if (renewal) {
      await onLifecycleEvent(payload, { type: 'renewal_success', subscriptionId: renewal.subscriptionId, recovered: renewal.recovered, reference: String(doc.reference), amount: Number(doc.amount) })
    } else if (paidCourseId !== undefined) {
      await onLifecycleEvent(
        payload,
        replacedSubscriptionIds.length && paidSubscriptionId !== undefined
          ? { type: 'resubscribed', userId: Number(userId), courseId: Number(paidCourseId), subscriptionId: paidSubscriptionId, replacedSubscriptionIds }
          : { type: 'first_payment_success', userId: Number(userId), courseId: Number(paidCourseId), orderId: Number(doc.id), subscriptionId: paidSubscriptionId },
      )
    }
    await markLeadPaid(payload, Number(userId), user.email)
    // Free bonus courses (Freelancer's Academy, CV & LinkedIn) appear in "My courses" once paid.
    await ensureBonusEnrollments(payload, Number(userId)).catch((err: unknown) => logger.warn({ err, userId }, 'bonus_enrollments_failed'))
  }
}
