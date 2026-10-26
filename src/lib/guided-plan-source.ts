/**
 * Guided plan, database side shared by the plan service, the migration backfill and
 * `npm run plan:preview`: one SQL statement loads the curriculum of any number of programmes
 * (published lessons with their chapter, published chapter quizzes and final exams), and
 * `plansFromRows` turns those rows into plans with the pure allocator.
 */
import { sql } from '@payloadcms/db-postgres'
import { buildGuidedPlan, planItems, type GuidedPlan, type SourceLesson, type SourceQuiz } from './guided-plan.js'

export interface PlanSourceRow {
  kind: 'lesson' | 'chapter' | 'final_exam'
  id: number | string
  title: string
  duration: number | string | null
  item_order: number | string | null
  section_id: number | string | null
  section_title: string | null
  section_order: number | string | null
  course_id: number | string
}

/** Integer ids only, so the list can be inlined safely. */
export function idList(ids: Array<number | string>): string {
  const clean = [...new Set(ids.map(Number).filter((id) => Number.isInteger(id) && id > 0))]
  return clean.length ? clean.join(',') : '0'
}

/** The curriculum rows for these programmes (one statement). */
export function planSourceSql(courseIds: Array<number | string>) {
  const ids = sql.raw(idList(courseIds))
  return sql`
    SELECT 'lesson' AS kind, l.id, l.title, l.duration, l."order" AS item_order, s.id AS section_id, s.title AS section_title, s."order" AS section_order, s.course_id
      FROM lessons l JOIN sections s ON s.id = l.section_id
      WHERE s.course_id IN (${ids}) AND l.is_published = true
    UNION ALL
    SELECT q.kind::text AS kind, q.id, q.title, NULL, NULL, q.section_id, NULL, NULL, q.course_id
      FROM quizzes q
      WHERE q.course_id IN (${ids}) AND q.is_published = true AND q.kind IN ('chapter', 'final_exam')
  `
}

const num = (value: unknown) => Number(value ?? 0) || 0

/** One plan per programme id in `courseIds` (a programme with no rows gets an empty plan). */
export function plansFromRows(courseIds: Array<number | string>, rows: PlanSourceRow[]): Map<number, GuidedPlan> {
  const byCourse = new Map<number, { lessons: SourceLesson[]; quizzes: SourceQuiz[]; exam: { id: number; title: string } | null }>()
  for (const id of courseIds) byCourse.set(Number(id), { lessons: [], quizzes: [], exam: null })
  for (const row of rows) {
    const entry = byCourse.get(Number(row.course_id))
    if (!entry) continue
    if (row.kind === 'lesson') {
      entry.lessons.push({
        id: num(row.id), title: row.title, duration: num(row.duration), order: num(row.item_order),
        sectionId: num(row.section_id), sectionTitle: row.section_title ?? '', sectionOrder: num(row.section_order),
      })
    } else if (row.kind === 'chapter') {
      entry.quizzes.push({ id: num(row.id), title: row.title, kind: 'chapter', sectionId: row.section_id === null ? null : num(row.section_id) })
    } else if (!entry.exam || num(row.id) < entry.exam.id) {
      entry.exam = { id: num(row.id), title: row.title }
    }
  }
  const plans = new Map<number, GuidedPlan>()
  for (const [courseId, entry] of byCourse) plans.set(courseId, buildGuidedPlan(planItems(entry.lessons, entry.quizzes), undefined, entry.exam))
  return plans
}

/** Week number of every item in a plan. */
export function itemWeeks(plan: GuidedPlan): Map<string, number> {
  const out = new Map<string, number>()
  for (const week of plan.schedule) for (const item of week.items) out.set(`${item.type}:${item.id}`, week.week)
  return out
}

/**
 * Week of the first incomplete item for a learner (1 when nothing is done; the last week
 * when everything is): used by the migration backfill to place existing learners on track.
 */
export function firstIncompleteWeek(plan: GuidedPlan, completedLessons: Set<number>, passedQuizzes: Set<number>): number {
  // No plan (a bonus course, or no published lessons): week 1.
  if (!plan.schedule.some((week) => week.items.length)) return 1
  for (const week of plan.schedule) {
    for (const item of week.items) {
      const done = item.type === 'lesson' ? completedLessons.has(item.id) : passedQuizzes.has(item.id)
      if (!done) return week.week
    }
  }
  return Math.max(1, plan.weeks)
}
