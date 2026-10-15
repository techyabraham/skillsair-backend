import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/** Rebuild phase 2: laptop-support applications (one per learner per cohort). */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TYPE "public"."enum_laptop_applications_current_device" AS ENUM('none', 'phone_only', 'shared_laptop', 'old_laptop');
    CREATE TYPE "public"."enum_laptop_applications_status" AS ENUM('submitted', 'shortlisted', 'awarded', 'not_selected');
    CREATE TABLE "laptop_applications" (
      "id" serial PRIMARY KEY NOT NULL,
      "user_id" integer NOT NULL,
      "cohort_label" varchar NOT NULL,
      "certificate_id" integer NOT NULL,
      "story" varchar NOT NULL,
      "current_device" "enum_laptop_applications_current_device" NOT NULL,
      "planned_use" varchar NOT NULL,
      "consent_to_feature" boolean DEFAULT false,
      "status" "enum_laptop_applications_status" DEFAULT 'submitted' NOT NULL,
      "review_notes" varchar,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
    );
    ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "laptop_applications_id" integer;
    ALTER TABLE "laptop_applications" ADD CONSTRAINT "laptop_applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
    ALTER TABLE "laptop_applications" ADD CONSTRAINT "laptop_applications_certificate_id_certificates_id_fk" FOREIGN KEY ("certificate_id") REFERENCES "public"."certificates"("id") ON DELETE set null ON UPDATE no action;
    ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_laptop_applications_fk" FOREIGN KEY ("laptop_applications_id") REFERENCES "public"."laptop_applications"("id") ON DELETE cascade ON UPDATE no action;
    CREATE INDEX "laptop_applications_user_idx" ON "laptop_applications" USING btree ("user_id");
    CREATE INDEX "laptop_applications_cohort_label_idx" ON "laptop_applications" USING btree ("cohort_label");
    CREATE INDEX "laptop_applications_certificate_idx" ON "laptop_applications" USING btree ("certificate_id");
    CREATE INDEX "laptop_applications_updated_at_idx" ON "laptop_applications" USING btree ("updated_at");
    CREATE INDEX "laptop_applications_created_at_idx" ON "laptop_applications" USING btree ("created_at");
    CREATE INDEX "payload_locked_documents_rels_laptop_applications_id_idx" ON "payload_locked_documents_rels" USING btree ("laptop_applications_id");
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_laptop_applications_fk";
    DROP INDEX IF EXISTS "payload_locked_documents_rels_laptop_applications_id_idx";
    ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "laptop_applications_id";
    DROP TABLE "laptop_applications" CASCADE;
    DROP TYPE "public"."enum_laptop_applications_current_device";
    DROP TYPE "public"."enum_laptop_applications_status";
  `)
}
