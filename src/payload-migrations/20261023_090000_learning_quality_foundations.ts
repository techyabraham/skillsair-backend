import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * Learning quality, phase 1:
 *   - programmes lose `level` (no Beginner/Intermediate/Advanced anywhere); the old values are
 *     written to the migration log first
 *   - new programme copy fields: who it's for, tools covered, career paths, FAQ, keywords, and a
 *     content history kept before each content import
 *   - assessments: quiz kinds (knowledge check, chapter quiz, final exam) with draw, timer, attempt
 *     and cooldown settings; questions with types, several correct answers, explanations, pools,
 *     status, stable keys and item statistics; attempts with served questions, timer and status
 * Existing questions become `approved` with their answer copied into `correctIndexes`, so
 * current quizzes keep working.
 */
export async function up({ db, payload }: MigrateUpArgs): Promise<void> {
  // Keep a record of the levels being removed.
  const hasLevel = await db.execute(sql`SELECT 1 FROM information_schema.columns WHERE table_name = 'courses' AND column_name = 'level'`)
  if (hasLevel.rows.length) {
    const levels = await db.execute(sql`SELECT id, slug, level FROM courses ORDER BY id`)
    payload.logger.info({ msg: 'courses.level before removal', levels: levels.rows })
  }
  await db.execute(sql`
    ALTER TABLE "courses" DROP COLUMN IF EXISTS "level";
    DROP TYPE IF EXISTS "public"."enum_courses_level";
    CREATE TYPE "public"."enum_quizzes_kind" AS ENUM('knowledge_check', 'chapter', 'final_exam');
    CREATE TYPE "public"."enum_quiz_questions_pools" AS ENUM('knowledge_check', 'chapter', 'exam');
    CREATE TYPE "public"."enum_quiz_questions_type" AS ENUM('single', 'multiple', 'true_false');
    CREATE TYPE "public"."enum_quiz_questions_status" AS ENUM('draft', 'approved', 'retired');
    CREATE TYPE "public"."enum_quiz_questions_origin" AS ENUM('content_pack', 'manual');
    CREATE TYPE "public"."enum_quiz_attempts_status" AS ENUM('in_progress', 'submitted', 'expired');
    CREATE TABLE "courses_who_its_for" (
    	"_order" integer NOT NULL,
    	"_parent_id" integer NOT NULL,
    	"id" varchar PRIMARY KEY NOT NULL,
    	"item" varchar NOT NULL
    );
    CREATE TABLE "courses_tools_covered" (
    	"_order" integer NOT NULL,
    	"_parent_id" integer NOT NULL,
    	"id" varchar PRIMARY KEY NOT NULL,
    	"tool" varchar NOT NULL
    );
    CREATE TABLE "courses_career_paths" (
    	"_order" integer NOT NULL,
    	"_parent_id" integer NOT NULL,
    	"id" varchar PRIMARY KEY NOT NULL,
    	"role" varchar NOT NULL
    );
    CREATE TABLE "courses_faq" (
    	"_order" integer NOT NULL,
    	"_parent_id" integer NOT NULL,
    	"id" varchar PRIMARY KEY NOT NULL,
    	"question" varchar NOT NULL,
    	"answer" varchar NOT NULL
    );
    CREATE TABLE "courses_secondary_keywords" (
    	"_order" integer NOT NULL,
    	"_parent_id" integer NOT NULL,
    	"id" varchar PRIMARY KEY NOT NULL,
    	"keyword" varchar NOT NULL
    );
    CREATE TABLE "courses_content_history" (
    	"_order" integer NOT NULL,
    	"_parent_id" integer NOT NULL,
    	"id" varchar PRIMARY KEY NOT NULL,
    	"saved_at" timestamp(3) with time zone NOT NULL,
    	"source" varchar,
    	"snapshot" jsonb NOT NULL
    );
    CREATE TABLE "quiz_questions_pools" (
    	"order" integer NOT NULL,
    	"parent_id" integer NOT NULL,
    	"value" "enum_quiz_questions_pools",
    	"id" serial PRIMARY KEY NOT NULL
    );
    CREATE TABLE "quiz_questions_numbers" (
    	"id" serial PRIMARY KEY NOT NULL,
    	"number" numeric,
    	"order" integer NOT NULL,
    	"parent_id" integer NOT NULL,
    	"path" varchar NOT NULL
    );
    ALTER TABLE "quiz_questions" ALTER COLUMN "correct_index" DROP NOT NULL;
    ALTER TABLE "quiz_attempts" ALTER COLUMN "score" DROP NOT NULL;
    ALTER TABLE "quiz_attempts" ALTER COLUMN "passed" DROP DEFAULT;
    ALTER TABLE "quiz_attempts" ALTER COLUMN "passed" DROP NOT NULL;
    ALTER TABLE "quizzes" ADD COLUMN "kind" "enum_quizzes_kind" DEFAULT 'chapter' NOT NULL;
    ALTER TABLE "quizzes" ADD COLUMN "section_id" integer;
    ALTER TABLE "quizzes" ADD COLUMN "lesson_id" integer;
    ALTER TABLE "quizzes" ADD COLUMN "draw_count" numeric;
    ALTER TABLE "quizzes" ADD COLUMN "time_limit_minutes" numeric;
    ALTER TABLE "quizzes" ADD COLUMN "max_attempts" numeric;
    ALTER TABLE "quizzes" ADD COLUMN "cooldown_hours" numeric;
    ALTER TABLE "quizzes" ADD COLUMN "shuffle" boolean DEFAULT true;
    ALTER TABLE "quizzes" ADD COLUMN "weight_by_chapter" boolean DEFAULT false;
    ALTER TABLE "quiz_questions" ADD COLUMN "type" "enum_quiz_questions_type" DEFAULT 'single' NOT NULL;
    ALTER TABLE "quiz_questions" ADD COLUMN "explanation" jsonb;
    ALTER TABLE "quiz_questions" ADD COLUMN "course_id" integer;
    ALTER TABLE "quiz_questions" ADD COLUMN "section_id" integer;
    ALTER TABLE "quiz_questions" ADD COLUMN "lesson_id" integer;
    ALTER TABLE "quiz_questions" ADD COLUMN "source_timestamp" varchar;
    ALTER TABLE "quiz_questions" ADD COLUMN "status" "enum_quiz_questions_status" DEFAULT 'draft' NOT NULL;
    ALTER TABLE "quiz_questions" ADD COLUMN "origin" "enum_quiz_questions_origin" DEFAULT 'manual' NOT NULL;
    ALTER TABLE "quiz_questions" ADD COLUMN "key" varchar;
    ALTER TABLE "quiz_questions" ADD COLUMN "stats_times_served" numeric DEFAULT 0;
    ALTER TABLE "quiz_questions" ADD COLUMN "stats_p_value" numeric;
    ALTER TABLE "quiz_questions" ADD COLUMN "stats_discrimination" numeric;
    ALTER TABLE "quiz_attempts" ADD COLUMN "status" "enum_quiz_attempts_status" DEFAULT 'submitted' NOT NULL;
    ALTER TABLE "quiz_attempts" ADD COLUMN "attempt_number" numeric;
    ALTER TABLE "quiz_attempts" ADD COLUMN "served_question_ids" jsonb;
    ALTER TABLE "quiz_attempts" ADD COLUMN "served_option_order" jsonb;
    ALTER TABLE "quiz_attempts" ADD COLUMN "per_section_scores" jsonb;
    ALTER TABLE "quiz_attempts" ADD COLUMN "started_at" timestamp(3) with time zone;
    ALTER TABLE "quiz_attempts" ADD COLUMN "expires_at" timestamp(3) with time zone;
    ALTER TABLE "quiz_attempts" ADD COLUMN "submitted_at" timestamp(3) with time zone;
    ALTER TABLE "courses" ADD COLUMN "primary_keyword" varchar;
    ALTER TABLE "courses" ADD COLUMN IF NOT EXISTS "drive_folder_id" varchar;
    ALTER TABLE "courses_who_its_for" ADD CONSTRAINT "courses_who_its_for_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "courses_tools_covered" ADD CONSTRAINT "courses_tools_covered_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "courses_career_paths" ADD CONSTRAINT "courses_career_paths_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "courses_faq" ADD CONSTRAINT "courses_faq_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "courses_secondary_keywords" ADD CONSTRAINT "courses_secondary_keywords_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "courses_content_history" ADD CONSTRAINT "courses_content_history_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "quiz_questions_pools" ADD CONSTRAINT "quiz_questions_pools_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."quiz_questions"("id") ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "quiz_questions_numbers" ADD CONSTRAINT "quiz_questions_numbers_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."quiz_questions"("id") ON DELETE cascade ON UPDATE no action;
    CREATE INDEX "courses_who_its_for_order_idx" ON "courses_who_its_for" USING btree ("_order");
    CREATE INDEX "courses_who_its_for_parent_id_idx" ON "courses_who_its_for" USING btree ("_parent_id");
    CREATE INDEX "courses_tools_covered_order_idx" ON "courses_tools_covered" USING btree ("_order");
    CREATE INDEX "courses_tools_covered_parent_id_idx" ON "courses_tools_covered" USING btree ("_parent_id");
    CREATE INDEX "courses_career_paths_order_idx" ON "courses_career_paths" USING btree ("_order");
    CREATE INDEX "courses_career_paths_parent_id_idx" ON "courses_career_paths" USING btree ("_parent_id");
    CREATE INDEX "courses_faq_order_idx" ON "courses_faq" USING btree ("_order");
    CREATE INDEX "courses_faq_parent_id_idx" ON "courses_faq" USING btree ("_parent_id");
    CREATE INDEX "courses_secondary_keywords_order_idx" ON "courses_secondary_keywords" USING btree ("_order");
    CREATE INDEX "courses_secondary_keywords_parent_id_idx" ON "courses_secondary_keywords" USING btree ("_parent_id");
    CREATE INDEX "courses_content_history_order_idx" ON "courses_content_history" USING btree ("_order");
    CREATE INDEX "courses_content_history_parent_id_idx" ON "courses_content_history" USING btree ("_parent_id");
    CREATE INDEX "quiz_questions_pools_order_idx" ON "quiz_questions_pools" USING btree ("order");
    CREATE INDEX "quiz_questions_pools_parent_idx" ON "quiz_questions_pools" USING btree ("parent_id");
    CREATE INDEX "quiz_questions_numbers_order_parent_idx" ON "quiz_questions_numbers" USING btree ("order","parent_id");
    ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE set null ON UPDATE no action;
    ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE set null ON UPDATE no action;
    ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE set null ON UPDATE no action;
    ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE set null ON UPDATE no action;
    ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE set null ON UPDATE no action;
    CREATE INDEX "quizzes_section_idx" ON "quizzes" USING btree ("section_id");
    CREATE INDEX "quizzes_lesson_idx" ON "quizzes" USING btree ("lesson_id");
    CREATE INDEX "quiz_questions_course_idx" ON "quiz_questions" USING btree ("course_id");
    CREATE INDEX "quiz_questions_section_idx" ON "quiz_questions" USING btree ("section_id");
    CREATE INDEX "quiz_questions_lesson_idx" ON "quiz_questions" USING btree ("lesson_id");
    CREATE UNIQUE INDEX "quiz_questions_key_idx" ON "quiz_questions" USING btree ("key");
  `)

  // Data: answers into the new list; existing questions stay live (approved).
  await db.execute(sql`
    INSERT INTO "quiz_questions_numbers" ("number", "order", "parent_id", "path")
      SELECT q."correct_index", 1, q."id", 'correctIndexes' FROM "quiz_questions" q
      WHERE q."correct_index" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "quiz_questions_numbers" n WHERE n."parent_id" = q."id" AND n."path" = 'correctIndexes');
    UPDATE "quiz_questions" SET "status" = 'approved' WHERE "status" = 'draft';
  `)

  // Rules the admin also checks (one chapter quiz per chapter, one final exam per programme, one
  // in-progress attempt per learner per quiz), plus indexes for the assessment queries.
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "quizzes_one_chapter_quiz_per_section" ON "quizzes" ("section_id") WHERE "kind" = 'chapter' AND "section_id" IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS "quizzes_one_final_exam_per_course" ON "quizzes" ("course_id") WHERE "kind" = 'final_exam';
    CREATE UNIQUE INDEX IF NOT EXISTS "quiz_attempts_one_in_progress" ON "quiz_attempts" ("student_id", "quiz_id") WHERE "status" = 'in_progress';
    CREATE INDEX IF NOT EXISTS "student_quiz_status_idx" ON "quiz_attempts" USING btree ("student_id", "quiz_id", "status");
    CREATE INDEX IF NOT EXISTS "course_section_status_idx" ON "quiz_questions" USING btree ("course_id", "section_id", "status");
    CREATE INDEX IF NOT EXISTS "quiz_questions_pools_parent_value_idx" ON "quiz_questions_pools" ("parent_id", "value");
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP INDEX IF EXISTS "quizzes_one_chapter_quiz_per_section";
    DROP INDEX IF EXISTS "quizzes_one_final_exam_per_course";
    DROP INDEX IF EXISTS "quiz_attempts_one_in_progress";
    DROP INDEX IF EXISTS "student_quiz_status_idx";
    DROP INDEX IF EXISTS "course_section_status_idx";
    DROP TABLE IF EXISTS "courses_who_its_for", "courses_tools_covered", "courses_career_paths", "courses_faq", "courses_secondary_keywords", "courses_content_history", "quiz_questions_pools", "quiz_questions_numbers" CASCADE;
    ALTER TABLE "quizzes" DROP COLUMN IF EXISTS "kind", DROP COLUMN IF EXISTS "section_id", DROP COLUMN IF EXISTS "lesson_id", DROP COLUMN IF EXISTS "draw_count", DROP COLUMN IF EXISTS "time_limit_minutes", DROP COLUMN IF EXISTS "max_attempts", DROP COLUMN IF EXISTS "cooldown_hours", DROP COLUMN IF EXISTS "shuffle", DROP COLUMN IF EXISTS "weight_by_chapter";
    ALTER TABLE "quiz_questions" DROP COLUMN IF EXISTS "type", DROP COLUMN IF EXISTS "explanation", DROP COLUMN IF EXISTS "course_id", DROP COLUMN IF EXISTS "section_id", DROP COLUMN IF EXISTS "lesson_id", DROP COLUMN IF EXISTS "source_timestamp", DROP COLUMN IF EXISTS "status", DROP COLUMN IF EXISTS "origin", DROP COLUMN IF EXISTS "key", DROP COLUMN IF EXISTS "stats_times_served", DROP COLUMN IF EXISTS "stats_p_value", DROP COLUMN IF EXISTS "stats_discrimination";
    ALTER TABLE "quiz_questions" ALTER COLUMN "correct_index" SET NOT NULL;
    ALTER TABLE "quiz_attempts" DROP COLUMN IF EXISTS "status", DROP COLUMN IF EXISTS "attempt_number", DROP COLUMN IF EXISTS "served_question_ids", DROP COLUMN IF EXISTS "served_option_order", DROP COLUMN IF EXISTS "per_section_scores", DROP COLUMN IF EXISTS "started_at", DROP COLUMN IF EXISTS "expires_at", DROP COLUMN IF EXISTS "submitted_at";
    ALTER TABLE "courses" DROP COLUMN IF EXISTS "primary_keyword";
    ALTER TABLE "courses" DROP COLUMN IF EXISTS "drive_folder_id";
    DROP TYPE IF EXISTS "public"."enum_quizzes_kind";
    DROP TYPE IF EXISTS "public"."enum_quiz_questions_type";
    DROP TYPE IF EXISTS "public"."enum_quiz_questions_pools";
    DROP TYPE IF EXISTS "public"."enum_quiz_questions_status";
    DROP TYPE IF EXISTS "public"."enum_quiz_questions_origin";
    DROP TYPE IF EXISTS "public"."enum_quiz_attempts_status";
    CREATE TYPE "public"."enum_courses_level" AS ENUM('beginner', 'intermediate', 'advanced');
    ALTER TABLE "courses" ADD COLUMN "level" "enum_courses_level" DEFAULT 'beginner' NOT NULL;
  `)
}
