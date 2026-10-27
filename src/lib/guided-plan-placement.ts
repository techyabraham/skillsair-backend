/**
 * Places existing learners on their guided plan so nobody starts "behind": the plan start is set
 * so the learner's first unfinished item falls on today (on a weekend, next Monday); a learner
 * with no progress starts today. Used by the guided plan migrations (in batches of 1,000, keyset
 * on id, with the caller's row filter so each run is idempotent).
 */
import { sql } from '@payloadcms/db-postgres'
import { startForSlotToday, type GuidedPlan } from './guided-plan.js'
import { firstIncompleteSlotFor, idList, planSourceSql, plansFromRows, type PlanSourceRow } from './guided-plan-source.js'

type SQLQuery = ReturnType<typeof sql>
export interface MigrationDb {
  execute: (query: SQLQuery) => Promise<unknown>
}

const BATCH = 1000

async function rows<T>(db: MigrationDb, query: SQLQuery): Promise<T[]> {
  return ((await db.execute(query)) as { rows: T[] }).rows
}

/**
 * Sets plan_started_at for active enrolments matching `filter` (an SQL condition on alias `e`).
 * `guard` is repeated in the UPDATE, so a row that no longer matches is never touched.
 */
export async function placeLearners(db: MigrationDb, filter: SQLQuery, now = Date.now()): Promise<{ startedToday: number; placed: number }> {
  const plans = new Map<number, GuidedPlan>()
  let last = 0
  let placed = 0
  let startedToday = 0
  for (;;) {
    const batch = await rows<{ id: number; student_id: number; course_id: number }>(db, sql`
      SELECT e.id, e.student_id, e.course_id FROM enrollments e
      WHERE e.status = 'active' AND (${filter}) AND e.id > ${last}
      ORDER BY e.id LIMIT ${BATCH}
    `)
    if (!batch.length) break
    last = Number(batch[batch.length - 1]!.id)

    const missing = [...new Set(batch.map((row) => Number(row.course_id)))].filter((id) => !plans.has(id))
    if (missing.length) {
      const source = await rows<PlanSourceRow>(db, planSourceSql(missing))
      for (const [id, plan] of plansFromRows(missing, source)) plans.set(id, plan)
    }
    const students = sql.raw(idList(batch.map((row) => row.student_id)))
    const courses = sql.raw(idList(batch.map((row) => row.course_id)))
    const lessons = await rows<{ student_id: number; course_id: number; lesson_id: number }>(db, sql`
      SELECT student_id, course_id, lesson_id FROM lesson_progress
      WHERE is_completed = true AND student_id IN (${students}) AND course_id IN (${courses})
    `)
    const quizzes = await rows<{ student_id: number; quiz_id: number }>(db, sql`
      SELECT DISTINCT student_id, quiz_id FROM quiz_attempts WHERE passed = true AND student_id IN (${students})
    `)
    const doneLessons = new Map<string, Set<number>>()
    for (const row of lessons) {
      const key = `${row.student_id}:${row.course_id}`
      doneLessons.set(key, (doneLessons.get(key) ?? new Set()).add(Number(row.lesson_id)))
    }
    const passed = new Map<number, Set<number>>()
    for (const row of quizzes) passed.set(Number(row.student_id), (passed.get(Number(row.student_id)) ?? new Set()).add(Number(row.quiz_id)))

    const values = batch.map((row) => {
      const plan = plans.get(Number(row.course_id))
      const slot = plan ? firstIncompleteSlotFor(plan, doneLessons.get(`${row.student_id}:${row.course_id}`) ?? new Set(), passed.get(Number(row.student_id)) ?? new Set()) : 0
      if (slot > 0) placed++
      else startedToday++
      return `(${Number(row.id)}, '${new Date(startForSlotToday(slot, now)).toISOString()}')`
    })
    await db.execute(sql`
      UPDATE enrollments AS e SET plan_started_at = v.at::timestamptz
      FROM (VALUES ${sql.raw(values.join(', '))}) AS v(id, at)
      WHERE e.id = v.id AND e.status = 'active' AND (${filter})
    `)
  }
  return { startedToday, placed }
}
