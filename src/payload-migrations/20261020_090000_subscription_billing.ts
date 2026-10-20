import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * Month-by-month payments by bank transfer or OPay: subscriptions record how they're paid.
 * `card` = Paystack renews from a saved card (every existing subscription); `manual` = each
 * transfer/OPay payment adds one month and the learner is reminded to pay the next.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TYPE "public"."enum_subscriptions_billing" AS ENUM('card', 'manual');
    ALTER TABLE "subscriptions" ADD COLUMN "billing" "enum_subscriptions_billing" DEFAULT 'card' NOT NULL;
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "billing";
    DROP TYPE IF EXISTS "public"."enum_subscriptions_billing";
  `)
}
