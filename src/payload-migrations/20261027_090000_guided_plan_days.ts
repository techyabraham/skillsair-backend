import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'
import { placeLearners } from '../lib/guided-plan-placement.js'

/**
 * The guided plan becomes a Monday-to-Friday daily plan (follow-up to 20261025_090000_guided_plan,
 * which may already have run in production, so it is left as it was):
 * - the pace value self_paced is renamed chapters ("chapter view"), keeping every row's choice;
 * - learners who have never moved their plan are placed again under the daily rules, so their
 *   first unfinished item falls on today and nobody becomes "behind" overnight. Learners who have
 *   moved their plan keep their dates.
 * Runs once (recorded in payload_migrations); the rename is skipped when already done.
 */
export async function up({ db, payload }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'enum_enrollments_pace' AND e.enumlabel = 'self_paced') THEN
        ALTER TYPE "public"."enum_enrollments_pace" RENAME VALUE 'self_paced' TO 'chapters';
      END IF;
    END $$;
  `)
  const result = await placeLearners(db, sql`coalesce(e.plan_reset_count, 0) = 0`)
  payload?.logger?.info({ msg: 'guided_plan_days_placement', ...result })
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  // Plan dates are not restored (the weekly plan places learners again from the day it runs).
  await db.execute(sql`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'enum_enrollments_pace' AND e.enumlabel = 'chapters') THEN
        ALTER TYPE "public"."enum_enrollments_pace" RENAME VALUE 'chapters' TO 'self_paced';
      END IF;
    END $$;
  `)
}
