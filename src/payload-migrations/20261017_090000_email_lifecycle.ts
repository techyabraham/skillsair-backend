import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * Lifecycle email system, step 1: the `messages` log, per-person lifecycle state on users
 * and leads, the `past_due` subscription status with failure tracking and the price lock,
 * and a lapse counter on enrolments.
 *
 * Backfills: email "offers" preference follows existing marketing consent; subscriptions on
 * an Access Scholarship plan are marked price-locked.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TYPE "public"."enum_users_lifecycle_email_suppressed" AS ENUM('bounced', 'complained');
    CREATE TYPE "public"."enum_leads_email_suppressed" AS ENUM('bounced', 'complained');
    CREATE TYPE "public"."enum_messages_channel" AS ENUM('email', 'whatsapp');
    CREATE TYPE "public"."enum_messages_kind" AS ENUM('transactional', 'service', 'marketing');
    CREATE TYPE "public"."enum_messages_status" AS ENUM('sent', 'skipped', 'failed');
    ALTER TYPE "public"."enum_subscriptions_status" ADD VALUE IF NOT EXISTS 'past_due' BEFORE 'cancelled';

    CREATE TABLE "messages" (
      "id" serial PRIMARY KEY NOT NULL,
      "person_key" varchar NOT NULL,
      "channel" "enum_messages_channel" NOT NULL,
      "kind" "enum_messages_kind" NOT NULL,
      "track" varchar NOT NULL,
      "step_id" varchar NOT NULL,
      "template" varchar NOT NULL,
      "subject_id" varchar,
      "cycle" numeric DEFAULT 0,
      "idempotency_key" varchar NOT NULL,
      "status" "enum_messages_status" NOT NULL,
      "skip_reason" varchar,
      "provider_id" varchar,
      "sent_at" timestamp(3) with time zone NOT NULL,
      "opened_at" timestamp(3) with time zone,
      "clicked_at" timestamp(3) with time zone,
      "converted_at" timestamp(3) with time zone,
      "variant" varchar,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
    );
    CREATE TABLE "messages_rels" (
      "id" serial PRIMARY KEY NOT NULL,
      "order" integer,
      "parent_id" integer NOT NULL,
      "path" varchar NOT NULL,
      "users_id" integer,
      "leads_id" integer
    );

    ALTER TABLE "users" ADD COLUMN "lifecycle_last_learning_at" timestamp(3) with time zone;
    ALTER TABLE "users" ADD COLUMN "lifecycle_email_prefs_offers" boolean DEFAULT false;
    ALTER TABLE "users" ADD COLUMN "lifecycle_email_prefs_learning_reminders" boolean DEFAULT true;
    ALTER TABLE "users" ADD COLUMN "lifecycle_email_suppressed" "enum_users_lifecycle_email_suppressed";
    ALTER TABLE "users" ADD COLUMN "lifecycle_last_engaged_at" timestamp(3) with time zone;
    ALTER TABLE "users" ADD COLUMN "lifecycle_sunset_at" timestamp(3) with time zone;
    ALTER TABLE "enrollments" ADD COLUMN "lifecycle_cycle" numeric DEFAULT 0;
    ALTER TABLE "subscriptions" ADD COLUMN "failed_attempts" numeric DEFAULT 0;
    ALTER TABLE "subscriptions" ADD COLUMN "last_failed_at" timestamp(3) with time zone;
    ALTER TABLE "subscriptions" ADD COLUMN "price_locked" boolean DEFAULT false;
    ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "messages_id" integer;
    ALTER TABLE "leads" ADD COLUMN "last_engaged_at" timestamp(3) with time zone;
    ALTER TABLE "leads" ADD COLUMN "sunset_at" timestamp(3) with time zone;
    ALTER TABLE "leads" ADD COLUMN "email_suppressed" "enum_leads_email_suppressed";

    ALTER TABLE "messages_rels" ADD CONSTRAINT "messages_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "messages_rels" ADD CONSTRAINT "messages_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "messages_rels" ADD CONSTRAINT "messages_rels_leads_fk" FOREIGN KEY ("leads_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_messages_fk" FOREIGN KEY ("messages_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;

    CREATE INDEX "messages_person_key_idx" ON "messages" USING btree ("person_key");
    CREATE INDEX "messages_track_idx" ON "messages" USING btree ("track");
    CREATE INDEX "messages_step_id_idx" ON "messages" USING btree ("step_id");
    CREATE UNIQUE INDEX "messages_idempotency_key_idx" ON "messages" USING btree ("idempotency_key");
    CREATE INDEX "messages_status_idx" ON "messages" USING btree ("status");
    CREATE INDEX "messages_provider_id_idx" ON "messages" USING btree ("provider_id");
    CREATE INDEX "messages_sent_at_idx" ON "messages" USING btree ("sent_at");
    CREATE INDEX "messages_updated_at_idx" ON "messages" USING btree ("updated_at");
    CREATE INDEX "messages_created_at_idx" ON "messages" USING btree ("created_at");
    CREATE INDEX "personKey_sentAt_idx" ON "messages" USING btree ("person_key","sent_at");
    CREATE INDEX "messages_rels_order_idx" ON "messages_rels" USING btree ("order");
    CREATE INDEX "messages_rels_parent_idx" ON "messages_rels" USING btree ("parent_id");
    CREATE INDEX "messages_rels_path_idx" ON "messages_rels" USING btree ("path");
    CREATE INDEX "messages_rels_users_id_idx" ON "messages_rels" USING btree ("users_id");
    CREATE INDEX "messages_rels_leads_id_idx" ON "messages_rels" USING btree ("leads_id");
    CREATE INDEX "payload_locked_documents_rels_messages_id_idx" ON "payload_locked_documents_rels" USING btree ("messages_id");

    UPDATE "users" SET "lifecycle_email_prefs_offers" = true WHERE "marketing_consent" = 'opted_in';
    UPDATE "subscriptions" SET "price_locked" = true
      WHERE "plan_id" IN (SELECT "id" FROM "plans" WHERE "kind" = 'scholarship');
  `)
}

/** Postgres can't drop an enum value, so 'past_due' stays; rows using it go back to 'active'. */
export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    UPDATE "subscriptions" SET "status" = 'active' WHERE "status" = 'past_due';
    ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_messages_fk";
    DROP INDEX IF EXISTS "payload_locked_documents_rels_messages_id_idx";
    ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "messages_id";
    DROP TABLE IF EXISTS "messages_rels" CASCADE;
    DROP TABLE IF EXISTS "messages" CASCADE;
    ALTER TABLE "leads" DROP COLUMN IF EXISTS "email_suppressed";
    ALTER TABLE "leads" DROP COLUMN IF EXISTS "sunset_at";
    ALTER TABLE "leads" DROP COLUMN IF EXISTS "last_engaged_at";
    ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "price_locked";
    ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "last_failed_at";
    ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "failed_attempts";
    ALTER TABLE "enrollments" DROP COLUMN IF EXISTS "lifecycle_cycle";
    ALTER TABLE "users" DROP COLUMN IF EXISTS "lifecycle_sunset_at";
    ALTER TABLE "users" DROP COLUMN IF EXISTS "lifecycle_last_engaged_at";
    ALTER TABLE "users" DROP COLUMN IF EXISTS "lifecycle_email_suppressed";
    ALTER TABLE "users" DROP COLUMN IF EXISTS "lifecycle_email_prefs_learning_reminders";
    ALTER TABLE "users" DROP COLUMN IF EXISTS "lifecycle_email_prefs_offers";
    ALTER TABLE "users" DROP COLUMN IF EXISTS "lifecycle_last_learning_at";
    DROP TYPE IF EXISTS "public"."enum_messages_status";
    DROP TYPE IF EXISTS "public"."enum_messages_kind";
    DROP TYPE IF EXISTS "public"."enum_messages_channel";
    DROP TYPE IF EXISTS "public"."enum_leads_email_suppressed";
    DROP TYPE IF EXISTS "public"."enum_users_lifecycle_email_suppressed";
  `)
}
