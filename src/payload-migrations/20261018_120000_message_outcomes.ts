import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/** Per-message unsubscribe and spam-complaint times, for the lifecycle dashboard. */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "messages" ADD COLUMN "unsubscribed_at" timestamp(3) with time zone;
    ALTER TABLE "messages" ADD COLUMN "complained_at" timestamp(3) with time zone;
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "messages" DROP COLUMN IF EXISTS "complained_at";
    ALTER TABLE "messages" DROP COLUMN IF EXISTS "unsubscribed_at";
  `)
}
