import type { Payload } from 'payload'
import { logger } from '../logger.js'
import { relationId } from '../leads.js'
import { loadPerson, loadWindow, type EventData, type LoadedPerson } from './context.js'
import { executeStep } from './send.js'
import { stepById } from './sequences.js'
import { idempotencyKey, type PlannedStep } from './plan.js'
import { lagosDayNumber } from './timing.js'
import { attributeConversion } from './attribution.js'
import { withPaystackFee } from '../billing.js'
import type { Stage } from './types.js'

/**
 * Lifecycle events raised by billing, learning and certificate code. Each one changes where a
 * person is in their journey. This module records the state changes the events imply (for
 * example a lapse restarts the win-back emails by bumping the enrolment's cycle); the email
 * engine (step 4) adds the messages each event sends.
 */
export type LifecycleEvent =
  | { type: 'first_payment_success'; userId: number; courseId: number; orderId: number; subscriptionId?: number }
  | { type: 'resubscribed'; userId: number; courseId: number; subscriptionId: number; replacedSubscriptionIds: number[] }
  | { type: 'renewal_success'; subscriptionId: number; recovered: boolean; reference?: string; amount?: number }
  /** Month-by-month (transfer/OPay) plan: next month due in a few days (soon) or the month has ended (grace). */
  | { type: 'manual_payment_due'; subscriptionId: number; due: 'soon' | 'grace'; periodEnd: string }
  | { type: 'invoice_upcoming'; subscriptionId: number; chargeDate: string | null; amount: number | null; cardLast4: string | null }
  | { type: 'payment_failed'; subscriptionId: number; firstFailure: boolean; graceEndsAt: string }
  | { type: 'cards_expiring'; subscriptionId: number; cardExpiry: string | null; cardDescription: string | null }
  | { type: 'subscription_cancelled'; subscriptionId: number; source: 'learner' | 'paystack' }
  | { type: 'access_ended'; userId: number; courseId?: number; subscriptionId?: number; reason: 'lapsed' | 'grace_expired' | 'legacy_access_expired' }
  | { type: 'enrollment_completed'; userId: number; courseId: number; enrollmentId: number; billingStopped: boolean }
  | { type: 'certificate_issued'; userId: number; courseId: number; receipt?: { reference: string; amount: number; paidAt: string } }
  | { type: 'lesson_completed'; userId: number; courseId: number }

/** Bumps the cycle on unfinished enrolments, so a learner who lapses again gets the win-back emails again. */
async function bumpLapseCycle(payload: Payload, userId: number, courseId?: number): Promise<number> {
  const enrollments = await payload.find({
    collection: 'enrollments',
    where: {
      and: [
        { student: { equals: userId } },
        { status: { not_in: ['completed', 'refunded'] } },
        ...(courseId ? [{ course: { equals: courseId } }] : []),
      ],
    },
    limit: 50,
    depth: 0,
    overrideAccess: true,
  })
  for (const enrollment of enrollments.docs) {
    const cycle = Number((enrollment as { lifecycleCycle?: number | null }).lifecycleCycle ?? 0)
    await payload.update({ collection: 'enrollments', id: enrollment.id, data: { lifecycleCycle: cycle + 1 }, depth: 0, overrideAccess: true })
  }
  return enrollments.totalDocs
}

interface SubscriptionRow {
  id: number
  user: unknown
  course: unknown
  failedAttempts?: number | null
}

async function subscriptionOwner(payload: Payload, subscriptionId: number): Promise<{ userId: number; courseId: number; failedAttempts: number; planPrice: number | null } | null> {
  const subscription = (await payload.findByID({ collection: 'subscriptions', id: subscriptionId, depth: 1, overrideAccess: true }).catch(() => null)) as (SubscriptionRow & { plan?: { price?: number } | number }) | null
  if (!subscription) return null
  const planPrice = typeof subscription.plan === 'object' && subscription.plan ? Number(subscription.plan.price ?? 0) || null : null
  return { userId: Number(relationId(subscription.user)), courseId: Number(relationId(subscription.course)), failedAttempts: Number(subscription.failedAttempts ?? 0), planPrice }
}

const lagosDay = (at: number | string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Lagos' }).format(new Date(at))

async function orderReceipt(payload: Payload, orderId: number): Promise<EventData> {
  const order = await payload.findByID({ collection: 'orders', id: orderId, depth: 0, overrideAccess: true }).catch(() => null)
  if (!order) return {}
  return { reference: String(order.reference), amount: Number(order.amount), paidAt: lagosDay(String(order.paidAt ?? order.updatedAt ?? Date.now())) }
}

/**
 * Sends one event step (T1–T9, D1 and their WhatsApp versions) through the same sender as the
 * engine, so it's logged, idempotent and respects dry-run. Transactional steps go regardless of
 * marketing consent; service steps (T3, T4) respect "Learning reminders".
 */
async function sendEventStep(
  payload: Payload,
  person: LoadedPerson,
  stepId: string,
  stage: Stage,
  channelOverride?: { channel: 'whatsapp'; template: string },
  extra: EventData = {},
): Promise<void> {
  const step = stepById(stepId)
  if (!step) return
  const channel = channelOverride?.channel ?? step.channel
  const fullId = channelOverride ? `${stepId}-WA` : stepId
  const planned: PlannedStep = {
    step, stage, stepId: fullId, kind: step.kind, channel, template: channelOverride?.template ?? step.template,
    idempotencyKey: idempotencyKey(stage.track, fullId, stage.subjectId, stage.cycle), dueAt: Date.now(),
  }
  const snapshot = person.snapshot
  let skip: string | undefined
  if (channel === 'email' && !snapshot.email) skip = 'no_email'
  else if (channel === 'email' && snapshot.emailSuppressed) skip = 'suppressed'
  else if (channel === 'whatsapp' && !snapshot.phone) skip = 'no_phone'
  else if (step.kind === 'service' && channel === 'email' && !snapshot.learningReminders) skip = 'learning_reminders_off'
  await executeStep(payload, person, planned, await loadWindow(payload), skip, extra)
}

async function enrollmentFor(payload: Payload, userId: number, courseId: number): Promise<{ id: number; cycle: number } | null> {
  const result = await payload.find({ collection: 'enrollments', where: { and: [{ student: { equals: userId } }, { course: { equals: courseId } }] }, limit: 1, depth: 0, overrideAccess: true })
  const doc = result.docs[0] as unknown as { id: number; lifecycleCycle?: number | null } | undefined
  return doc ? { id: doc.id, cycle: Number(doc.lifecycleCycle ?? 0) } : null
}

/** The messages an event sends. Exits from sales tracks need nothing here: stages are recomputed on every run. */
async function sendForEvent(payload: Payload, event: LifecycleEvent): Promise<void> {
  const now = Date.now()
  const day = lagosDayNumber(now)
  const stage = (subjectId: string, cycle: number, courseId?: number): Stage => ({ track: 'T', subjectId, enteredAt: now, cycle, courseId })
  const forUser = async (userId: number) => loadPerson(payload, { type: 'user', id: userId })

  switch (event.type) {
    case 'lesson_completed':
      await attributeConversion(payload, event.userId, 'lesson')
      return
    case 'first_payment_success': {
      await attributeConversion(payload, event.userId, 'subscribed')
      const person = await forUser(event.userId)
      if (!person) return
      const t1 = stage(`order:${event.orderId}`, 0, event.courseId)
      await sendEventStep(payload, person, 'T1', t1, undefined, await orderReceipt(payload, event.orderId))
      await sendEventStep(payload, person, 'T1', t1, { channel: 'whatsapp', template: 'skillsair_welcome' })
      return
    }
    case 'resubscribed': {
      await attributeConversion(payload, event.userId, 'restarted')
      const person = await forUser(event.userId)
      if (!person) return
      const order = await payload.find({ collection: 'orders', where: { and: [{ user: { equals: event.userId } }, { status: { equals: 'success' } }] }, sort: '-createdAt', limit: 1, depth: 0, overrideAccess: true })
      const receipt = order.docs[0] ? await orderReceipt(payload, Number(order.docs[0].id)) : {}
      await sendEventStep(payload, person, 'T7', stage(`sub:${event.subscriptionId}`, 0, event.courseId), undefined, receipt)
      return
    }
    case 'renewal_success':
    case 'invoice_upcoming':
    case 'cards_expiring':
    case 'subscription_cancelled':
    case 'payment_failed': {
      const owner = await subscriptionOwner(payload, event.subscriptionId)
      if (!owner?.userId) return
      const person = await forUser(owner.userId)
      if (!person) return
      const subject = `sub:${event.subscriptionId}`
      const amount = owner.planPrice ?? undefined
      if (event.type === 'renewal_success' && event.recovered) await attributeConversion(payload, owner.userId, 'recovered')
      if (event.type === 'renewal_success') {
        await sendEventStep(payload, person, event.recovered ? 'T7' : 'T2', stage(subject, day, owner.courseId), undefined, { amount: event.amount ?? amount, paidAt: lagosDay(now), ...(event.reference ? { reference: event.reference } : {}) })
      } else if (event.type === 'invoice_upcoming') {
        await sendEventStep(payload, person, 'T3', stage(subject, day, owner.courseId), undefined, {
          amount: event.amount ?? amount, ...(event.chargeDate ? { chargeDate: lagosDay(event.chargeDate) } : {}), ...(event.cardLast4 ? { cardLast4: event.cardLast4 } : {}),
        })
      } else if (event.type === 'cards_expiring') {
        await sendEventStep(payload, person, 'T4', stage(subject, day, owner.courseId), undefined, {
          ...(event.cardExpiry ? { cardExpiry: event.cardExpiry } : {}), ...(event.cardDescription ? { cardLast4: (/\d{4}$/.exec(event.cardDescription) ?? [''])[0] } : {}),
        })
      }
      else if (event.type === 'subscription_cancelled') await sendEventStep(payload, person, 'T5', stage(subject, 0, owner.courseId))
      else {
        const dStage: Stage = { track: 'D', subjectId: subject, enteredAt: now, cycle: owner.failedAttempts, courseId: owner.courseId }
        await sendEventStep(payload, person, 'D1', dStage)
        if (event.firstFailure) await sendEventStep(payload, person, 'D1', dStage, { channel: 'whatsapp', template: 'skillsair_payment_failed' })
      }
      return
    }
    case 'manual_payment_due': {
      const owner = await subscriptionOwner(payload, event.subscriptionId)
      if (!owner?.userId) return
      const person = await forUser(owner.userId)
      if (!person) return
      // One reminder of each kind per paid month: the cycle is the day the month ends.
      const dueStage: Stage = { track: 'T', subjectId: `sub:${event.subscriptionId}`, enteredAt: now, cycle: lagosDayNumber(Date.parse(event.periodEnd)), courseId: owner.courseId }
      const stepId = event.due === 'soon' ? 'T10' : 'T11'
      // The reminder job runs hourly; sending (or a dry-run record) happens once per paid month.
      const already = await payload.count({ collection: 'messages', where: { idempotencyKey: { equals: idempotencyKey('T', stepId, dueStage.subjectId, dueStage.cycle) } }, overrideAccess: true })
      if (already.totalDocs) return
      // What they'll pay: the monthly price plus the Paystack fee.
      await sendEventStep(payload, person, stepId, dueStage, undefined, { amount: owner.planPrice ? withPaystackFee(owner.planPrice) : undefined })
      return
    }
    case 'access_ended': {
      if (!event.courseId) return
      const person = await forUser(event.userId)
      const enrollment = await enrollmentFor(payload, event.userId, event.courseId)
      if (!person || !enrollment) return
      const t6 = stage(`enr:${enrollment.id}`, enrollment.cycle, event.courseId)
      await sendEventStep(payload, person, 'T6', t6)
      await sendEventStep(payload, person, 'T6', t6, { channel: 'whatsapp', template: 'skillsair_access_paused' })
      return
    }
    case 'enrollment_completed': {
      const person = await forUser(event.userId)
      if (!person) return
      const t8 = stage(`enr:${event.enrollmentId}`, 0, event.courseId)
      await sendEventStep(payload, person, 'T8', t8)
      await sendEventStep(payload, person, 'T8', t8, { channel: 'whatsapp', template: 'skillsair_course_complete' })
      return
    }
    case 'certificate_issued': {
      await attributeConversion(payload, event.userId, 'certificate')
      const person = await forUser(event.userId)
      if (person) await sendEventStep(payload, person, 'T9', stage(`cert:${event.courseId}`, 0, event.courseId), undefined, event.receipt ?? {})
      return
    }
  }
}

/** Never throws: a lifecycle side effect must not fail a payment webhook or a lesson save. */
export async function onLifecycleEvent(payload: Payload, event: LifecycleEvent): Promise<void> {
  try {
    logger.info({ lifecycleEvent: event }, 'lifecycle_event')
    if (event.type === 'access_ended') {
      const bumped = await bumpLapseCycle(payload, event.userId, event.courseId)
      logger.info({ userId: event.userId, courseId: event.courseId, enrolments: bumped }, 'lifecycle_lapse_recorded')
    }
    await sendForEvent(payload, event)
  } catch (err) {
    logger.error({ err, type: event.type }, 'lifecycle_event_failed')
  }
}
