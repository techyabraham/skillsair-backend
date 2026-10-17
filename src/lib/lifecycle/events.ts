import type { Payload } from 'payload'
import { logger } from '../logger.js'
import { relationId } from '../leads.js'
import { loadPerson, loadWindow, type LoadedPerson } from './context.js'
import { executeStep } from './send.js'
import { stepById } from './sequences.js'
import { idempotencyKey, type PlannedStep } from './plan.js'
import { lagosDayNumber } from './timing.js'
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
  | { type: 'renewal_success'; subscriptionId: number; recovered: boolean; reference?: string }
  | { type: 'invoice_upcoming'; subscriptionId: number; chargeDate: string | null; amount: number | null; cardLast4: string | null }
  | { type: 'payment_failed'; subscriptionId: number; firstFailure: boolean; graceEndsAt: string }
  | { type: 'cards_expiring'; subscriptionId: number; cardExpiry: string | null; cardDescription: string | null }
  | { type: 'subscription_cancelled'; subscriptionId: number; source: 'learner' | 'paystack' }
  | { type: 'access_ended'; userId: number; courseId?: number; subscriptionId?: number; reason: 'lapsed' | 'grace_expired' | 'legacy_access_expired' }
  | { type: 'enrollment_completed'; userId: number; courseId: number; enrollmentId: number; billingStopped: boolean }
  | { type: 'certificate_issued'; userId: number; courseId: number }

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

async function subscriptionOwner(payload: Payload, subscriptionId: number): Promise<{ userId: number; courseId: number; failedAttempts: number } | null> {
  const subscription = (await payload.findByID({ collection: 'subscriptions', id: subscriptionId, depth: 0, overrideAccess: true }).catch(() => null)) as SubscriptionRow | null
  if (!subscription) return null
  return { userId: Number(relationId(subscription.user)), courseId: Number(relationId(subscription.course)), failedAttempts: Number(subscription.failedAttempts ?? 0) }
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
  await executeStep(payload, person, planned, await loadWindow(payload), skip)
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
    case 'first_payment_success': {
      const person = await forUser(event.userId)
      if (person) await sendEventStep(payload, person, 'T1', stage(`order:${event.orderId}`, 0, event.courseId))
      return
    }
    case 'resubscribed': {
      const person = await forUser(event.userId)
      if (person) await sendEventStep(payload, person, 'T7', stage(`sub:${event.subscriptionId}`, 0, event.courseId))
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
      if (event.type === 'renewal_success') await sendEventStep(payload, person, event.recovered ? 'T7' : 'T2', stage(subject, day, owner.courseId))
      else if (event.type === 'invoice_upcoming') await sendEventStep(payload, person, 'T3', stage(subject, day, owner.courseId))
      else if (event.type === 'cards_expiring') await sendEventStep(payload, person, 'T4', stage(subject, day, owner.courseId))
      else if (event.type === 'subscription_cancelled') await sendEventStep(payload, person, 'T5', stage(subject, 0, owner.courseId))
      else {
        const dStage: Stage = { track: 'D', subjectId: subject, enteredAt: now, cycle: owner.failedAttempts, courseId: owner.courseId }
        await sendEventStep(payload, person, 'D1', dStage)
        if (event.firstFailure) await sendEventStep(payload, person, 'D1', dStage, { channel: 'whatsapp', template: 'skillsair_payment_failed' })
      }
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
      if (person) await sendEventStep(payload, person, 'T8', stage(`enr:${event.enrollmentId}`, 0, event.courseId))
      return
    }
    case 'certificate_issued': {
      const person = await forUser(event.userId)
      if (person) await sendEventStep(payload, person, 'T9', stage(`cert:${event.courseId}`, 0, event.courseId))
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
