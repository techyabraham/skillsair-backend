import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * Indexes for the hot learning paths at scale: progress heartbeats and completions look up one
 * learner's lesson row, enrolment progress counts a learner's rows per course, and access checks
 * find a learner's enrolment by course and status. Named here (not in the collection config)
 * because Payload names composite indexes without the table, which would collide.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "lesson_progress_student_lesson_idx" ON "lesson_progress" USING btree ("student_id","lesson_id");
    CREATE INDEX IF NOT EXISTS "lesson_progress_student_course_idx" ON "lesson_progress" USING btree ("student_id","course_id");
    CREATE INDEX IF NOT EXISTS "enrollments_student_course_status_idx" ON "enrollments" USING btree ("student_id","course_id","status");
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP INDEX IF EXISTS "lesson_progress_student_lesson_idx";
    DROP INDEX IF EXISTS "lesson_progress_student_course_idx";
    DROP INDEX IF EXISTS "enrollments_student_course_status_idx";
  `)
}
