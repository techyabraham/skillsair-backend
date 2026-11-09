// Written from Payload's migrate:create output, reviewed by hand. The generator also re-emitted the
// career quiz tables (20261107_090000_career_quiz_v2 was hand-written without a snapshot); those
// statements are left out. This migration only lets an attribution start on an application:
//   - referral_attributions.lead_id (unique, references leads)
//   - referral_attributions.referred_user_id becomes optional (empty until the applicant signs up)
//   - source value cookie_apply
// The .json beside it is the full current schema, career quiz included, so the next generated
// migration diffs cleanly.
import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`ALTER TYPE "public"."enum_referral_attributions_source" ADD VALUE IF NOT EXISTS 'cookie_apply' BEFORE 'cookie_register'`)
  await db.execute(sql`
  ALTER TABLE "referral_attributions" ALTER COLUMN "referred_user_id" DROP NOT NULL;
  ALTER TABLE "referral_attributions" ADD COLUMN IF NOT EXISTS "lead_id" integer;
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'referral_attributions_lead_id_leads_id_fk') THEN
      ALTER TABLE "referral_attributions" ADD CONSTRAINT "referral_attributions_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;
    END IF;
  END $$;
  CREATE UNIQUE INDEX IF NOT EXISTS "referral_attributions_lead_idx" ON "referral_attributions" USING btree ("lead_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  // Attributions that never reached an account cannot exist without lead_id: they are removed.
  await db.execute(sql`
  DELETE FROM "referral_attributions" WHERE "referred_user_id" IS NULL;
  UPDATE "referral_attributions" SET "source" = 'cookie_register' WHERE "source"::text = 'cookie_apply';
  DROP INDEX IF EXISTS "referral_attributions_lead_idx";
  ALTER TABLE "referral_attributions" DROP CONSTRAINT IF EXISTS "referral_attributions_lead_id_leads_id_fk";
  ALTER TABLE "referral_attributions" DROP COLUMN IF EXISTS "lead_id";
  ALTER TABLE "referral_attributions" ALTER COLUMN "referred_user_id" SET NOT NULL;
  ALTER TABLE "referral_attributions" ALTER COLUMN "source" SET DATA TYPE text;
  DROP TYPE "public"."enum_referral_attributions_source";
  CREATE TYPE "public"."enum_referral_attributions_source" AS ENUM('cookie_register', 'cookie_checkout', 'admin');
  ALTER TABLE "referral_attributions" ALTER COLUMN "source" SET DATA TYPE "public"."enum_referral_attributions_source" USING "source"::"public"."enum_referral_attributions_source";`)
}
