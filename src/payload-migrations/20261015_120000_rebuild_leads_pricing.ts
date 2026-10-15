import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * Career-pathway rebuild, phase 1:
 * - `leads` collection (Apply flow, WhatsApp follow-up, Imisi's queue)
 * - `scholarship-window` global, seeded with the October 2026 window
 * - course pricing fields: standard fee, monthly display price, duration, weekly hours, phone-friendly
 *
 * - the admin document-lock column the newsletter migration missed (opening a subscriber in the admin needs it)
 *
 * Course *values* (standard fee ₦100,000, scholarship price ₦2,000, phone-friendly flags) are
 * set separately by `npm run seed:rebuild-pricing` so they can be reviewed in a dry run first.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TYPE "public"."enum_leads_current_status" AS ENUM('student', 'graduate_nysc', 'working_switch', 'not_working');
    CREATE TYPE "public"."enum_leads_device" AS ENUM('laptop', 'phone_only', 'both');
    CREATE TYPE "public"."enum_leads_weekly_hours" AS ENUM('under_5', '5_8', '8_plus');
    CREATE TYPE "public"."enum_leads_source" AS ENUM('apply', 'quiz', 'curriculum_request', 'contact', 'employer', 'other');
    CREATE TYPE "public"."enum_leads_status" AS ENUM('new', 'contacted', 'offer_viewed', 'account_created', 'paid', 'lost');
    CREATE TYPE "public"."enum_leads_whatsapp_log_direction" AS ENUM('in', 'out');

    CREATE TABLE "leads_whatsapp_log" (
      "_order" integer NOT NULL,
      "_parent_id" integer NOT NULL,
      "id" varchar PRIMARY KEY NOT NULL,
      "direction" "enum_leads_whatsapp_log_direction" NOT NULL,
      "type" varchar NOT NULL,
      "template" varchar,
      "body" varchar,
      "at" timestamp(3) with time zone NOT NULL
    );

    CREATE TABLE "leads_follow_ups_sent" (
      "_order" integer NOT NULL,
      "_parent_id" integer NOT NULL,
      "id" varchar PRIMARY KEY NOT NULL,
      "key" varchar NOT NULL,
      "sent_at" timestamp(3) with time zone NOT NULL
    );

    CREATE TABLE "leads" (
      "id" serial PRIMARY KEY NOT NULL,
      "first_name" varchar NOT NULL,
      "email" varchar NOT NULL,
      "phone" varchar NOT NULL,
      "phone_hash" varchar,
      "school_id" integer,
      "course_id" integer,
      "current_status" "enum_leads_current_status",
      "device" "enum_leads_device",
      "weekly_hours" "enum_leads_weekly_hours",
      "message" varchar,
      "source" "enum_leads_source" DEFAULT 'apply' NOT NULL,
      "utm_source" varchar,
      "utm_medium" varchar,
      "utm_campaign" varchar,
      "utm_content" varchar,
      "utm_term" varchar,
      "referrer" varchar,
      "landing_path" varchar,
      "marketing_consent" boolean DEFAULT false,
      "marketing_consent_at" timestamp(3) with time zone,
      "marketing_consent_text" varchar,
      "opted_out_at" timestamp(3) with time zone,
      "status" "enum_leads_status" DEFAULT 'new' NOT NULL,
      "waitlist" boolean DEFAULT false,
      "score" numeric DEFAULT 0,
      "needs_human" boolean DEFAULT false,
      "last_event_at" timestamp(3) with time zone,
      "offer_view_count" numeric DEFAULT 0,
      "resume_code" varchar,
      "last_inbound_at" timestamp(3) with time zone,
      "user_id" integer,
      "notes" varchar,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
    );

    CREATE TABLE "scholarship_window" (
      "id" serial PRIMARY KEY NOT NULL,
      "is_open" boolean DEFAULT false,
      "laptops_per_cohort" numeric DEFAULT 2,
      "opens_at" timestamp(3) with time zone,
      "closes_at" timestamp(3) with time zone,
      "cohort_label" varchar,
      "cohort_starts_at" timestamp(3) with time zone,
      "cohort_ends_at" timestamp(3) with time zone,
      "updated_at" timestamp(3) with time zone,
      "created_at" timestamp(3) with time zone
    );

    ALTER TABLE "courses" ADD COLUMN "standard_price" numeric;
    ALTER TABLE "courses" ADD COLUMN "standard_monthly_price" numeric;
    ALTER TABLE "courses" ADD COLUMN "duration_months" numeric DEFAULT 3;
    ALTER TABLE "courses" ADD COLUMN "weekly_hours" numeric DEFAULT 8;
    ALTER TABLE "courses" ADD COLUMN "phone_friendly" boolean DEFAULT false;

    ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "leads_id" integer;
    ALTER TABLE "payload_locked_documents_rels" ADD COLUMN IF NOT EXISTS "newsletter_subscribers_id" integer;

    ALTER TABLE "leads_whatsapp_log" ADD CONSTRAINT "leads_whatsapp_log_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "leads_follow_ups_sent" ADD CONSTRAINT "leads_follow_ups_sent_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "leads" ADD CONSTRAINT "leads_school_id_categories_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;
    ALTER TABLE "leads" ADD CONSTRAINT "leads_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE set null ON UPDATE no action;
    ALTER TABLE "leads" ADD CONSTRAINT "leads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
    ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_leads_fk" FOREIGN KEY ("leads_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;

    CREATE INDEX "leads_whatsapp_log_order_idx" ON "leads_whatsapp_log" USING btree ("_order");
    CREATE INDEX "leads_whatsapp_log_parent_id_idx" ON "leads_whatsapp_log" USING btree ("_parent_id");
    CREATE INDEX "leads_follow_ups_sent_order_idx" ON "leads_follow_ups_sent" USING btree ("_order");
    CREATE INDEX "leads_follow_ups_sent_parent_id_idx" ON "leads_follow_ups_sent" USING btree ("_parent_id");
    CREATE UNIQUE INDEX "leads_email_idx" ON "leads" USING btree ("email");
    CREATE INDEX "leads_phone_hash_idx" ON "leads" USING btree ("phone_hash");
    CREATE INDEX "leads_school_idx" ON "leads" USING btree ("school_id");
    CREATE INDEX "leads_course_idx" ON "leads" USING btree ("course_id");
    CREATE INDEX "leads_score_idx" ON "leads" USING btree ("score");
    CREATE INDEX "leads_needs_human_idx" ON "leads" USING btree ("needs_human");
    CREATE UNIQUE INDEX "leads_resume_code_idx" ON "leads" USING btree ("resume_code");
    CREATE INDEX "leads_user_idx" ON "leads" USING btree ("user_id");
    CREATE INDEX "leads_updated_at_idx" ON "leads" USING btree ("updated_at");
    CREATE INDEX "leads_created_at_idx" ON "leads" USING btree ("created_at");
    CREATE INDEX "payload_locked_documents_rels_leads_id_idx" ON "payload_locked_documents_rels" USING btree ("leads_id");
    CREATE INDEX IF NOT EXISTS "payload_locked_documents_rels_newsletter_subscribers_id_idx" ON "payload_locked_documents_rels" USING btree ("newsletter_subscribers_id");
    DO $$ BEGIN
      ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_newsletter_subscribers_fk" FOREIGN KEY ("newsletter_subscribers_id") REFERENCES "public"."newsletter_subscribers"("id") ON DELETE cascade ON UPDATE no action;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;

    INSERT INTO "scholarship_window"
      ("is_open", "closes_at", "cohort_label", "cohort_starts_at", "cohort_ends_at", "laptops_per_cohort", "updated_at", "created_at")
    VALUES
      (true, '2026-10-31T23:59:00+01:00', 'October 2026 – January 2027 cohort', '2026-10-01T00:00:00+01:00', '2027-01-31T23:59:59+01:00', 2, now(), now());
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_leads_fk";
    DROP INDEX IF EXISTS "payload_locked_documents_rels_leads_id_idx";
    ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "leads_id";

    ALTER TABLE "courses" DROP COLUMN IF EXISTS "standard_price";
    ALTER TABLE "courses" DROP COLUMN IF EXISTS "standard_monthly_price";
    ALTER TABLE "courses" DROP COLUMN IF EXISTS "duration_months";
    ALTER TABLE "courses" DROP COLUMN IF EXISTS "weekly_hours";
    ALTER TABLE "courses" DROP COLUMN IF EXISTS "phone_friendly";

    DROP TABLE "scholarship_window" CASCADE;
    DROP TABLE "leads_whatsapp_log" CASCADE;
    DROP TABLE "leads_follow_ups_sent" CASCADE;
    DROP TABLE "leads" CASCADE;

    DROP TYPE "public"."enum_leads_current_status";
    DROP TYPE "public"."enum_leads_device";
    DROP TYPE "public"."enum_leads_weekly_hours";
    DROP TYPE "public"."enum_leads_source";
    DROP TYPE "public"."enum_leads_status";
    DROP TYPE "public"."enum_leads_whatsapp_log_direction";
  `)
}
