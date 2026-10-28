import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`ALTER TYPE "public"."enum_ambassador_ledger_type" ADD VALUE IF NOT EXISTS 'payout_reversal'`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM "ambassador_ledger" WHERE "type"::text = 'payout_reversal') THEN
        RAISE EXCEPTION 'Cannot roll back ambassador payout reversal while ledger rows still use it';
      END IF;
    END $$;
  `)
  await db.execute(sql`ALTER TYPE "public"."enum_ambassador_ledger_type" RENAME TO "enum_ambassador_ledger_type_with_reversal"`)
  await db.execute(sql`CREATE TYPE "public"."enum_ambassador_ledger_type" AS ENUM('commission', 'reversal', 'adjustment', 'payout')`)
  await db.execute(sql`
    ALTER TABLE "ambassador_ledger"
    ALTER COLUMN "type" TYPE "public"."enum_ambassador_ledger_type"
    USING "type"::text::"public"."enum_ambassador_ledger_type"
  `)
  await db.execute(sql`DROP TYPE "public"."enum_ambassador_ledger_type_with_reversal"`)
}
