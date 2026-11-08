// Career Match quiz v2: the quiz profile on applicants (leads), saved quiz results for
// /quiz/result/<id>, and the per-career waitlist. Written by hand in Payload's naming, like the
// other post-snapshot migrations. Additive only; down drops exactly what up adds.
import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  CREATE TYPE "public"."enum_career_waitlist_source" AS ENUM('quiz', 'other');

  ALTER TABLE "leads" ADD COLUMN "quiz_version" varchar;
  ALTER TABLE "leads" ADD COLUMN "top_match" varchar;
  ALTER TABLE "leads" ADD COLUMN "top_open_match_id" integer;
  ALTER TABLE "leads" ADD COLUMN "quiz_scores" jsonb;
  ALTER TABLE "leads" ADD COLUMN "traits" jsonb;
  ALTER TABLE "leads" ADD COLUMN "quiz_answers" jsonb;
  ALTER TABLE "leads" ADD CONSTRAINT "leads_top_open_match_id_courses_id_fk" FOREIGN KEY ("top_open_match_id") REFERENCES "public"."courses"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "leads_top_open_match_idx" ON "leads" USING btree ("top_open_match_id");

  CREATE TABLE "quiz_results" (
    "id" serial PRIMARY KEY NOT NULL,
    "public_id" varchar NOT NULL,
    "quiz_version" varchar NOT NULL,
    "first_name" varchar,
    "lead_id" integer,
    "user_id" integer,
    "top_match" varchar,
    "top_open_match_id" integer,
    "answers" jsonb,
    "tie_breaker" varchar,
    "scores" jsonb,
    "traits" jsonb,
    "context" jsonb,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "career_waitlist" (
    "id" serial PRIMARY KEY NOT NULL,
    "lead_id" integer NOT NULL,
    "career" varchar NOT NULL,
    "joined_at" timestamp(3) with time zone NOT NULL,
    "source" "enum_career_waitlist_source" DEFAULT 'quiz' NOT NULL,
    "notified_at" timestamp(3) with time zone,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  ALTER TABLE "quiz_results" ADD CONSTRAINT "quiz_results_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "quiz_results" ADD CONSTRAINT "quiz_results_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "quiz_results" ADD CONSTRAINT "quiz_results_top_open_match_id_courses_id_fk" FOREIGN KEY ("top_open_match_id") REFERENCES "public"."courses"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "career_waitlist" ADD CONSTRAINT "career_waitlist_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;

  CREATE UNIQUE INDEX "quiz_results_public_id_idx" ON "quiz_results" USING btree ("public_id");
  CREATE INDEX "quiz_results_lead_idx" ON "quiz_results" USING btree ("lead_id");
  CREATE INDEX "quiz_results_user_idx" ON "quiz_results" USING btree ("user_id");
  CREATE INDEX "quiz_results_top_match_idx" ON "quiz_results" USING btree ("top_match");
  CREATE INDEX "quiz_results_top_open_match_idx" ON "quiz_results" USING btree ("top_open_match_id");
  CREATE INDEX "quiz_results_updated_at_idx" ON "quiz_results" USING btree ("updated_at");
  CREATE INDEX "quiz_results_created_at_idx" ON "quiz_results" USING btree ("created_at");
  CREATE INDEX "career_waitlist_lead_idx" ON "career_waitlist" USING btree ("lead_id");
  CREATE INDEX "career_waitlist_career_idx" ON "career_waitlist" USING btree ("career");
  CREATE INDEX "career_waitlist_notified_at_idx" ON "career_waitlist" USING btree ("notified_at");
  CREATE INDEX "career_waitlist_updated_at_idx" ON "career_waitlist" USING btree ("updated_at");
  CREATE INDEX "career_waitlist_created_at_idx" ON "career_waitlist" USING btree ("created_at");
  CREATE UNIQUE INDEX "lead_career_idx" ON "career_waitlist" USING btree ("lead_id","career");

  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "quiz_results_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "career_waitlist_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_quiz_results_fk" FOREIGN KEY ("quiz_results_id") REFERENCES "public"."quiz_results"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_career_waitlist_fk" FOREIGN KEY ("career_waitlist_id") REFERENCES "public"."career_waitlist"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_quiz_results_id_idx" ON "payload_locked_documents_rels" USING btree ("quiz_results_id");
  CREATE INDEX "payload_locked_documents_rels_career_waitlist_id_idx" ON "payload_locked_documents_rels" USING btree ("career_waitlist_id");
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_quiz_results_fk";
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_career_waitlist_fk";
  DROP INDEX "payload_locked_documents_rels_quiz_results_id_idx";
  DROP INDEX "payload_locked_documents_rels_career_waitlist_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "quiz_results_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "career_waitlist_id";

  DROP TABLE "quiz_results" CASCADE;
  DROP TABLE "career_waitlist" CASCADE;
  DROP TYPE "public"."enum_career_waitlist_source";

  ALTER TABLE "leads" DROP CONSTRAINT "leads_top_open_match_id_courses_id_fk";
  DROP INDEX "leads_top_open_match_idx";
  ALTER TABLE "leads" DROP COLUMN "quiz_version";
  ALTER TABLE "leads" DROP COLUMN "top_match";
  ALTER TABLE "leads" DROP COLUMN "top_open_match_id";
  ALTER TABLE "leads" DROP COLUMN "quiz_scores";
  ALTER TABLE "leads" DROP COLUMN "traits";
  ALTER TABLE "leads" DROP COLUMN "quiz_answers";
  `)
}
