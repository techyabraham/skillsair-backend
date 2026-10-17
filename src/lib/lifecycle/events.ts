import type { Payload } from 'payload'
import { logger } from '../logger.js'

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

/** Never throws: a lifecycle side effect must not fail a payment webhook or a lesson save. */
export async function onLifecycleEvent(payload: Payload, event: LifecycleEvent): Promise<void> {
  try {
    logger.info({ lifecycleEvent: event }, 'lifecycle_event')
    if (event.type === 'access_ended') {
      const bumped = await bumpLapseCycle(payload, event.userId, event.courseId)
      logger.info({ userId: event.userId, courseId: event.courseId, enrolments: bumped }, 'lifecycle_lapse_recorded')
    }
  } catch (err) {
    logger.error({ err, type: event.type }, 'lifecycle_event_failed')
  }
}
