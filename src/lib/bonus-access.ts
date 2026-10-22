import type { Payload } from 'payload'
import { bonusEligible } from './course-access.js'
import { logger } from './logger.js'

/** Marks bonus enrolments; access itself is decided by bonusEligible in course-access.ts. */
export const BONUS_ENROLLMENT_REF = 'bonus'

/** Published free bonus courses (Freelancer's Academy, CV & LinkedIn). */
export async function bonusCourseIds(payload: Payload): Promise<number[]> {
  const result = await payload.find({ collection: 'courses', where: { and: [{ isBonus: { equals: true } }, { status: { equals: 'published' } }] }, limit: 50, depth: 0, overrideAccess: true })
  return result.docs.map((doc) => Number(doc.id))
}

/**
 * Adds the learner's bonus courses to "My courses" once they qualify (after a payment, or from the
 * one-off backfill). No confirmation email: these come with the programme they paid for.
 * Returns how many enrolments were added.
 */
export async function ensureBonusEnrollments(payload: Payload, userId: number | string, options: { execute?: boolean } = {}): Promise<number> {
  const execute = options.execute ?? true
  const courseIds = await bonusCourseIds(payload)
  if (!courseIds.length || !(await bonusEligible(payload, userId))) return 0
  const existing = await payload.find({ collection: 'enrollments', where: { and: [{ student: { equals: userId } }, { course: { in: courseIds } }] }, limit: 50, depth: 0, overrideAccess: true })
  const have = new Set(existing.docs.map((doc) => String(typeof doc.course === 'object' && doc.course ? (doc.course as { id: number }).id : doc.course)))
  let added = 0
  for (const courseId of courseIds) {
    if (have.has(String(courseId))) continue
    added++
    if (execute) {
      await payload.create({
        collection: 'enrollments',
        data: { student: userId, course: courseId, status: 'active', orderId: BONUS_ENROLLMENT_REF },
        overrideAccess: true,
        context: { skipEnrollmentEmail: true },
      }).catch((err: unknown) => {
        added--
        logger.warn({ err, userId, courseId }, 'bonus_enrollment_failed')
      })
    }
  }
  return added
}
