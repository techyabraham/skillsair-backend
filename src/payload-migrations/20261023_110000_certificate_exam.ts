import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * Pay first, then the exam: certificate entitlements (created when the certificate is paid for,
 * passed when the final exam is passed) and the exam result band on certificates.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TYPE "public"."enum_certificates_score_band" AS ENUM('passed', 'distinction');
    CREATE TYPE "public"."enum_certificate_entitlements_status" AS ENUM('awaiting_exam', 'passed', 'refunded');
    CREATE TABLE "certificate_entitlements" (
    	"id" serial PRIMARY KEY NOT NULL,
    	"student_id" integer NOT NULL,
    	"course_id" integer NOT NULL,
    	"order_id" integer,
    	"status" "enum_certificate_entitlements_status" DEFAULT 'awaiting_exam' NOT NULL,
    	"paid_at" timestamp(3) with time zone,
    	"passed_at" timestamp(3) with time zone,
    	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
    );
    ALTER TABLE "certificates" ADD COLUMN "score_band" "enum_certificates_score_band";
    ALTER TABLE "certificates" ADD COLUMN "exam_score" numeric;
    ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "certificate_entitlements_id" integer;
    ALTER TABLE "certificate_entitlements" ADD CONSTRAINT "certificate_entitlements_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
    ALTER TABLE "certificate_entitlements" ADD CONSTRAINT "certificate_entitlements_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE set null ON UPDATE no action;
    ALTER TABLE "certificate_entitlements" ADD CONSTRAINT "certificate_entitlements_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;
    CREATE INDEX "certificate_entitlements_student_idx" ON "certificate_entitlements" USING btree ("student_id");
    CREATE INDEX "certificate_entitlements_course_idx" ON "certificate_entitlements" USING btree ("course_id");
    CREATE INDEX "certificate_entitlements_order_idx" ON "certificate_entitlements" USING btree ("order_id");
    CREATE INDEX "certificate_entitlements_updated_at_idx" ON "certificate_entitlements" USING btree ("updated_at");
    CREATE INDEX "certificate_entitlements_created_at_idx" ON "certificate_entitlements" USING btree ("created_at");
    CREATE INDEX "student_course_status_idx" ON "certificate_entitlements" USING btree ("student_id","course_id","status");
    ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_certificate_entitlements_fk" FOREIGN KEY ("certificate_entitlements_id") REFERENCES "public"."certificate_entitlements"("id") ON DELETE cascade ON UPDATE no action;
    CREATE INDEX "payload_locked_documents_rels_certificate_entitlements_i_idx" ON "payload_locked_documents_rels" USING btree ("certificate_entitlements_id");
    -- One certificate entitlement per learner and programme (refunded ones don't count).
    CREATE UNIQUE INDEX IF NOT EXISTS "certificate_entitlements_one_active" ON "certificate_entitlements" ("student_id", "course_id") WHERE "status" <> 'refunded';
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "certificate_entitlements_id";
    DROP TABLE IF EXISTS "certificate_entitlements" CASCADE;
    ALTER TABLE "certificates" DROP COLUMN IF EXISTS "score_band";
    ALTER TABLE "certificates" DROP COLUMN IF EXISTS "exam_score";
    DROP TYPE IF EXISTS "public"."enum_certificates_score_band";
    DROP TYPE IF EXISTS "public"."enum_certificate_entitlements_status";
  `)
}
