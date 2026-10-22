import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/** Free bonus courses (Freelancer's Academy, CV & LinkedIn): see src/lib/bonus-access.ts. */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "courses" ADD COLUMN IF NOT EXISTS "is_bonus" boolean DEFAULT false;
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "courses" DROP COLUMN IF EXISTS "is_bonus";
  `)
}
