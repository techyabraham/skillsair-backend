import type { Payload } from 'payload'
import { paymentConfirmationEmail, sendEmail } from './resend.js'
import { logger } from './logger.js'
import { addDays } from '../utils/date-helpers.js'
import { issueCertificate } from '../hooks/courses/afterComplete.js'
import { relationId } from './course-access.js'
import { redis } from './redis.js'
import { randomUUID } from 'node:crypto'
import { applyLeadEvent, findLeadForUser } from './leads.js'
import { sendWelcomeMessages } from './lead-followups.js'
import { disableAtPaystack } from './billing.js'
import { onLifecycleEvent } from './lifecycle/events.js'

/**
 * A learner whose renewal failed (or whose plan lapsed) restarts by paying again, which creates
 * a new subscription. The old one is switched off at Paystack so it can never charge as well.
 */
async function replaceOlderSubscriptions(payload: Payload, userId: number | string, courseId: number | string, keepId: number | string): Promise<number[]> {
  const older = await payload.find({
    collection: 'subscriptions',
    where: { and: [{ user: { equals: userId } }, { course: { equals: courseId } }, { id: { not_equals: keepId } }, { status: { in: ['past_due', 'expired'] } }] },
    limit: 20,
    depth: 0,
    overrideAccess: true,
  })
  const replaced: number[] = []
  for (const doc of older.docs as unknown as Array<{ id: number; status: string; paystackSubscriptionCode?: string | null; paystackEmailToken?: string | null }>) {
    if (doc.status === 'past_due') {
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
  let itemDescription = 'your purchase'
  let replacedSubscriptionIds: number[] = []
  let paidSubscriptionId: number | undefined

  if (doc.type === 'course') {
    const courseId = relationId(doc.course)
    if (courseId === undefined) throw new Error('Paid course order has no course')
    const course = await payload.findByID({ collection: 'courses', id: courseId, depth: 0, overrideAccess: true })
    itemDescription = course.title
    const existing = await payload.find({ collection: 'enrollments', where: { and: [{ student: { equals: userId } }, { course: { equals: courseId } }] }, limit: 1, overrideAccess: true })
    if (!existing.totalDocs) await payload.create({ collection: 'enrollments', data: { student: userId, course: courseId, status: 'active', orderId: doc.reference }, overrideAccess: true })
    else if (existing.docs[0]?.subscription) await payload.update({ collection: 'enrollments', id: existing.docs[0].id, data: { subscription: null, orderId: doc.reference }, overrideAccess: true })
  } else if (doc.type === 'subscription') {
    const planId = relationId(doc.plan)
    if (planId === undefined) throw new Error('Paid subscription order has no plan')
    const plan = await payload.findByID({ collection: 'plans', id: planId, depth: 0, overrideAccess: true })
    itemDescription = `the ${plan.name} subscription`
    const courseId = relationId(plan.course)
    if (courseId === undefined) throw new Error('Subscription plan has no course')
    const existing = await payload.find({ collection: 'subscriptions', where: { initialOrderReference: { equals: doc.reference } }, limit: 1, overrideAccess: true })
    let subscriptionId = existing.docs[0]?.id
    if (!existing.totalDocs) {
      const now = doc.paidAt ? new Date(doc.paidAt) : new Date()
      const subscription = await payload.create({ collection: 'subscriptions', data: {
        user: userId, plan: planId, course: courseId, status: 'active', initialOrderReference: doc.reference,
        currentPeriodStart: now.toISOString(), currentPeriodEnd: addDays(now, plan.interval === 'annually' ? 365 : 30).toISOString(),
        // Joining on the Access Scholarship plan locks the ₦2,000-a-month rate (see price-lock.ts).
        priceLocked: plan.kind === 'scholarship',
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
    const course = await payload.findByID({ collection: 'courses', id: courseId, depth: 0, overrideAccess: true })
    itemDescription = `your certificate for ${course.title}`
    await issueCertificate(payload, userId, courseId)
  }

  await payload.update({ collection: 'orders', id: doc.id, data: { fulfilledAt: new Date().toISOString() }, overrideAccess: true })
  if (doc.type === 'course' || doc.type === 'subscription') {
    const paidCourseId = relationId(doc.course)
    if (paidCourseId !== undefined) {
      await onLifecycleEvent(
        payload,
        replacedSubscriptionIds.length && paidSubscriptionId !== undefined
          ? { type: 'resubscribed', userId: Number(userId), courseId: Number(paidCourseId), subscriptionId: paidSubscriptionId, replacedSubscriptionIds }
          : { type: 'first_payment_success', userId: Number(userId), courseId: Number(paidCourseId), orderId: Number(doc.id), subscriptionId: paidSubscriptionId },
      )
    }
    await markLeadPaid(payload, Number(userId), user.email)
    const courseId = relationId(doc.course)
    if (courseId !== undefined) {
      await sendWelcomeMessages(payload, Number(userId), Number(courseId)).catch((err: unknown) => logger.error({ err, orderId }, 'welcome_messages_failed'))
    }
  }
  try {
    await sendEmail(user.email, paymentConfirmationEmail(user.firstName, doc.reference, `₦${doc.amount.toLocaleString('en-NG')}`, itemDescription))
  } catch (err) {
    logger.error({ err, orderId }, 'payment_confirmation_email_failed')
  }
}
