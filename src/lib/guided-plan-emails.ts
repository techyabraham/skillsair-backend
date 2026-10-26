/**
 * Guided 12-week plan emails and the nightly pace snapshot (run by src/jobs/guided-plan.ts).
 *
 * - L1 (Monday 07:30 Lagos): this week's goals, to guided learners whose plan isn't finished.
 *   Not in week 1 when the plan started under 48 hours ago.
 * - L2 (Thursday 18:00 Lagos): to guided learners who are behind with 2+ overdue items and no
 *   lesson progress in 7 days; at most once every 14 days per enrolment.
 * Never to self-paced learners, bonus courses or learners without access right now.
 *
 * The scan pages active enrolments 500 at a time (keyset on id), one statement per page plus the
 * cached plans, and queues the chosen enrolments on the work queue; the worker sends them through
 * the lifecycle sender (dry-run, consent, "Learning reminders", the messages log and its
 * idempotency key: one L1/L2 per enrolment per day).
 */
import type { Payload } from 'payload'
import { sql } from '@payloadcms/db-postgres'
import { logger } from './logger.js'
import { cacheSet } from './cache.js'
import { enqueue } from './work-queue.js'
import { requireCourseAccess } from './course-access.js'
import { lagosDayNumber } from './lifecycle/timing.js'
import { loadPerson, type PlanEmailData } from './lifecycle/context.js'
import { sendEventStep } from './lifecycle/events.js'
import type { Stage } from './lifecycle/types.js'
import type { GuidedPlan, PlanProgress } from './guided-plan.js'
import { coursePlans, guidedPlanEnabled, itemHref, learnerRowsSql, PACE_SNAPSHOT_KEY, progressFor, query, type LearnerRow, type PaceSnapshot } from './guided-plan-service.js'

export type PlanStep = 'L1' | 'L2'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const PAGE = 500
/** Enrolments per queued task (the worker takes tasks one at a time, within its per-minute budget). */
const TASK_SIZE = 25

const ms = (value: string | null | undefined): number | null => {
  const parsed = value ? Date.parse(value) : NaN
  return Number.isFinite(parsed) ? parsed : null
}

const hasItems = (plan: GuidedPlan | undefined): plan is GuidedPlan => Boolean(plan?.schedule.some((week) => week.items.length))

/** Pure: should this enrolment get this step now? */
export function planEmailDue(step: PlanStep, row: Pick<LearnerRow, 'pace' | 'plan_started_at' | 'last_progress_at' | 'is_bonus' | 'status'>, progress: PlanProgress, now: number): boolean {
  if (row.is_bonus || row.status !== 'active' || row.pace === 'self_paced' || progress.pace !== 'guided') return false
  if (!progress.status || progress.status === 'finished') return false
  if (step === 'L1') {
    const started = ms(row.plan_started_at)
    return !(progress.currentWeek === 1 && started !== null && now - started < 48 * HOUR)
  }
  const lastProgress = ms(row.last_progress_at)
  return progress.status === 'behind' && (progress.overdue?.length ?? 0) >= 2 && (lastProgress === null || now - lastProgress >= 7 * DAY)
}

/** "2 h 10 min", "45 min". */
export function timeLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return hours ? `${hours} h${rest ? ` ${rest} min` : ''}` : `${rest} min`
}

const FRONTEND_URL = () => (process.env.FRONTEND_URL ?? 'https://skillsair.com').replace(/\/+$/, '')

/** What the plan emails show. This week's steps still to do (an ahead learner: the next week's). */
export function planEmailData(row: Pick<LearnerRow, 'slug'>, progress: PlanProgress): PlanEmailData | null {
  const pending = (week: PlanProgress['thisWeek']) => week.items.filter((item) => !item.done)
  const week = pending(progress.thisWeek).length ? progress.thisWeek : progress.plan.find((candidate) => candidate.week > progress.currentWeek && pending(candidate).length) ?? progress.thisWeek
  const items = pending(week)
  const next = progress.nextItem
  if (!next) return null
  const minutes = items.reduce((sum, item) => sum + item.minutes, 0)
  const site = FRONTEND_URL()
  return {
    week: progress.currentWeek,
    weeks: progress.weeks,
    items: items.map((item) => ({ title: item.title, minutes: item.minutes })),
    timeLabel: minutes ? timeLabel(minutes) : '',
    behind: progress.status === 'behind' || progress.status === 'overrun',
    overdueCount: progress.overdue?.length ?? 0,
    nextTitle: next.title,
    nextMinutes: next.minutes,
    nextUrl: `${site}${itemHref(row.slug, next.type, next.id)}`,
    planUrl: `${site}/dashboard/courses/${encodeURIComponent(row.slug)}/plan`,
  }
}

/** Pages every active, non-bonus enrolment (guided only, unless `allPaces`), 500 at a time. */
async function eachPage(payload: Payload, allPaces: boolean, visit: (rows: LearnerRow[], plans: Map<number, GuidedPlan>) => Promise<void>): Promise<void> {
  let last = 0
  for (;;) {
    const pace = allPaces ? sql`` : sql`AND coalesce(e.pace::text, 'guided') = 'guided'`
    const rows = await query<LearnerRow>(payload, learnerRowsSql(sql`e.status = 'active' AND c.is_bonus IS NOT TRUE ${pace} AND e.id > ${last}`, sql`e.id ASC`, PAGE))
    if (!rows.length) return
    last = Number(rows[rows.length - 1]!.id)
    await visit(rows, await coursePlans(payload, rows.map((row) => Number(row.course_id))))
    if (rows.length < PAGE) return
  }
}

/** The scan: queues the enrolments due this step. Returns how many were queued. */
export async function queuePlanEmails(payload: Payload, step: PlanStep, now = Date.now()): Promise<number> {
  if (!guidedPlanEnabled()) return 0
  const cycle = lagosDayNumber(now)
  let queued = 0
  await eachPage(payload, false, async (rows, plans) => {
    const due = rows.filter((row) => {
      const plan = plans.get(Number(row.course_id))
      return hasItems(plan) && planEmailDue(step, row, progressFor(plan, row, now), now)
    }).map((row) => Number(row.id))
    for (let i = 0; i < due.length; i += TASK_SIZE) {
      await enqueue('guided-plan-email', { step, enrollmentIds: due.slice(i, i + TASK_SIZE), cycle, at: now })
    }
    queued += due.length
  })
  logger.info({ step, queued }, 'guided_plan_emails_queued')
  return queued
}

async function sentRecently(payload: Payload, enrollmentId: number, step: PlanStep, days: number, now: number): Promise<boolean> {
  const result = await payload.count({
    collection: 'messages',
    where: { and: [{ stepId: { equals: step } }, { subjectId: { equals: `enr:${enrollmentId}` } }, { sentAt: { greater_than: new Date(now - days * DAY).toISOString() } }] },
    overrideAccess: true,
  })
  return result.totalDocs > 0
}

/** Worker: sends one queued batch. Every condition is checked again (things change between scan and send). */
export async function sendPlanEmails(payload: Payload, task: { step: PlanStep; enrollmentIds: number[]; cycle: number; at?: number }): Promise<void> {
  if (!guidedPlanEnabled()) return
  const now = Date.now()
  const ids = task.enrollmentIds.map(Number).filter((id) => Number.isInteger(id) && id > 0)
  if (!ids.length) return
  const rows = await query<LearnerRow>(payload, learnerRowsSql(sql`e.id IN (${sql.raw(ids.join(','))})`, sql`e.id ASC`))
  const plans = await coursePlans(payload, rows.map((row) => Number(row.course_id)))
  for (const row of rows) {
    try {
      const plan = plans.get(Number(row.course_id))
      if (!hasItems(plan)) continue
      const progress = progressFor(plan, row, now)
      if (!planEmailDue(task.step, row, progress, now)) continue
      if (task.step === 'L2' && (await sentRecently(payload, Number(row.id), 'L2', 14, now))) continue
      try {
        await requireCourseAccess(payload, Number(row.student_id), Number(row.course_id))
      } catch {
        continue // no access right now: no plan emails
      }
      const emailData = planEmailData(row, progress)
      const person = await loadPerson(payload, { type: 'user', id: Number(row.student_id) })
      if (!emailData || !person) continue
      const stage: Stage = { track: 'L', subjectId: `enr:${row.id}`, enteredAt: now, cycle: task.cycle, courseId: Number(row.course_id) }
      await sendEventStep(payload, person, task.step, stage, undefined, { plan: emailData })
    } catch (err) {
      logger.error({ err, enrollmentId: row.id, step: task.step }, 'guided_plan_email_failed')
    }
  }
}

/** Nightly: the share of guided learners on track or ahead, behind, and self-paced (Studio Overview). */
export async function computePaceSnapshot(payload: Payload, now = Date.now()): Promise<PaceSnapshot> {
  const counts = { total: 0, guided: 0, onTrackOrAhead: 0, behind: 0, selfPaced: 0 }
  await eachPage(payload, true, async (rows, plans) => {
    for (const row of rows) {
      const plan = plans.get(Number(row.course_id))
      if (!hasItems(plan)) continue
      counts.total++
      if (row.pace === 'self_paced') {
        counts.selfPaced++
        continue
      }
      counts.guided++
      const status = progressFor(plan, row, now).status
      if (status === 'behind' || status === 'overrun') counts.behind++
      else counts.onTrackOrAhead++
    }
  })
  const share = (part: number, whole: number) => (whole ? part / whole : null)
  const snapshot: PaceSnapshot = {
    computedAt: new Date(now).toISOString(),
    ...counts,
    onTrackShare: share(counts.onTrackOrAhead, counts.guided),
    behindShare: share(counts.behind, counts.guided),
    selfPacedShare: share(counts.selfPaced, counts.total),
  }
  // Kept for 8 days, so a missed night still shows the last snapshot.
  await cacheSet(PACE_SNAPSHOT_KEY, JSON.stringify(snapshot), 8 * 24 * 60 * 60)
  return snapshot
}
