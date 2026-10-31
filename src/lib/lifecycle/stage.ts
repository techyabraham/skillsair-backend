import type { PersonSnapshot, Stage, Track, WindowState } from './types.js'
import { DAY, HOUR, lagosDayNumber } from './timing.js'

/**
 * Where a person is in their journey (brief section 4). One person can be in several stages
 * at once (one per programme); `pickActiveTrack` decides which one may send marketing.
 *
 * S0 lead → A (window open) or Apost (closed) · S1 checkout not finished → B ·
 * S2 learning → I (and D while a renewal has failed) · S3 lapsed, not finished → R ·
 * S4 finished, no certificate → C · S5 certified → G
 */

/** Highest first. Only the active track may send marketing; transactional steps always may. */
export const TRACK_PRIORITY: Track[] = ['D', 'B', 'R', 'C', 'I', 'A', 'Apost', 'G']

/** B lasts long enough for B1–B3 (48 hours) plus a margin, then the person returns to their track. */
const CHECKOUT_STAGE_MS = 72 * HOUR
const PENDING_ORDER_MAX_AGE_MS = 7 * DAY
/**
 * How far back a completion, certificate or lapse can start a track. Keeps years-old imported
 * WordPress records out of the certificate, graduate and win-back emails.
 */
export const COMPLETION_LOOKBACK_MS = 180 * DAY
export const LAPSE_LOOKBACK_MS = 400 * DAY

export function windowCycle(at: number | null): number {
  return at === null ? 0 : lagosDayNumber(at)
}

function hasCurrentAccess(snapshot: PersonSnapshot, courseId: number, now: number, graceDays: number): boolean {
  return snapshot.subscriptions.some((subscription) => {
    if (subscription.courseId !== courseId) return false
    if ((subscription.status === 'active' || subscription.status === 'cancelled') && (subscription.currentPeriodEnd ?? 0) > now) return true
    // Month-by-month (transfer/OPay) plans keep access for the grace days after the paid month.
    if (subscription.billing === 'manual' && subscription.status === 'active' && (subscription.currentPeriodEnd ?? 0) + graceDays * DAY > now) return true
    return subscription.status === 'past_due' && subscription.lastFailedAt !== null && subscription.lastFailedAt + graceDays * DAY > now
  })
}

function hasPaid(snapshot: PersonSnapshot): boolean {
  return snapshot.orders.some((order) => order.status === 'success' && (order.type === 'course' || order.type === 'subscription'))
}

export function computeStages(snapshot: PersonSnapshot, window: WindowState, now: number, graceDays = 3): Stage[] {
  const stages: Stage[] = []
  // An admin gave these programmes (or more time on them): no selling them, and no win-back while it runs.
  const extendedCourses = new Set(snapshot.enrollments.filter((enrollment) => enrollment.status !== 'refunded' && (enrollment.accessExtendedUntil ?? 0) > now).map((enrollment) => enrollment.courseId))

  // D: a renewal failed and the learner is in (or just past) the grace period.
  for (const subscription of snapshot.subscriptions) {
    if (subscription.status === 'past_due' && subscription.lastFailedAt !== null) {
      stages.push({ track: 'D', subjectId: `sub:${subscription.id}`, enteredAt: subscription.lastFailedAt, cycle: subscription.failedAttempts, courseId: subscription.courseId })
    }
  }

  // B: the latest unpaid checkout per programme, while it's recent.
  const latestPendingByCourse = new Map<number, (typeof snapshot.orders)[number]>()
  for (const order of snapshot.orders) {
    if (order.status !== 'pending' || order.courseId === null || (order.type !== 'course' && order.type !== 'subscription')) continue
    if (now - order.createdAt > PENDING_ORDER_MAX_AGE_MS) continue
    const current = latestPendingByCourse.get(order.courseId)
    if (!current || order.createdAt > current.createdAt) latestPendingByCourse.set(order.courseId, order)
  }
  for (const [courseId, order] of latestPendingByCourse) {
    const paidSince = snapshot.orders.some((other) => other.status === 'success' && other.courseId === courseId && other.createdAt >= order.createdAt)
    if (paidSince || extendedCourses.has(courseId) || now - order.createdAt > CHECKOUT_STAGE_MS) continue
    stages.push({ track: 'B', subjectId: `order:${order.id}`, enteredAt: order.createdAt, cycle: 0, courseId })
  }

  for (const enrollment of snapshot.enrollments) {
    if (enrollment.status === 'refunded') continue
    const completed = enrollment.status === 'completed'

    // C: finished, no certificate yet.
    if (completed) {
      const certified = snapshot.certificates.some((certificate) => certificate.courseId === enrollment.courseId)
      if (!certified && enrollment.completedAt !== null && now - enrollment.completedAt <= COMPLETION_LOOKBACK_MS) {
        stages.push({ track: 'C', subjectId: `enr:${enrollment.id}`, enteredAt: enrollment.completedAt, cycle: 0, courseId: enrollment.courseId })
      }
      continue
    }
    // Learning nudges and win-back emails are for monthly-plan learners only (not imported one-off access).
    if (!enrollment.subscriptionBased) continue

    if (hasCurrentAccess(snapshot, enrollment.courseId, now, graceDays)) {
      // I: learning. The clock restarts whenever they complete a lesson.
      const neverStarted = snapshot.lastLearningAt === null || snapshot.lastLearningAt < enrollment.enrolledAt
      const anchor = neverStarted ? enrollment.enrolledAt : (snapshot.lastLearningAt as number)
      stages.push({ track: 'I', subjectId: `enr:${enrollment.id}`, enteredAt: anchor, cycle: lagosDayNumber(anchor), courseId: enrollment.courseId, neverStarted })
      continue
    }

    if (extendedCourses.has(enrollment.courseId)) continue

    // R: access has ended before they finished.
    const ended = snapshot.subscriptions
      .filter((subscription) => subscription.courseId === enrollment.courseId && subscription.status === 'expired')
      .map((subscription) => Math.max(subscription.currentPeriodEnd ?? 0, subscription.lastFailedAt !== null ? subscription.lastFailedAt + graceDays * DAY : 0, subscription.updatedAt))
      .sort((a, b) => b - a)[0]
    if (ended !== undefined && now - ended <= LAPSE_LOOKBACK_MS) {
      stages.push({ track: 'R', subjectId: `enr:${enrollment.id}`, enteredAt: ended, cycle: enrollment.cycle, courseId: enrollment.courseId })
    }
  }

  // G: certified, and hasn't started another programme since.
  const latestCertificate = [...snapshot.certificates].sort((a, b) => b.issuedAt - a.issuedAt)[0]
  if (latestCertificate) {
    const startedAnother = snapshot.enrollments.some((enrollment) => enrollment.courseId !== latestCertificate.courseId && enrollment.enrolledAt > latestCertificate.issuedAt)
    if (!startedAnother && now - latestCertificate.issuedAt <= COMPLETION_LOOKBACK_MS) {
      stages.push({ track: 'G', subjectId: `cert:${snapshot.key}:${latestCertificate.courseId}`, enteredAt: latestCertificate.issuedAt, cycle: 0, courseId: latestCertificate.courseId })
    }
  }

  // A / Apost: applied, never paid.
  const lead = snapshot.lead
  if (lead && !hasPaid(snapshot) && !extendedCourses.size && lead.status !== 'paid' && lead.status !== 'lost') {
    if (window.open && window.closesAt !== null) {
      const reopened = window.opensAt !== null && lead.createdAt < window.opensAt
      stages.push({
        track: 'A',
        subjectId: `lead:${lead.id}`,
        enteredAt: reopened ? (window.opensAt as number) : lead.createdAt,
        cycle: windowCycle(window.closesAt),
        courseId: lead.courseId ?? undefined,
        reopened,
      })
    } else {
      const closedAt = window.lastClosedAt
      stages.push({
        track: 'Apost',
        subjectId: `lead:${lead.id}`,
        enteredAt: Math.max(closedAt ?? 0, lead.createdAt),
        cycle: windowCycle(closedAt),
        courseId: lead.courseId ?? undefined,
      })
    }
  }

  return stages
}

/** The stage whose track may send marketing (and service) messages right now. */
export function pickActiveTrack(stages: Stage[]): Stage | null {
  for (const track of TRACK_PRIORITY) {
    const candidates = stages.filter((stage) => stage.track === track).sort((a, b) => a.enteredAt - b.enteredAt)
    if (candidates[0]) return candidates[0]
  }
  return null
}

/** True while the person has an unfinished programme they can study: no selling then (owner's rule). */
export function isLearning(stages: Stage[]): boolean {
  return stages.some((stage) => stage.track === 'I' || stage.track === 'D')
}
