import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/** Plans gain a kind: the ₦2,000/month Access Scholarship plan or a standard plan. */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TYPE "public"."enum_plans_kind" AS ENUM('scholarship', 'standard');
    ALTER TABLE "plans" ADD COLUMN "kind" "enum_plans_kind" DEFAULT 'standard' NOT NULL;
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "plans" DROP COLUMN IF EXISTS "kind";
    DROP TYPE IF EXISTS "public"."enum_plans_kind";
  `)
}
