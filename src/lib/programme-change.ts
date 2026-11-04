/**
 * Moving learners from one programme to another from Studio (Enrol learners → Change programme).
 *
 * What moves: the enrolment row (so it keeps its payment link: a one-off order, a subscription or
 * a Studio enrolment), every subscription for the old programme that still matters (so renewals,
 * reminders and the scholarship price lock follow the learner), and the access time left on
 * Studio access extensions (a new extension on the new programme ends on the same day; the old
 * rows stay as the record). The learner starts the new programme from the beginning: progress,
 * completion and the guided plan reset. Lesson progress and quiz attempts for the old programme
 * stay in the database.
 *
 * Who is left alone: someone who finished the old programme or has reached the certificate stage
 * (enrol them on the new one instead), and someone already enrolled on the new programme.
 *
 * Nothing here charges, refunds or emails anyone. Each learner moves in one transaction.
 */
import type { Payload, PayloadRequest, Where } from 'payload'
import { z } from 'zod'
import { AppError } from '../types/index.js'
import { logger } from './logger.js'
import { withLock } from './locks.js'
import { withTransaction } from './ambassadors/ledger.js'
import { ensureBonusEnrollments } from './bonus-access.js'
import { planDayStart } from './guided-plan.js'
import { MANUAL_ENROLLMENT_REF, relationId } from './course-access.js'
import { lagosDate } from './manual-enrolment.js'

const DAY = 86_400_000
/** Three at a time, as with Studio enrolment: each move holds one pool connection for its transaction. */
const CONCURRENCY = 3

export const PROGRAMME_CHANGE_BATCH_MAX = 50

export type ProgrammeChangeStatus = 'changed' | 'skipped' | 'failed'

export interface ProgrammeChangeResult {
  email: string
  status: ProgrammeChangeStatus
  message: string
}

export interface ProgrammeChangeInput {
  emails: string[]
  fromCourseId: number
  toCourseId: number
  note?: string
  adminId: number
}

interface CourseRow {
  id: number
  title: string
  status?: string | null
  isBonus?: boolean | null
}

const emailShape = z.string().email()

async function loadProgramme(payload: Payload, id: number): Promise<CourseRow> {
  const course = (await payload.findByID({ collection: 'courses', id, depth: 0, overrideAccess: true }).catch(() => null)) as unknown as CourseRow | null
  if (!course) throw new AppError('NOT_FOUND', 'Programme not found')
  if (course.isBonus) throw new AppError('VALIDATION_ERROR', 'Bonus courses open with a programme; choose a programme instead')
  return course
}

async function moveOne(payload: Payload, email: string, from: CourseRow, to: CourseRow, input: ProgrammeChangeInput): Promise<ProgrammeChangeResult> {
  const users = await payload.find({ collection: 'users', where: { email: { equals: email } }, limit: 1, depth: 0, overrideAccess: true })
  const user = users.docs[0] as unknown as { id: number } | undefined
  if (!user) return { email, status: 'failed', message: 'No account with this email.' }

  const enrolmentOn = async (courseId: number) =>
    (await payload.find({ collection: 'enrollments', where: { and: [{ student: { equals: user.id } }, { course: { equals: courseId } }] }, limit: 1, depth: 0, overrideAccess: true })).docs[0]
  const enrollment = await enrolmentOn(from.id)
  if (!enrollment) return { email, status: 'skipped', message: `Not enrolled on ${from.title}. Nothing changed.` }
  if (enrollment.status === 'refunded') return { email, status: 'skipped', message: `Their ${from.title} enrolment was refunded. Nothing changed.` }
  if (enrollment.status === 'completed') return { email, status: 'skipped', message: `Finished ${from.title}. Enrol them on ${to.title} instead.` }

  const learnerOnFrom: Where[] = [{ student: { equals: user.id } }, { course: { equals: from.id } }]
  const [certificates, entitlements] = await Promise.all([
    payload.count({ collection: 'certificates', where: { and: learnerOnFrom }, overrideAccess: true }),
    payload.count({ collection: 'certificate-entitlements', where: { and: [...learnerOnFrom, { status: { not_equals: 'refunded' } }] }, overrideAccess: true }),
  ])
  if (certificates.totalDocs || entitlements.totalDocs) return { email, status: 'skipped', message: `Has a certificate for ${from.title}. Enrol them on ${to.title} instead.` }

  const target = await enrolmentOn(to.id)
  if (target && target.status !== 'refunded') return { email, status: 'skipped', message: `Already enrolled on ${to.title}. Nothing changed.` }
  if (target) return { email, status: 'failed', message: `Has a refunded ${to.title} enrolment. Delete it in Enrolments first, then try again.` }

  const now = Date.now()
  const reason = `Programme changed from ${from.title} to ${to.title}${input.note ? ` (${input.note})` : ''}`

  await withTransaction(payload, async (txReq) => {
    const req = txReq as PayloadRequest
    const subscriptions = await payload.find({
      collection: 'subscriptions',
      where: { and: [{ user: { equals: user.id } }, { course: { equals: from.id } }, { status: { in: ['active', 'past_due', 'cancelled'] } }] },
      limit: 50, depth: 0, overrideAccess: true, req,
    })
    for (const subscription of subscriptions.docs) {
      await payload.update({ collection: 'subscriptions', id: subscription.id, data: { course: to.id }, overrideAccess: true, req })
    }

    const live = await payload.find({
      collection: 'access-extensions',
      where: { and: [{ student: { equals: user.id } }, { course: { equals: from.id } }, { newExpiryDate: { greater_than: new Date(now).toISOString() } }] },
      sort: '-newExpiryDate', limit: 1, depth: 0, overrideAccess: true, req,
    })
    const endsAt = live.docs[0]?.newExpiryDate
    if (endsAt) {
      await payload.create({
        collection: 'access-extensions',
        data: {
          student: user.id, course: to.id, extendedBy: input.adminId, reason,
          daysAdded: Math.max(1, Math.ceil((Date.parse(endsAt) - now) / DAY)),
          previousExpiryDate: null,
          newExpiryDate: endsAt,
        },
        overrideAccess: true, req,
      })
    }

    await payload.update({
      collection: 'enrollments',
      id: enrollment.id,
      data: {
        course: to.id, status: 'active', progressPercent: 0, completedAt: null, lifecycleCycle: 0,
        planStartedAt: new Date(planDayStart(now)).toISOString(), planResetCount: 0, planResetAt: null,
      },
      overrideAccess: true, req,
    })
    return subscriptions.docs.length
  }).then((moved) => {
    logger.info({ userId: user.id, enrollmentId: enrollment.id, fromCourseId: from.id, toCourseId: to.id, subscriptionsMoved: moved, adminId: input.adminId }, 'programme_change_applied')
  })

  await ensureBonusEnrollments(payload, user.id).catch((err: unknown) => logger.warn({ err, userId: user.id }, 'bonus_enrollments_failed'))

  const paid = relationId(enrollment.subscription) !== undefined ? ' Their plan and payments carry over.' : enrollment.orderId && enrollment.orderId !== MANUAL_ENROLLMENT_REF ? ' Their purchase carries over.' : ''
  return { email, status: 'changed', message: `Moved to ${to.title}.${paid}${(await accessNote(payload, user.id, to.id)) ?? ''}` }
}

/** " Access runs until 19 January 2027." when a Studio extension sets the end, so the admin sees it carried over. */
async function accessNote(payload: Payload, userId: number, courseId: number): Promise<string | null> {
  const live = await payload.find({
    collection: 'access-extensions',
    where: { and: [{ student: { equals: userId } }, { course: { equals: courseId } }, { newExpiryDate: { greater_than: new Date().toISOString() } }] },
    sort: '-newExpiryDate', limit: 1, depth: 0, overrideAccess: true,
  })
  const endsAt = live.docs[0]?.newExpiryDate
  return endsAt ? ` Access runs until ${lagosDate(endsAt)}.` : null
}

/** Each email stands alone: one that fails is reported and the rest carry on. */
export async function changeProgramme(payload: Payload, input: ProgrammeChangeInput): Promise<ProgrammeChangeResult[]> {
  if (input.fromCourseId === input.toCourseId) throw new AppError('VALIDATION_ERROR', 'Choose two different programmes')
  const from = await loadProgramme(payload, input.fromCourseId)
  const to = await loadProgramme(payload, input.toCourseId)
  if (to.status !== 'published') throw new AppError('VALIDATION_ERROR', `${to.title} isn't published yet`)

  const results: ProgrammeChangeResult[] = new Array(input.emails.length)
  const seen = new Set<string>()
  const work: Array<{ index: number; email: string }> = []
  input.emails.forEach((raw, index) => {
    const email = raw.trim().toLowerCase()
    if (!emailShape.safeParse(email).success) results[index] = { email: raw.trim() || '(empty)', status: 'failed', message: 'Not a valid email address.' }
    else if (seen.has(email)) results[index] = { email, status: 'skipped', message: 'Listed more than once; handled above.' }
    else {
      seen.add(email)
      work.push({ index, email })
    }
  })

  let next = 0
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < work.length) {
      const { index, email } = work[next++]!
      try {
        // The same lock as Studio enrolment, so a move and an enrolment for one person never interleave.
        results[index] = (await withLock(`manual-enrol:${email}`, 60, () => moveOne(payload, email, from, to, input))) ?? { email, status: 'failed', message: 'Already being processed. Try this one again.' }
      } catch (err) {
        logger.error({ err, fromCourseId: from.id, toCourseId: to.id }, 'programme_change_failed')
        results[index] = { email, status: 'failed', message: err instanceof AppError ? err.message : 'Couldn’t be saved. Nothing changed for this person; try again.' }
      }
    }
  }))
  return results
}
