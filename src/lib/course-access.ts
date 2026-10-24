import type { Payload } from 'payload'
import { AppError } from '../types/index.js'
import { subscriptionGivesAccess, type AccessSubscription } from './billing.js'

export function relationId(value: unknown): number | string | undefined {
  if (value == null) return undefined
  if (typeof value === 'object' && 'id' in value) return (value as { id: number | string }).id
  return value as number | string
}

export async function getLessonCourse(payload: Payload, lessonId: number | string) {
  const lesson = await payload.findByID({ collection: 'lessons', id: lessonId, depth: 0, overrideAccess: true }).catch(() => null)
  if (!lesson || !lesson.isPublished) throw new AppError('NOT_FOUND', 'Lesson not found')
  const sectionId = relationId(lesson.section)
  if (sectionId === undefined) throw new AppError('NOT_FOUND', 'Lesson section not found')
  const section = await payload.findByID({ collection: 'sections', id: sectionId, depth: 0, overrideAccess: true }).catch(() => null)
  const courseId = relationId(section?.course)
  if (courseId === undefined) throw new AppError('NOT_FOUND', 'Lesson course not found')
  return { lesson, courseId }
}

/** Two paid months, allowing a few days' slack for how months were counted. */
const BONUS_PAID_DAYS = 58

/**
 * Free bonus courses (Freelancer's Academy, CV & LinkedIn) are open to a learner who either has a
 * programme running now or has paid for at least two months in total (so they keep the bonus
 * courses after their programme ends). A one-off programme payment counts as paid in full.
 */
export async function bonusEligible(payload: Payload, studentId: number | string): Promise<boolean> {
  const user = await payload.findByID({ collection: 'users', id: studentId, depth: 0, overrideAccess: true }).catch(() => null)
  if (!user?.isActive) return false
  const oneOff = await payload.count({ collection: 'orders', where: { and: [{ user: { equals: studentId } }, { type: { equals: 'course' } }, { status: { equals: 'success' } }] }, overrideAccess: true })
  if (oneOff.totalDocs) return true
  const subscriptions = await payload.find({ collection: 'subscriptions', where: { user: { equals: studentId } }, limit: 100, depth: 0, overrideAccess: true })
  let paidDays = 0
  for (const subscription of subscriptions.docs as unknown as Array<{ createdAt?: string; currentPeriodEnd?: string | null }>) {
    const start = subscription.createdAt ? Date.parse(subscription.createdAt) : NaN
    const end = subscription.currentPeriodEnd ? Date.parse(subscription.currentPeriodEnd) : NaN
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) paidDays += (end - start) / 86_400_000
  }
  if (paidDays >= BONUS_PAID_DAYS) return true
  // Otherwise: any programme (not itself a bonus course) the learner can open right now.
  const enrollments = await payload.find({ collection: 'enrollments', where: { and: [{ student: { equals: studentId } }, { status: { not_equals: 'refunded' } }] }, limit: 100, depth: 1, overrideAccess: true })
  for (const enrollment of enrollments.docs as unknown as Array<{ course?: { id: number; isBonus?: boolean | null } | number | null }>) {
    const course = enrollment.course
    if (!course || typeof course !== 'object' || course.isBonus) continue
    try {
      await requireCourseAccess(payload, studentId, course.id)
      return true
    } catch {
      // not open now; keep looking
    }
  }
  return false
}

export async function requireCourseAccess(payload: Payload, studentId: number | string, courseId: number | string): Promise<void> {
  const course = await payload.findByID({ collection: 'courses', id: courseId, depth: 0, overrideAccess: true }).catch(() => null) as { isBonus?: boolean | null } | null
  if (course?.isBonus) {
    if (await bonusEligible(payload, studentId)) return
    throw new AppError('INSUFFICIENT_PERMISSION', 'This free bonus course is open while you have a programme running, or once you have paid for at least two months.')
  }
  const enrollments = await payload.find({
    collection: 'enrollments',
    where: { and: [{ student: { equals: studentId } }, { course: { equals: courseId } }, { status: { not_equals: 'refunded' } }] },
    limit: 1, depth: 0, overrideAccess: true,
  })
  if (!enrollments.totalDocs) throw new AppError('INSUFFICIENT_PERMISSION', 'You are not enrolled in this course')
  const user = await payload.findByID({ collection: 'users', id: studentId, depth: 0, overrideAccess: true })
  if (!user.isActive) throw new AppError('INSUFFICIENT_PERMISSION', 'Account is inactive')
  const extensions = await payload.find({
    collection: 'access-extensions',
    where: { and: [{ student: { equals: studentId } }, { course: { equals: courseId } }, { newExpiryDate: { greater_than: new Date().toISOString() } }] },
    limit: 1, depth: 0, overrideAccess: true,
  })
  const extended = extensions.totalDocs > 0
  const subscriptionId = relationId(enrollments.docs[0]?.subscription)
  if (subscriptionId !== undefined) {
    const subscription = await payload.findByID({ collection: 'subscriptions', id: subscriptionId, depth: 0, overrideAccess: true }).catch(() => null)
    // Paid-up (active, or cancelled but running to the end of its month), a failed card renewal still in
    // its grace days, or a month-by-month (transfer/OPay) plan inside its month plus grace days.
    if (!subscriptionGivesAccess(subscription as AccessSubscription | null)) {
      if (extended) return
      throw new AppError('ACCESS_EXPIRED', 'Your course subscription has expired')
    }
    return
  }
  if (!user.accessExpiresAt || new Date(user.accessExpiresAt).getTime() > Date.now()) return
  if (!extended) throw new AppError('ACCESS_EXPIRED', 'Your access to this course has expired')
}

export async function courseCompletion(payload: Payload, studentId: number | string, courseId: number | string) {
  const sections = await payload.find({ collection: 'sections', where: { course: { equals: courseId } }, limit: 1000, depth: 0, overrideAccess: true })
  const sectionIds = sections.docs.map((section) => section.id)
  const lessons = sectionIds.length ? await payload.find({ collection: 'lessons', where: { and: [{ section: { in: sectionIds } }, { isPublished: { equals: true } }] }, limit: 5000, depth: 0, overrideAccess: true }) : { docs: [], totalDocs: 0 }
  const lessonIds = lessons.docs.map((lesson) => lesson.id)
  const progress = lessonIds.length ? await payload.find({ collection: 'lesson-progress', where: { and: [{ student: { equals: studentId } }, { lesson: { in: lessonIds } }, { isCompleted: { equals: true } }] }, limit: 5000, depth: 0, overrideAccess: true }) : { docs: [] }
  // Completion = every published lesson + every published chapter quiz passed (knowledge checks are
  // optional; the final exam comes after completion, once the certificate is paid for).
  const quizzes = await payload.find({ collection: 'quizzes', where: { and: [{ course: { equals: courseId } }, { isPublished: { equals: true } }, { kind: { equals: 'chapter' } }] }, limit: 1000, depth: 0, overrideAccess: true })
  const quizIds = quizzes.docs.map((quiz) => quiz.id)
  const attempts = quizIds.length ? await payload.find({ collection: 'quiz-attempts', where: { and: [{ student: { equals: studentId } }, { quiz: { in: quizIds } }, { passed: { equals: true } }] }, limit: 5000, depth: 0, overrideAccess: true }) : { docs: [] }
  return {
    total: lessons.totalDocs, completed: new Set(progress.docs.map((doc) => String(relationId(doc.lesson)))).size,
    totalQuizzes: quizzes.totalDocs, passedQuizzes: new Set(attempts.docs.map((doc) => String(relationId(doc.quiz)))).size,
  }
}

export async function refreshEnrollmentProgress(payload: Payload, enrollmentId: number | string, studentId: number | string, courseId: number | string) {
  const completion = await courseCompletion(payload, studentId, courseId)
  const total = completion.total + completion.totalQuizzes
  const done = completion.completed + completion.passedQuizzes
  const progressPercent = total > 0 ? Math.min(100, Math.round(done * 100 / total)) : 0
  const enrollment = await payload.findByID({ collection: 'enrollments', id: enrollmentId, depth: 0, overrideAccess: true })
  const fullyCompleted = total > 0 && done === total
  return payload.update({ collection: 'enrollments', id: enrollmentId, data: {
    progressPercent,
    ...(fullyCompleted && enrollment.status !== 'completed' ? { status: 'completed' as const, completedAt: new Date().toISOString() } : {}),
  }, overrideAccess: true })
}
