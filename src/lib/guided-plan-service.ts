/**
 * Guided 12-week plan, service side: the plan for a learner's programme (GET /api/courses/:id/plan),
 * the dashboard summary (GET /api/plans/me), the pace setting and "Move my plan".
 *
 * Queries:
 * - the curriculum-derived plan is cached in Redis per programme and curriculum generation
 *   (`bumpCourseCache` from the course, section, lesson and quiz hooks retires it), 24 hours;
 *   a miss is one SQL statement for any number of programmes;
 * - learner state (enrolment, completed lessons, passed quizzes) is never cached: one SQL
 *   statement for one programme or for all of a learner's programmes.
 * If Redis is down the plan is computed without caching; the request never fails because of it.
 */
import type { Payload } from 'payload'
import { sql } from '@payloadcms/db-postgres'
import { AppError, type AuthUser } from '../types/index.js'
import { cacheGet, cacheSet, courseCacheGeneration } from './cache.js'
import { logger } from './logger.js'
import { movedPlanStart, planProgress, type GuidedPlan, type ItemProgress, type Pace, type PlanProgress, type PlanStatus, type WeekProgress } from './guided-plan.js'
import { planSourceSql, plansFromRows, type PlanSourceRow } from './guided-plan-source.js'

type SQLQuery = ReturnType<typeof sql>

const PLAN_TTL_SECONDS = 24 * 60 * 60
const planKey = (courseId: number, generation: string) => `guided-plan:${courseId}:${generation}`

/** GUIDED_PLAN_ENABLED=false switches every plan surface off (endpoints answer 404 FEATURE_DISABLED). */
export function guidedPlanEnabled(): boolean {
  return (process.env.GUIDED_PLAN_ENABLED ?? 'true').trim().toLowerCase() !== 'false'
}

export function assertGuidedPlanEnabled(): void {
  if (!guidedPlanEnabled()) throw new AppError('FEATURE_DISABLED', 'The learning plan is not available.')
}

export async function query<T>(payload: Payload, statement: SQLQuery): Promise<T[]> {
  const db = payload.db as unknown as { drizzle: { execute: (q: SQLQuery) => Promise<{ rows: T[] }> } }
  return (await db.drizzle.execute(statement)).rows
}

/** Plans for these programmes: from the cache, the misses in one statement. */
export async function coursePlans(payload: Payload, courseIds: number[]): Promise<Map<number, GuidedPlan>> {
  const ids = [...new Set(courseIds)]
  const out = new Map<number, GuidedPlan>()
  const keys = new Map<number, string>()
  await Promise.all(ids.map(async (id) => {
    const key = planKey(id, await courseCacheGeneration(id))
    keys.set(id, key)
    const hit = await cacheGet(key)
    if (!hit) return
    try {
      out.set(id, JSON.parse(hit) as GuidedPlan)
    } catch {
      // corrupt entry: recompute
    }
  }))
  const missing = ids.filter((id) => !out.has(id))
  if (missing.length) {
    const rows = await query<PlanSourceRow>(payload, planSourceSql(missing))
    for (const [id, plan] of plansFromRows(missing, rows)) {
      out.set(id, plan)
      await cacheSet(keys.get(id)!, JSON.stringify(plan), PLAN_TTL_SECONDS)
    }
  }
  return out
}

/* ------------------------------------------------------------------------ */
/* Learner state                                                            */
/* ------------------------------------------------------------------------ */

export interface LearnerRow {
  id: number
  student_id: number
  course_id: number
  status: string
  pace: Pace | null
  plan_started_at: string | null
  enrolled_at: string | null
  plan_reset_count: number | string | null
  plan_reset_at: string | null
  slug: string
  title: string
  is_bonus: boolean | null
  lessons: Array<{ id: number; at: string | null }> | null
  quizzes: Array<{ id: number; at: string | null }> | null
  last_progress_at: string | null
}

/** Enrolments with their completed lessons and passed quizzes, in one statement. */
export function learnerRowsSql(where: SQLQuery, order: SQLQuery = sql`e.enrolled_at DESC NULLS LAST, e.id DESC`, limit?: number): SQLQuery {
  return sql`
    SELECT e.id, e.student_id, e.course_id, e.status, e.pace, e.plan_started_at, e.enrolled_at, e.plan_reset_count, e.plan_reset_at,
      c.slug, c.title, c.is_bonus,
      (SELECT coalesce(json_agg(json_build_object('id', lp.lesson_id, 'at', lp.completed_at)), '[]'::json)
         FROM lesson_progress lp WHERE lp.student_id = e.student_id AND lp.course_id = e.course_id AND lp.is_completed = true) AS lessons,
      (SELECT max(lp.updated_at) FROM lesson_progress lp WHERE lp.student_id = e.student_id AND lp.course_id = e.course_id) AS last_progress_at,
      (SELECT coalesce(json_agg(json_build_object('id', a.quiz_id, 'at', a.at)), '[]'::json) FROM (
         SELECT qa.quiz_id, min(coalesce(qa.submitted_at, qa.updated_at)) AS at
           FROM quiz_attempts qa JOIN quizzes q ON q.id = qa.quiz_id
           WHERE qa.student_id = e.student_id AND q.course_id = e.course_id AND qa.passed = true
           GROUP BY qa.quiz_id) a) AS quizzes
    FROM enrollments e JOIN courses c ON c.id = e.course_id
    WHERE ${where}
    ORDER BY ${order}
    ${limit ? sql`LIMIT ${limit}` : sql``}
  `
}

const ms = (value: string | null | undefined): number | null => {
  const parsed = value ? Date.parse(value) : NaN
  return Number.isFinite(parsed) ? parsed : null
}

export function progressFor(plan: GuidedPlan, row: LearnerRow, now: number): PlanProgress {
  return planProgress(plan, {
    pace: row.pace === 'self_paced' ? 'self_paced' : 'guided',
    startedAt: ms(row.plan_started_at) ?? ms(row.enrolled_at) ?? now,
    completedLessons: new Map((row.lessons ?? []).map((lesson) => [Number(lesson.id), ms(lesson.at)])),
    passedQuizzes: new Map((row.quizzes ?? []).map((quiz) => [Number(quiz.id), ms(quiz.at)])),
    planResetAt: ms(row.plan_reset_at),
  }, now)
}

/* ------------------------------------------------------------------------ */
/* Response shapes                                                          */
/* ------------------------------------------------------------------------ */

export interface PlanItemView {
  type: 'lesson' | 'chapter_quiz' | 'final_exam'
  id: number
  title: string
  sectionId: number | null
  sectionTitle: string
  minutes: number
  done: boolean
  href: string
}

export interface PlanWeekView {
  week: number
  startsOn: string
  endsOn: string
  minutes: number
  doneCount: number
  totalCount: number
  items: PlanItemView[]
}

/** Frontend paths into the existing course player (?lesson= and ?quiz=) and the exam page. */
export function itemHref(slug: string, type: PlanItemView['type'], id: number): string {
  const base = `/dashboard/courses/${encodeURIComponent(slug)}`
  if (type === 'final_exam') return `${base}/exam`
  return `${base}/learn?${type === 'lesson' ? 'lesson' : 'quiz'}=${id}`
}

const itemView = (slug: string) => (item: ItemProgress): PlanItemView => ({
  type: item.type, id: item.id, title: item.title, sectionId: item.sectionId, sectionTitle: item.sectionTitle, minutes: item.minutes, done: item.done, href: itemHref(slug, item.type, item.id),
})

function weekView(slug: string, week: WeekProgress, progress: PlanProgress): PlanWeekView {
  const items = week.items.map(itemView(slug))
  // The final exam is pointed to in the last week (informational, not counted).
  if (progress.finalExam && week.week === progress.weeks) {
    items.push({ type: 'final_exam', id: progress.finalExam.id, title: progress.finalExam.title, sectionId: null, sectionTitle: '', minutes: 0, done: progress.finalExam.done, href: itemHref(slug, 'final_exam', progress.finalExam.id) })
  }
  return { week: week.week, startsOn: week.startsOn, endsOn: week.endsOn, minutes: week.minutes, doneCount: week.doneCount, totalCount: week.totalCount, items }
}

export interface CoursePlanView {
  courseId: number
  slug: string
  title: string
  pace: Pace
  weeks: number
  planVersion: string
  startedAt: string
  currentWeek: number
  status?: PlanStatus
  weeksBehind?: number
  finishBy: string
  projectedFinish?: string | null
  thisWeek: PlanWeekView
  overdue?: PlanItemView[]
  nextItem: PlanItemView | null
  plan: PlanWeekView[]
  resetAvailableAt: string | null
  canReset: boolean
  resetCount: number
}

function nextItemView(slug: string, progress: PlanProgress): PlanItemView | null {
  if (progress.nextItem) return itemView(slug)(progress.nextItem)
  const exam = progress.finalExam
  return exam && !exam.done ? { type: 'final_exam', id: exam.id, title: exam.title, sectionId: null, sectionTitle: '', minutes: 0, done: false, href: itemHref(slug, 'final_exam', exam.id) } : null
}

export function coursePlanView(plan: GuidedPlan, row: LearnerRow, now: number): CoursePlanView {
  const progress = progressFor(plan, row, now)
  const slug = row.slug
  const guided = progress.pace === 'guided'
  return {
    courseId: Number(row.course_id),
    slug,
    title: row.title,
    pace: progress.pace,
    weeks: progress.weeks,
    planVersion: plan.planVersion,
    startedAt: progress.startedOn,
    currentWeek: progress.currentWeek,
    ...(guided ? { status: progress.status, weeksBehind: progress.weeksBehind } : {}),
    finishBy: progress.finishBy,
    ...(guided && progress.projectedFinish !== undefined ? { projectedFinish: progress.projectedFinish } : {}),
    thisWeek: weekView(slug, progress.thisWeek, progress),
    ...(guided ? { overdue: (progress.overdue ?? []).map(itemView(slug)) } : {}),
    nextItem: nextItemView(slug, progress),
    plan: progress.plan.map((week) => weekView(slug, week, progress)),
    resetAvailableAt: progress.resetAvailableAt,
    canReset: progress.canReset,
    resetCount: Number(row.plan_reset_count ?? 0),
  }
}

export interface PlanSummaryView {
  courseId: number
  slug: string
  title: string
  pace: Pace
  currentWeek: number
  weeks: number
  status?: PlanStatus
  weeksBehind?: number
  thisWeek: { week: number; doneCount: number; totalCount: number; minutesLeft: number }
  nextItem: PlanItemView | null
  resetAvailableAt: string | null
  canReset: boolean
}

export function planSummaryView(plan: GuidedPlan, row: LearnerRow, now: number): PlanSummaryView {
  const progress = progressFor(plan, row, now)
  const week = progress.thisWeek
  const guided = progress.pace === 'guided'
  return {
    courseId: Number(row.course_id),
    slug: row.slug,
    title: row.title,
    pace: progress.pace,
    currentWeek: progress.currentWeek,
    weeks: progress.weeks,
    ...(guided ? { status: progress.status, weeksBehind: progress.weeksBehind } : {}),
    thisWeek: { week: week.week, doneCount: week.doneCount, totalCount: week.totalCount, minutesLeft: week.items.filter((item) => !item.done).reduce((sum, item) => sum + item.minutes, 0) },
    nextItem: nextItemView(row.slug, progress),
    resetAvailableAt: progress.resetAvailableAt,
    canReset: progress.canReset,
  }
}

/* ------------------------------------------------------------------------ */
/* Operations                                                               */
/* ------------------------------------------------------------------------ */

async function enrolmentRow(payload: Payload, userId: number, courseId: number): Promise<LearnerRow | null> {
  const [row] = await query<LearnerRow>(payload, learnerRowsSql(sql`e.student_id = ${userId} AND e.course_id = ${courseId} AND e.status <> 'refunded'`, undefined, 1))
  return row ?? null
}

async function enrolmentRowById(payload: Payload, enrollmentId: number): Promise<LearnerRow | null> {
  const [row] = await query<LearnerRow>(payload, learnerRowsSql(sql`e.id = ${enrollmentId}`, undefined, 1))
  return row ?? null
}

/** An admin opening a programme they aren't enrolled in sees the plan as a learner starting today. */
async function adminPreviewRow(payload: Payload, userId: number, courseId: number): Promise<LearnerRow | null> {
  const course = await payload.findByID({ collection: 'courses', id: courseId, depth: 0, overrideAccess: true }).catch(() => null) as { slug?: string; title?: string; isBonus?: boolean | null } | null
  if (!course?.slug) return null
  const now = new Date().toISOString()
  return { id: 0, student_id: userId, course_id: courseId, status: 'active', pace: 'guided', plan_started_at: now, enrolled_at: now, plan_reset_count: 0, plan_reset_at: null, slug: course.slug, title: course.title ?? '', is_bonus: course.isBonus ?? false, lessons: [], quizzes: [], last_progress_at: null }
}

async function requirePlanRow(payload: Payload, user: AuthUser, courseId: number): Promise<LearnerRow> {
  const row = (await enrolmentRow(payload, user.id, courseId)) ?? (user.role === 'admin' ? await adminPreviewRow(payload, user.id, courseId) : null)
  if (!row) throw new AppError('INSUFFICIENT_PERMISSION', 'You are not enrolled in this programme')
  // Bonus courses (Freelancer's Academy, CV & LinkedIn) have no plan.
  if (row.is_bonus) throw new AppError('NOT_FOUND', 'This course has no learning plan')
  return row
}

async function planFor(payload: Payload, courseId: number): Promise<GuidedPlan> {
  const plan = (await coursePlans(payload, [courseId])).get(courseId)
  if (!plan || !plan.schedule.some((week) => week.items.length)) throw new AppError('NOT_FOUND', 'This programme has no learning plan yet')
  return plan
}

export async function getCoursePlan(payload: Payload, user: AuthUser, courseId: number, now = Date.now()): Promise<CoursePlanView> {
  const row = await requirePlanRow(payload, user, courseId)
  return coursePlanView(await planFor(payload, courseId), row, now)
}

/** Every active, non-bonus enrolment: three statements at most, whatever the number of programmes. */
export async function getMyPlans(payload: Payload, userId: number, now = Date.now()): Promise<PlanSummaryView[]> {
  const rows = await query<LearnerRow>(payload, learnerRowsSql(sql`e.student_id = ${userId} AND e.status = 'active' AND c.is_bonus IS NOT TRUE`))
  if (!rows.length) return []
  const plans = await coursePlans(payload, rows.map((row) => Number(row.course_id)))
  return rows.flatMap((row) => {
    const plan = plans.get(Number(row.course_id))
    return plan && plan.schedule.some((week) => week.items.length) ? [planSummaryView(plan, row, now)] : []
  })
}

/**
 * Guided or self-paced. Switching (back) to guided places the plan so the learner's first
 * incomplete item falls in the current week, so nobody comes back to "behind".
 */
export async function setPace(payload: Payload, user: AuthUser, courseId: number, pace: Pace, now = Date.now()): Promise<CoursePlanView> {
  const row = await requirePlanRow(payload, user, courseId)
  if (!row.id) throw new AppError('INSUFFICIENT_PERMISSION', 'You are not enrolled in this programme')
  const plan = await planFor(payload, courseId)
  const current: Pace = row.pace === 'self_paced' ? 'self_paced' : 'guided'
  if (current !== pace) {
    const at = new Date(now).toISOString()
    const data: Record<string, unknown> = { pace, paceChangedAt: at }
    if (pace === 'guided') data.planStartedAt = new Date(movedPlanStart(progressFor(plan, row, now).firstIncompleteWeek, now)).toISOString()
    await payload.update({ collection: 'enrollments', id: row.id, data: data as never, depth: 0, overrideAccess: true })
    const { onLifecycleEvent } = await import('./lifecycle/events.js')
    await onLifecycleEvent(payload, { type: 'plan_pace_changed', userId: Number(row.student_id), courseId, enrollmentId: row.id, from: current, to: pace })
  }
  const fresh = await enrolmentRowById(payload, row.id)
  return coursePlanView(plan, fresh ?? row, now)
}

/**
 * "Move my plan": the week of the first incomplete item becomes this week. Learners who are
 * behind (or past the last week) only, once every 14 days; never for a finished plan. Admins
 * (Studio, Learner 360) bypass the cooldown and the "behind" check.
 */
export async function resetPlanForRow(payload: Payload, row: LearnerRow, options: { admin?: boolean } = {}, now = Date.now()): Promise<CoursePlanView> {
  if (row.is_bonus) throw new AppError('NOT_FOUND', 'This course has no learning plan')
  const plan = await planFor(payload, Number(row.course_id))
  const progress = progressFor(plan, { ...row, pace: 'guided' }, now)
  if (progress.status === 'finished') throw new AppError('PLAN_FINISHED', "You've finished every week of your plan.")
  if (!options.admin) {
    if (row.pace === 'self_paced') throw new AppError('VALIDATION_ERROR', 'Switch to the guided plan first.')
    if (progress.status !== 'behind' && progress.status !== 'overrun') throw new AppError('VALIDATION_ERROR', "Your plan is on track. There's nothing to move.")
    if (!progress.canReset) {
      throw new AppError('PLAN_RESET_COOLDOWN', 'You moved your plan recently. You can move it again soon.', { retryAt: progress.resetAvailableAt ?? new Date(now).toISOString() })
    }
  }
  const at = new Date(now).toISOString()
  await payload.update({
    collection: 'enrollments',
    id: row.id,
    data: { planStartedAt: new Date(movedPlanStart(progress.firstIncompleteWeek, now)).toISOString(), planResetCount: Number(row.plan_reset_count ?? 0) + 1, planResetAt: at } as never,
    depth: 0,
    overrideAccess: true,
  })
  logger.info({ enrollmentId: row.id, week: progress.firstIncompleteWeek, admin: Boolean(options.admin) }, 'guided_plan_reset')
  const fresh = await enrolmentRowById(payload, row.id)
  return coursePlanView(plan, fresh ?? row, now)
}

export async function resetPlan(payload: Payload, user: AuthUser, courseId: number, now = Date.now()): Promise<CoursePlanView> {
  const row = await requirePlanRow(payload, user, courseId)
  if (!row.id) throw new AppError('INSUFFICIENT_PERMISSION', 'You are not enrolled in this programme')
  return resetPlanForRow(payload, row, {}, now)
}

/** Studio: reset an enrolment's plan (no cooldown). */
export async function adminResetPlan(payload: Payload, enrollmentId: number, now = Date.now()): Promise<CoursePlanView> {
  const row = await enrolmentRowById(payload, enrollmentId)
  if (!row) throw new AppError('NOT_FOUND', 'Enrolment not found')
  return resetPlanForRow(payload, row, { admin: true }, now)
}

/* ------------------------------------------------------------------------ */
/* Nightly snapshot for the Studio Overview                                 */
/* ------------------------------------------------------------------------ */

export const PACE_SNAPSHOT_KEY = 'metrics:guided-plan-pace'

export interface PaceSnapshot {
  computedAt: string
  /** Active, non-bonus enrolments with a plan. */
  total: number
  guided: number
  onTrackOrAhead: number
  behind: number
  selfPaced: number
  /** Shares of all enrolments counted (0..1). */
  onTrackShare: number | null
  behindShare: number | null
  selfPacedShare: number | null
}

export async function readPaceSnapshot(): Promise<PaceSnapshot | null> {
  const raw = await cacheGet(PACE_SNAPSHOT_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as PaceSnapshot
  } catch {
    return null
  }
}
