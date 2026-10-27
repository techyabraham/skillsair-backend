import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'
import { placeLearners } from '../lib/guided-plan-placement.js'

/**
 * Guided 12-week plan: each enrolment gains a pace (guided by default, or self-paced), the day
 * its plan started, and reset bookkeeping. Index on pace; (student, course) is already covered by
 * enrollments_student_course_status_idx (20261023_120000_scale_indexes).
 *
 * Backfill, active enrolments only, so nobody becomes "behind" overnight (src/lib/guided-plan-placement.ts):
 * - no progress: the plan starts today;
 * - some progress: the plan starts so their first unfinished item falls on today, so they're on
 *   track in the week and on the day they've reached.
 * Idempotent: only rows where plan_started_at IS NULL are touched, 1,000 at a time (row locks
 * only, never a table lock). 20261027_090000_guided_plan_days re-places learners for the daily plan.
 */
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
  const result = await placeLearners(db, sql`e.plan_started_at IS NULL`)
  payload?.logger?.info({ msg: 'guided_plan_backfill', ...result })
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
