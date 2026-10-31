/**
 * Enrolling people from Studio without a payment (the /admin/enrol screen).
 *
 * Access: a Studio enrolment carries MANUAL_ENROLLMENT_REF as its orderId and runs on an
 * access-extensions row, which is also the audit trail (who, when, why). Ending someone's access
 * early means deleting that row. Nothing here creates an order or a subscription, so there is no
 * Paystack charge, no revenue in the metrics and no ambassador commission.
 *
 * Who is left alone: a learner on a live paid plan (they would keep being charged for free
 * months) and a learner with permanent access (an end date would take access away).
 */
import { randomBytes } from 'node:crypto'
import type { Payload } from 'payload'
import { z } from 'zod'
import { AppError } from '../types/index.js'
import { logger } from './logger.js'
import { withLock } from './locks.js'
import { MANUAL_ENROLLMENT_REF } from './course-access.js'
import { subscriptionGivesAccess, type AccessSubscription } from './billing.js'
import { ensureBonusEnrollments } from './bonus-access.js'
import { enqueue } from './work-queue.js'
import { adminEnrolmentEmail, sendEmail } from './resend.js'
import { storePasswordResetToken } from './redis.js'
import { isDeliverableEmail } from './lead-messaging.js'
import { planDayStart } from './guided-plan.js'
import { generateSecureToken, hashToken } from '../utils/generate-code.js'

const DAY = 86_400_000
/** The same list run again today changes nothing, so a retry or a double click can't add the time twice. */
const REPEAT_WINDOW_MS = DAY
/** Three at a time: a batch must leave the pool (default 10 connections) to everyone else. */
const CONCURRENCY = 3
/** The first-time link has to survive a learner not opening their email for a while. */
const SET_PASSWORD_TTL_SECONDS = 14 * 24 * 60 * 60

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'https://skillsair.com'

export const MANUAL_ENROL_BATCH_MAX = 50

export interface Duration {
  unit: 'months' | 'days'
  amount: number
}

export type ManualEnrolmentStatus = 'created' | 'enrolled' | 'extended' | 'skipped' | 'failed'

export interface ManualEnrolmentResult {
  email: string
  status: ManualEnrolmentStatus
  message: string
  accessEndsAt?: string
  emailQueued?: boolean
}

export interface ManualEnrolmentInput {
  emails: string[]
  courseId: number
  duration: Duration
  note?: string
  notify: boolean
  adminId: number
}

export interface ManualEnrolmentEmail {
  userId: number
  courseId: number
  accessEndsAt: string
  mode: 'enrolled' | 'extended'
}

interface UserRow {
  id: number
  email: string
  firstName: string
  isActive?: boolean | null
  lastLoginAt?: string | null
  accessExpiresAt?: string | null
  lifecycle?: { emailSuppressed?: string | null } | null
}

interface CourseRow {
  id: number
  title: string
  slug: string
  status?: string | null
  isBonus?: boolean | null
}

const emailShape = z.string().email()

export const lagosDate = (at: string | number) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Lagos' }).format(new Date(at))

export function durationLabel({ unit, amount }: Duration): string {
  return `${amount} ${amount === 1 ? unit.slice(0, -1) : unit}`
}

/** Calendar months (31 January plus one month is the last day of February), or exact days. */
export function accessEndFrom(base: Date, { unit, amount }: Duration): Date {
  if (unit === 'days') return new Date(base.getTime() + amount * DAY)
  const end = new Date(base.getTime())
  const day = end.getUTCDate()
  end.setUTCDate(1)
  end.setUTCMonth(end.getUTCMonth() + amount)
  const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate()
  end.setUTCDate(Math.min(day, lastDay))
  return end
}

/** A display name from the address until the learner sets their own: ada.obi@x.com is Ada Obi. */
export function nameFromEmail(email: string): { firstName: string; lastName: string } {
  const parts = email.split('@')[0]!.split(/[._+-]+/).map((part) => part.replace(/[^\p{L}]/gu, '')).filter(Boolean)
  const title = (part: string | undefined) => (part ? part[0]!.toUpperCase() + part.slice(1).toLowerCase() : '')
  return { firstName: title(parts[0]) || 'Learner', lastName: title(parts[1]) || 'Learner' }
}

const ms = (value: string | null | undefined) => (value ? Date.parse(value) || 0 : 0)

async function findUser(payload: Payload, email: string): Promise<UserRow | null> {
  const found = await payload.find({ collection: 'users', where: { email: { equals: email } }, limit: 1, depth: 0, overrideAccess: true })
  return (found.docs[0] as unknown as UserRow | undefined) ?? null
}

/** A password nobody knows: the learner sets their own from the emailed link (or "Forgot password"). */
async function createAccount(payload: Payload, email: string): Promise<UserRow> {
  const created = await payload.create({
    collection: 'users',
    data: { email, password: `${randomBytes(24).toString('base64url')}aA1!`, ...nameFromEmail(email), role: 'student', isStudent: true },
    overrideAccess: true,
    context: { skipWelcomeEmail: true },
  })
  return created as unknown as UserRow
}

async function enrolOne(payload: Payload, email: string, course: CourseRow, input: ManualEnrolmentInput): Promise<ManualEnrolmentResult> {
  const existingUser = await findUser(payload, email)
  if (existingUser && existingUser.isActive === false) return { email, status: 'failed', message: 'This account is deactivated. Reactivate it first.' }

  if (existingUser) {
    const subscriptions = await payload.find({
      collection: 'subscriptions',
      where: { and: [{ user: { equals: existingUser.id } }, { course: { equals: course.id } }, { status: { in: ['active', 'past_due'] } }] },
      limit: 20, depth: 0, overrideAccess: true,
    })
    const paying = (subscriptions.docs as unknown as Array<AccessSubscription & { currentPeriodEnd?: string | null }>).find((doc) => subscriptionGivesAccess(doc))
    if (paying) {
      return { email, status: 'skipped', message: `On a paid plan for this programme${paying.currentPeriodEnd ? ` (paid to ${lagosDate(paying.currentPeriodEnd)})` : ''}. Nothing changed, and billing carries on.` }
    }
  }

  const reason = `Admin enrolment: ${durationLabel(input.duration)}${input.note ? ` (${input.note})` : ''}`
  const user = existingUser ?? (await createAccount(payload, email))
  const enrollments = await payload.find({ collection: 'enrollments', where: { and: [{ student: { equals: user.id } }, { course: { equals: course.id } }] }, limit: 1, depth: 0, overrideAccess: true })
  const enrollment = enrollments.docs[0]
  const refunded = enrollment?.status === 'refunded'

  if (enrollment && !refunded && !enrollment.subscription && enrollment.orderId !== MANUAL_ENROLLMENT_REF && !user.accessExpiresAt) {
    return { email, status: 'skipped', message: 'Already has permanent access to this programme. Nothing changed.' }
  }

  const extensions = await payload.find({ collection: 'access-extensions', where: { and: [{ student: { equals: user.id } }, { course: { equals: course.id } }] }, sort: '-createdAt', limit: 50, depth: 0, overrideAccess: true })
  const repeat = extensions.docs.find((doc) => ms(doc.createdAt) > Date.now() - REPEAT_WINDOW_MS && doc.reason === reason)
  if (repeat && enrollment && !refunded) {
    return { email, status: 'skipped', message: `The same enrolment was applied on ${lagosDate(repeat.createdAt)}. Nothing changed.`, accessEndsAt: repeat.newExpiryDate }
  }

  // New time starts when current access ends, so nobody loses days they already have.
  const runningPlan = await payload.find({ collection: 'subscriptions', where: { and: [{ user: { equals: user.id } }, { course: { equals: course.id } }, { status: { equals: 'cancelled' } }] }, sort: '-currentPeriodEnd', limit: 1, depth: 0, overrideAccess: true })
  const now = Date.now()
  const currentEnd = Math.max(
    ...extensions.docs.map((doc) => ms(doc.newExpiryDate)),
    ms(runningPlan.docs[0]?.currentPeriodEnd),
    enrollment && !enrollment.subscription ? ms(user.accessExpiresAt) : 0,
    0,
  )
  const base = new Date(Math.max(now, currentEnd))
  const accessEndsAt = accessEndFrom(base, input.duration)

  if (!enrollment) {
    await payload.create({ collection: 'enrollments', data: { student: user.id, course: course.id, status: 'active', orderId: MANUAL_ENROLLMENT_REF }, overrideAccess: true })
  } else if (refunded) {
    await payload.update({ collection: 'enrollments', id: enrollment.id, data: { status: 'active', orderId: MANUAL_ENROLLMENT_REF, planStartedAt: new Date(planDayStart(now)).toISOString() }, overrideAccess: true })
  }
  await payload.create({
    collection: 'access-extensions',
    data: {
      student: user.id, course: course.id, extendedBy: input.adminId, reason,
      daysAdded: Math.max(1, Math.round((accessEndsAt.getTime() - base.getTime()) / DAY)),
      previousExpiryDate: currentEnd ? new Date(currentEnd).toISOString() : null,
      newExpiryDate: accessEndsAt.toISOString(),
    },
    overrideAccess: true,
  })
  await ensureBonusEnrollments(payload, user.id).catch((err: unknown) => logger.warn({ err, userId: user.id }, 'bonus_enrollments_failed'))

  const mode = enrollment && !refunded ? 'extended' : 'enrolled'
  const emailQueued = input.notify && !user.lifecycle?.emailSuppressed && isDeliverableEmail(user.email)
    ? await enqueue('manual-enrol-email', { userId: user.id, courseId: course.id, accessEndsAt: accessEndsAt.toISOString(), mode }).then(() => true).catch((err: unknown) => {
        logger.error({ err, userId: user.id }, 'manual_enrol_email_queue_failed')
        return false
      })
    : false
  const status: ManualEnrolmentStatus = existingUser ? mode : 'created'
  const verb = status === 'created' ? 'Account created and enrolled' : mode === 'enrolled' ? 'Enrolled' : 'Access extended'
  logger.info({ userId: user.id, courseId: course.id, adminId: input.adminId, status, accessEndsAt }, 'manual_enrolment_applied')
  return { email, status, message: `${verb} until ${lagosDate(accessEndsAt.getTime())}.`, accessEndsAt: accessEndsAt.toISOString(), emailQueued }
}

/** Each email stands alone: one that fails is reported and the rest carry on. */
export async function manualEnrol(payload: Payload, input: ManualEnrolmentInput): Promise<ManualEnrolmentResult[]> {
  const course = (await payload.findByID({ collection: 'courses', id: input.courseId, depth: 0, overrideAccess: true }).catch(() => null)) as unknown as CourseRow | null
  if (!course || course.status !== 'published') throw new AppError('NOT_FOUND', 'Programme not found')
  if (course.isBonus) throw new AppError('VALIDATION_ERROR', 'Bonus courses open with a programme; choose the programme instead')

  const results: ManualEnrolmentResult[] = new Array(input.emails.length)
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
        results[index] = (await withLock(`manual-enrol:${email}`, 60, () => enrolOne(payload, email, course, input))) ?? { email, status: 'failed', message: 'Already being processed. Try this one again.' }
      } catch (err) {
        logger.error({ err, courseId: course.id }, 'manual_enrolment_failed')
        results[index] = { email, status: 'failed', message: err instanceof AppError ? err.message : 'Couldn’t be saved. Try this one again.' }
      }
    }
  }))
  return results
}

/** Runs from the work queue, on the API service, so the batch never waits on the email provider. */
export async function sendManualEnrolmentEmail(payload: Payload, task: ManualEnrolmentEmail): Promise<void> {
  const user = (await payload.findByID({ collection: 'users', id: task.userId, depth: 0, overrideAccess: true })) as unknown as UserRow
  const course = (await payload.findByID({ collection: 'courses', id: task.courseId, depth: 0, overrideAccess: true })) as unknown as CourseRow
  let setPasswordUrl = ''
  // Never signed in: a new account, or an imported one whose old password doesn't carry over.
  if (!user.lastLoginAt) {
    const token = generateSecureToken()
    await storePasswordResetToken(hashToken(token), user.id, SET_PASSWORD_TTL_SECONDS)
    setPasswordUrl = `${FRONTEND_URL.replace(/\/$/, '')}/reset-password?token=${token}`
  }
  await sendEmail(user.email, adminEnrolmentEmail({
    firstName: user.firstName,
    courseName: course.title,
    courseUrl: `${FRONTEND_URL.replace(/\/$/, '')}/dashboard/courses/${course.slug}/learn`,
    endsOn: lagosDate(task.accessEndsAt),
    extended: task.mode === 'extended',
    setPasswordUrl,
  }))
}

