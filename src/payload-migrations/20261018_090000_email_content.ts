import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * Lifecycle email content the owner fills in: a free exercise per school, next-programme
 * pairings per programme, the laptop-application deadline, and the Email content global
 * (founder anecdote, approved proof items).
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TABLE "courses_next_programmes" (
      "_order" integer NOT NULL,
      "_parent_id" integer NOT NULL,
      "id" varchar PRIMARY KEY NOT NULL,
      "programme_id" integer NOT NULL,
      "pairing_reason" varchar
    );
    CREATE TABLE "email_content_proof_items" (
      "_order" integer NOT NULL,
      "_parent_id" integer NOT NULL,
      "id" varchar PRIMARY KEY NOT NULL,
      "text" varchar NOT NULL,
      "attribution" varchar NOT NULL,
      "approved" boolean DEFAULT false
    );
    CREATE TABLE "email_content" (
      "id" serial PRIMARY KEY NOT NULL,
      "founder_anecdote" varchar,
      "updated_at" timestamp(3) with time zone,
      "created_at" timestamp(3) with time zone
    );
    ALTER TABLE "categories" ADD COLUMN "free_exercise" varchar;
    ALTER TABLE "scholarship_window" ADD COLUMN "laptop_applications_open" boolean DEFAULT false;
    ALTER TABLE "scholarship_window" ADD COLUMN "laptop_application_deadline" timestamp(3) with time zone;
    ALTER TABLE "courses_next_programmes" ADD CONSTRAINT "courses_next_programmes_programme_id_courses_id_fk" FOREIGN KEY ("programme_id") REFERENCES "public"."courses"("id") ON DELETE set null ON UPDATE no action;
    ALTER TABLE "courses_next_programmes" ADD CONSTRAINT "courses_next_programmes_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "email_content_proof_items" ADD CONSTRAINT "email_content_proof_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."email_content"("id") ON DELETE cascade ON UPDATE no action;
    CREATE INDEX "courses_next_programmes_order_idx" ON "courses_next_programmes" USING btree ("_order");
    CREATE INDEX "courses_next_programmes_parent_id_idx" ON "courses_next_programmes" USING btree ("_parent_id");
    CREATE INDEX "courses_next_programmes_programme_idx" ON "courses_next_programmes" USING btree ("programme_id");
    CREATE INDEX "email_content_proof_items_order_idx" ON "email_content_proof_items" USING btree ("_order");
    CREATE INDEX "email_content_proof_items_parent_id_idx" ON "email_content_proof_items" USING btree ("_parent_id");
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TABLE IF EXISTS "email_content_proof_items" CASCADE;
    DROP TABLE IF EXISTS "email_content" CASCADE;
    DROP TABLE IF EXISTS "courses_next_programmes" CASCADE;
    ALTER TABLE "scholarship_window" DROP COLUMN IF EXISTS "laptop_application_deadline";
    ALTER TABLE "scholarship_window" DROP COLUMN IF EXISTS "laptop_applications_open";
    ALTER TABLE "categories" DROP COLUMN IF EXISTS "free_exercise";
  `)
}
