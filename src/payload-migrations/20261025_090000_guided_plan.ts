import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'
import { lagosMidnight, PLAN_WEEK_MS, type GuidedPlan } from '../lib/guided-plan.js'
import { firstIncompleteWeek, idList, planSourceSql, plansFromRows, type PlanSourceRow } from '../lib/guided-plan-source.js'

/**
 * Guided 12-week plan: each enrolment gains a pace (guided by default, or self-paced), the day
 * its plan started, and reset bookkeeping. Index on pace; (student, course) is already covered by
 * enrollments_student_course_status_idx (20261023_120000_scale_indexes).
 *
 * Backfill, active enrolments only, so nobody becomes "behind" overnight:
 * - no progress: the plan starts today;
 * - some progress: the plan starts (K - 1) weeks ago, where K is the plan week of their first
 *   incomplete item, so they land on track in week K.
 * Idempotent: only rows where plan_started_at IS NULL are touched, 1,000 at a time (row locks
 * only, never a table lock).
 */
type Db = MigrateUpArgs['db']
type Rows<T> = { rows: T[] }

const BATCH = 1000

async function rows<T>(db: Db, query: ReturnType<typeof sql>): Promise<T[]> {
  return ((await db.execute(query)) as unknown as Rows<T>).rows
}

export async function up({ db, payload }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE "public"."enum_enrollments_pace" AS ENUM('guided', 'self_paced');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    ALTER TABLE "enrollments" ADD COLUMN IF NOT EXISTS "pace" "enum_enrollments_pace" DEFAULT 'guided';
    ALTER TABLE "enrollments" ADD COLUMN IF NOT EXISTS "plan_started_at" timestamp(3) with time zone;
    ALTER TABLE "enrollments" ADD COLUMN IF NOT EXISTS "plan_reset_count" numeric DEFAULT 0;
    ALTER TABLE "enrollments" ADD COLUMN IF NOT EXISTS "plan_reset_at" timestamp(3) with time zone;
    ALTER TABLE "enrollments" ADD COLUMN IF NOT EXISTS "pace_changed_at" timestamp(3) with time zone;
    CREATE INDEX IF NOT EXISTS "enrollments_pace_idx" ON "enrollments" USING btree ("pace");
  `)
  await backfill(db, payload?.logger)
}

async function backfill(db: Db, logger?: { info: (value: unknown) => void }): Promise<void> {
  const now = Date.now()
  const today = lagosMidnight(now)
  const plans = new Map<number, GuidedPlan>()
  let last = 0
  let placed = 0
  let started = 0
  for (;;) {
    const batch = await rows<{ id: number; student_id: number; course_id: number }>(db, sql`
      SELECT id, student_id, course_id FROM enrollments
      WHERE status = 'active' AND plan_started_at IS NULL AND id > ${last}
      ORDER BY id LIMIT ${BATCH}
    `)
    if (!batch.length) break
    last = Number(batch[batch.length - 1]!.id)

    const missing = [...new Set(batch.map((row) => Number(row.course_id)))].filter((id) => !plans.has(id))
    if (missing.length) {
      const source = await rows<PlanSourceRow>(db, planSourceSql(missing))
      for (const [id, plan] of plansFromRows(missing, source)) plans.set(id, plan)
    }
    const students = idList(batch.map((row) => row.student_id))
    const courses = idList(batch.map((row) => row.course_id))
    const lessons = await rows<{ student_id: number; course_id: number; lesson_id: number }>(db, sql`
      SELECT student_id, course_id, lesson_id FROM lesson_progress
      WHERE is_completed = true AND student_id IN (${sql.raw(students)}) AND course_id IN (${sql.raw(courses)})
    `)
    const quizzes = await rows<{ student_id: number; quiz_id: number }>(db, sql`
      SELECT DISTINCT student_id, quiz_id FROM quiz_attempts WHERE passed = true AND student_id IN (${sql.raw(students)})
    `)
    const doneLessons = new Map<string, Set<number>>()
    for (const row of lessons) {
      const key = `${row.student_id}:${row.course_id}`
      doneLessons.set(key, (doneLessons.get(key) ?? new Set()).add(Number(row.lesson_id)))
    }
    const passed = new Map<number, Set<number>>()
    for (const row of quizzes) passed.set(Number(row.student_id), (passed.get(Number(row.student_id)) ?? new Set()).add(Number(row.quiz_id)))

    const values = batch.map((row) => {
      const completed = doneLessons.get(`${row.student_id}:${row.course_id}`) ?? new Set<number>()
      const quizSet = passed.get(Number(row.student_id)) ?? new Set<number>()
      const plan = plans.get(Number(row.course_id))
      const week = plan && (completed.size || quizSet.size) ? firstIncompleteWeek(plan, completed, quizSet) : 1
      if (week > 1) placed++
      else started++
      return `(${Number(row.id)}, '${new Date(today - (week - 1) * PLAN_WEEK_MS).toISOString()}')`
    })
    await db.execute(sql`
      UPDATE enrollments AS e SET plan_started_at = v.at::timestamptz
      FROM (VALUES ${sql.raw(values.join(', '))}) AS v(id, at)
      WHERE e.id = v.id AND e.plan_started_at IS NULL
    `)
  }
  logger?.info({ msg: 'guided_plan_backfill', startedToday: started, placedInLaterWeek: placed })
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP INDEX IF EXISTS "enrollments_pace_idx";
    ALTER TABLE "enrollments" DROP COLUMN IF EXISTS "pace";
    ALTER TABLE "enrollments" DROP COLUMN IF EXISTS "plan_started_at";
    ALTER TABLE "enrollments" DROP COLUMN IF EXISTS "plan_reset_count";
    ALTER TABLE "enrollments" DROP COLUMN IF EXISTS "plan_reset_at";
    ALTER TABLE "enrollments" DROP COLUMN IF EXISTS "pace_changed_at";
    DROP TYPE IF EXISTS "public"."enum_enrollments_pace";
  `)
}
