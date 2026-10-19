import type { Payload } from 'payload'
import { relationId } from './leads.js'

/**
 * The Access Scholarship price lock (owner's rules, 2026-10-17):
 *
 * - **restart**: someone who started a programme on the ₦2,000-a-month scholarship plan and
 *   hasn't finished it can restart that same programme at ₦2,000 a month at any time, even
 *   when no scholarship window is open. No deadline.
 * - **next_programme**: someone who finished a programme (and joined on the scholarship) can
 *   start a different programme at ₦2,000 a month within NEXT_PROGRAMME_LOCK_DAYS (default 3)
 *   of finishing. After that, a new programme costs the price of the day.
 */
export type PriceLockReason = 'restart' | 'next_programme'

export interface PriceLock {
  locked: boolean
  reason: PriceLockReason | null
  /** When the lock ends (next_programme only); null means it doesn't expire. */
  endsAt: string | null
}

export interface LockSubscription {
  course: number
  priceLocked: boolean
}

export interface LockEnrollment {
  course: number
  status: string
  completedAt?: string | null
}

export const NO_LOCK: PriceLock = { locked: false, reason: null, endsAt: null }

export function nextProgrammeLockDays(): number {
  const value = Number(process.env.NEXT_PROGRAMME_LOCK_DAYS ?? 3)
  return Number.isFinite(value) && value >= 0 ? value : 3
}

export function resolvePriceLock(
  courseId: number,
  subscriptions: LockSubscription[],
  enrollments: LockEnrollment[],
  now = Date.now(),
  lockDays = nextProgrammeLockDays(),
): PriceLock {
  const joinedOnScholarship = subscriptions.some((subscription) => subscription.priceLocked)
  if (!joinedOnScholarship) return NO_LOCK

  const thisEnrollment = enrollments.find((enrollment) => enrollment.course === courseId)
  if (thisEnrollment?.status === 'completed') return NO_LOCK

  const lockedHere = subscriptions.some((subscription) => subscription.course === courseId && subscription.priceLocked)
  if (lockedHere) return { locked: true, reason: 'restart', endsAt: null }

  const latestCompletion = enrollments
    .filter((enrollment) => enrollment.course !== courseId && enrollment.status === 'completed' && enrollment.completedAt)
    .map((enrollment) => Date.parse(enrollment.completedAt ?? ''))
    .filter((time) => Number.isFinite(time))
    .sort((a, b) => b - a)[0]
  if (latestCompletion === undefined) return NO_LOCK
  const endsAt = latestCompletion + lockDays * 86_400_000
  return endsAt > now ? { locked: true, reason: 'next_programme', endsAt: new Date(endsAt).toISOString() } : NO_LOCK
}

/** Loads the learner's subscriptions and enrolments and applies the rules above. */
export async function getPriceLock(payload: Payload, userId: number, courseId: number, now = Date.now()): Promise<PriceLock> {
  const [subscriptions, enrollments] = await Promise.all([
    payload.find({ collection: 'subscriptions', where: { user: { equals: userId } }, limit: 200, depth: 0, overrideAccess: true }),
    payload.find({ collection: 'enrollments', where: { student: { equals: userId } }, limit: 200, depth: 0, overrideAccess: true }),
  ])
  return resolvePriceLock(
    courseId,
    subscriptions.docs.map((doc) => ({ course: Number(relationId(doc.course)), priceLocked: Boolean((doc as { priceLocked?: boolean | null }).priceLocked) })),
    enrollments.docs.map((doc) => ({ course: Number(relationId(doc.course)), status: String(doc.status), completedAt: (doc as { completedAt?: string | null }).completedAt ?? null })),
    now,
  )
}

/** True if the user has ever joined a programme on the Access Scholarship plan. */
export async function hasPriceLock(payload: Payload, userId: number): Promise<boolean> {
  const result = await payload.find({
    collection: 'subscriptions',
    where: { and: [{ user: { equals: userId } }, { priceLocked: { equals: true } }] },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  return result.totalDocs > 0
}
